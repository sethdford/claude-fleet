/**
 * Claude Code Local Collaboration Server v1.1
 * With SQLite persistence for messages and state.
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3847;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'collab.db');

app.use(cors());
app.use(express.json());

// Input validation helpers
function validateRequired(obj, fields) {
  const missing = fields.filter(f => !obj[f] || (typeof obj[f] === 'string' && obj[f].trim() === ''));
  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  return { valid: true };
}

function validateString(value, name, minLen = 1, maxLen = 1000) {
  if (typeof value !== 'string') {
    return { valid: false, error: `${name} must be a string` };
  }
  if (value.length < minLen) {
    return { valid: false, error: `${name} must be at least ${minLen} characters` };
  }
  if (value.length > maxLen) {
    return { valid: false, error: `${name} must be at most ${maxLen} characters` };
  }
  return { valid: true };
}

function validateEnum(value, name, allowed) {
  if (!allowed.includes(value)) {
    return { valid: false, error: `${name} must be one of: ${allowed.join(', ')}` };
  }
  return { valid: true };
}

// Initialize SQLite database
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    team_name TEXT NOT NULL,
    agent_type TEXT DEFAULT 'worker',
    created_at TEXT NOT NULL,
    last_seen TEXT
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    participants TEXT NOT NULL,
    is_team_chat INTEGER DEFAULT 0,
    team_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    from_handle TEXT NOT NULL,
    from_uid TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    metadata TEXT,
    FOREIGN KEY (chat_id) REFERENCES chats(id)
  );

  CREATE TABLE IF NOT EXISTS unread (
    chat_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (chat_id, uid)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    team_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT,
    owner_handle TEXT,
    owner_uid TEXT,
    created_by_handle TEXT NOT NULL,
    created_by_uid TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    blocked_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_name);
  CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_name);
`);

// Prepared statements
const stmts = {
  insertUser: db.prepare(`
    INSERT OR REPLACE INTO users (uid, handle, team_name, agent_type, created_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getUser: db.prepare('SELECT * FROM users WHERE uid = ?'),
  getUsersByTeam: db.prepare('SELECT * FROM users WHERE team_name = ?'),
  insertChat: db.prepare(`
    INSERT OR REPLACE INTO chats (id, participants, is_team_chat, team_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getChat: db.prepare('SELECT * FROM chats WHERE id = ?'),
  getChatsByUser: db.prepare('SELECT * FROM chats WHERE participants LIKE ?'),
  updateChatTime: db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?'),
  insertMessage: db.prepare(`
    INSERT INTO messages (id, chat_id, from_handle, from_uid, text, timestamp, status, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMessages: db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC LIMIT ?'),
  getMessagesAfter: db.prepare('SELECT * FROM messages WHERE chat_id = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?'),
  getUnread: db.prepare('SELECT count FROM unread WHERE chat_id = ? AND uid = ?'),
  setUnread: db.prepare('INSERT OR REPLACE INTO unread (chat_id, uid, count) VALUES (?, ?, ?)'),
  incrementUnread: db.prepare('INSERT INTO unread (chat_id, uid, count) VALUES (?, ?, 1) ON CONFLICT(chat_id, uid) DO UPDATE SET count = count + 1'),
  clearUnread: db.prepare('UPDATE unread SET count = 0 WHERE chat_id = ? AND uid = ?'),
  insertTask: db.prepare(`
    INSERT INTO tasks (id, team_name, subject, description, owner_handle, owner_uid,
                       created_by_handle, created_by_uid, status, blocked_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  getTasksByTeam: db.prepare('SELECT * FROM tasks WHERE team_name = ? ORDER BY created_at DESC'),
  updateTaskStatus: db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'),
};

// WebSocket subscriptions
const subscriptions = new Map();

function generateChatId(uid1, uid2) {
  const sorted = [uid1, uid2].sort();
  return crypto.createHash('sha256').update(sorted.join(':')).digest('hex').slice(0, 16);
}

function generateTeamChatId(teamName) {
  return crypto.createHash('sha256').update('team:' + teamName).digest('hex').slice(0, 16);
}

function broadcastToChat(chatId, message) {
  const subs = subscriptions.get(chatId);
  if (!subs) return;
  const payload = JSON.stringify(message);
  subs.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  });
}

// Health check
app.get('/health', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const chatCount = db.prepare('SELECT COUNT(*) as count FROM chats').get();
  const messageCount = db.prepare('SELECT COUNT(*) as count FROM messages').get();
  res.json({
    status: 'ok',
    persistence: 'sqlite',
    dbPath: DB_PATH,
    agents: userCount.count,
    chats: chatCount.count,
    messages: messageCount.count
  });
});

// Authentication
app.post('/auth', (req, res) => {
  const { handle, teamName, agentType } = req.body;

  // Validate required fields
  const reqCheck = validateRequired(req.body, ['handle', 'teamName']);
  if (!reqCheck.valid) return res.status(400).json({ error: reqCheck.error });

  // Validate handle
  const handleCheck = validateString(handle, 'handle', 1, 50);
  if (!handleCheck.valid) return res.status(400).json({ error: handleCheck.error });

  // Validate teamName
  const teamCheck = validateString(teamName, 'teamName', 1, 50);
  if (!teamCheck.valid) return res.status(400).json({ error: teamCheck.error });

  // Validate agentType if provided
  if (agentType) {
    const typeCheck = validateEnum(agentType, 'agentType', ['team-lead', 'worker']);
    if (!typeCheck.valid) return res.status(400).json({ error: typeCheck.error });
  }

  const uid = crypto.createHash('sha256').update(teamName + ':' + handle).digest('hex').slice(0, 24);
  const now = new Date().toISOString();
  stmts.insertUser.run(uid, handle, teamName, agentType || 'worker', now, now);
  console.log('[AUTH] ' + handle + ' (' + (agentType || 'worker') + ') joined team "' + teamName + '"');
  res.json({ uid, handle, teamName, agentType: agentType || 'worker' });
});

// Get user
app.get('/users/:uid', (req, res) => {
  const user = stmts.getUser.get(req.params.uid);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// List team agents
app.get('/teams/:teamName/agents', (req, res) => {
  res.json(stmts.getUsersByTeam.all(req.params.teamName));
});

// List user's chats
app.get('/users/:uid/chats', (req, res) => {
  const { uid } = req.params;
  const chats = stmts.getChatsByUser.all('%' + uid + '%');
  const result = chats.map(chat => {
    const unread = stmts.getUnread.get(chat.id, uid);
    const lastMsg = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 1').get(chat.id);
    return {
      id: chat.id,
      participants: JSON.parse(chat.participants),
      unread: unread ? unread.count : 0,
      lastMessage: lastMsg,
      updatedAt: chat.updated_at
    };
  });
  res.json(result);
});

// Create/get chat
app.post('/chats', (req, res) => {
  const { uid1, uid2 } = req.body;
  if (!uid1 || !uid2) return res.status(400).json({ error: 'uid1 and uid2 required' });
  const chatId = generateChatId(uid1, uid2);
  const existing = stmts.getChat.get(chatId);
  if (!existing) {
    const now = new Date().toISOString();
    stmts.insertChat.run(chatId, JSON.stringify([uid1, uid2]), 0, null, now, now);
    stmts.setUnread.run(chatId, uid1, 0);
    stmts.setUnread.run(chatId, uid2, 0);
    console.log('[CHAT] Created ' + chatId);
  }
  res.json({ chatId });
});

// Get chat messages
app.get('/chats/:chatId/messages', (req, res) => {
  const { chatId } = req.params;
  const { limit = 50, after } = req.query;
  const chat = stmts.getChat.get(chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  let messages;
  if (after) {
    const afterMsg = db.prepare('SELECT timestamp FROM messages WHERE id = ?').get(after);
    messages = afterMsg ? stmts.getMessagesAfter.all(chatId, afterMsg.timestamp, parseInt(limit)) : stmts.getMessages.all(chatId, parseInt(limit));
  } else {
    messages = stmts.getMessages.all(chatId, parseInt(limit));
  }
  res.json(messages.map(m => ({ ...m, metadata: m.metadata ? JSON.parse(m.metadata) : {} })));
});

// Send message
app.post('/chats/:chatId/messages', (req, res) => {
  const { chatId } = req.params;
  const { from, text, metadata } = req.body;

  // Validate required fields
  const reqCheck = validateRequired(req.body, ['from', 'text']);
  if (!reqCheck.valid) return res.status(400).json({ error: reqCheck.error });

  // Validate text
  const textCheck = validateString(text, 'text', 1, 50000);
  if (!textCheck.valid) return res.status(400).json({ error: textCheck.error });

  const chat = stmts.getChat.get(chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const fromUser = stmts.getUser.get(from);
  if (!fromUser) return res.status(404).json({ error: 'Sender not found' });
  const messageId = uuidv4();
  const now = new Date().toISOString();
  const fromHandle = 'collab:' + fromUser.handle;
  stmts.insertMessage.run(messageId, chatId, fromHandle, from, text, now, 'pending', metadata ? JSON.stringify(metadata) : null);
  stmts.updateChatTime.run(now, chatId);
  JSON.parse(chat.participants).forEach(uid => {
    if (uid !== from) stmts.incrementUnread.run(chatId, uid);
  });
  const message = { id: messageId, chatId, from: fromHandle, fromUid: from, text, timestamp: now, status: 'pending', metadata: metadata || {} };
  console.log('[MSG] ' + fromUser.handle + ': ' + text.slice(0, 50) + '...');
  broadcastToChat(chatId, { type: 'new_message', message, handle: fromUser.handle });
  res.json(message);
});

// Mark as read
app.post('/chats/:chatId/read', (req, res) => {
  const { chatId } = req.params;
  const { uid } = req.body;
  stmts.clearUnread.run(chatId, uid);
  db.prepare("UPDATE messages SET status = 'processed' WHERE chat_id = ? AND from_uid != ? AND status = 'pending'").run(chatId, uid);
  res.json({ success: true });
});

// Team broadcast
app.post('/teams/:teamName/broadcast', (req, res) => {
  const { teamName } = req.params;
  const { from, text, metadata } = req.body;
  const fromUser = stmts.getUser.get(from);
  if (!fromUser) return res.status(404).json({ error: 'Sender not found' });
  const teamChatId = generateTeamChatId(teamName);
  const agents = stmts.getUsersByTeam.all(teamName);
  const participants = agents.map(a => a.uid);
  let chat = stmts.getChat.get(teamChatId);
  if (!chat) {
    const now = new Date().toISOString();
    stmts.insertChat.run(teamChatId, JSON.stringify(participants), 1, teamName, now, now);
    participants.forEach(uid => stmts.setUnread.run(teamChatId, uid, 0));
  }
  const messageId = uuidv4();
  const now = new Date().toISOString();
  stmts.insertMessage.run(messageId, teamChatId, 'collab:' + fromUser.handle, from, text, now, 'pending', JSON.stringify({ ...metadata, isBroadcast: true }));
  stmts.updateChatTime.run(now, teamChatId);
  participants.forEach(uid => { if (uid !== from) stmts.incrementUnread.run(teamChatId, uid); });
  const message = { id: messageId, chatId: teamChatId, from: 'collab:' + fromUser.handle, fromUid: from, text, timestamp: now, status: 'pending', metadata: { ...metadata, isBroadcast: true } };
  console.log('[BROADCAST] ' + fromUser.handle + ' -> ' + teamName + ': ' + text.slice(0, 50) + '...');
  broadcastToChat(teamChatId, { type: 'broadcast', message, handle: fromUser.handle });
  res.json(message);
});

// Create task
app.post('/tasks', (req, res) => {
  const { fromUid, toHandle, teamName, subject, description, blockedBy } = req.body;

  // Validate required fields
  const reqCheck = validateRequired(req.body, ['fromUid', 'toHandle', 'teamName', 'subject']);
  if (!reqCheck.valid) return res.status(400).json({ error: reqCheck.error });

  // Validate subject
  const subjectCheck = validateString(subject, 'subject', 3, 200);
  if (!subjectCheck.valid) return res.status(400).json({ error: subjectCheck.error });

  // Validate description if provided
  if (description) {
    const descCheck = validateString(description, 'description', 0, 10000);
    if (!descCheck.valid) return res.status(400).json({ error: descCheck.error });
  }

  // Validate blockedBy is array if provided
  if (blockedBy && !Array.isArray(blockedBy)) {
    return res.status(400).json({ error: 'blockedBy must be an array of task IDs' });
  }

  const fromUser = stmts.getUser.get(fromUid);
  if (!fromUser) return res.status(404).json({ error: 'Sender not found' });
  const toUser = db.prepare('SELECT * FROM users WHERE handle = ? AND team_name = ?').get(toHandle, teamName);
  if (!toUser) return res.status(404).json({ error: 'Agent ' + toHandle + ' not found' });
  const taskId = uuidv4();
  const now = new Date().toISOString();
  stmts.insertTask.run(taskId, teamName, subject, description || '', toHandle, toUser.uid, fromUser.handle, fromUid, 'open', blockedBy ? JSON.stringify(blockedBy) : '[]', now, now);
  const chatId = generateChatId(fromUid, toUser.uid);
  let chat = stmts.getChat.get(chatId);
  if (!chat) {
    stmts.insertChat.run(chatId, JSON.stringify([fromUid, toUser.uid]), 0, null, now, now);
    stmts.setUnread.run(chatId, fromUid, 0);
    stmts.setUnread.run(chatId, toUser.uid, 0);
  }
  const messageId = uuidv4();
  stmts.insertMessage.run(messageId, chatId, 'collab:' + fromUser.handle, fromUid, '[TASK] ' + subject + '\n\n' + (description || ''), now, 'pending', JSON.stringify({ taskId, type: 'task_assignment' }));
  stmts.incrementUnread.run(chatId, toUser.uid);
  const task = { id: taskId, teamName, subject, description, owner: toHandle, ownerUid: toUser.uid, createdBy: fromUser.handle, createdByUid: fromUid, status: 'open', blockedBy: blockedBy || [], createdAt: now };
  console.log('[TASK] ' + fromUser.handle + ' -> ' + toHandle + ': ' + subject);
  broadcastToChat(chatId, { type: 'task_assigned', task, handle: fromUser.handle });
  res.json(task);
});

// Update task
app.patch('/tasks/:taskId', (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;

  // Validate status
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }
  const statusCheck = validateEnum(status, 'status', ['open', 'in_progress', 'resolved', 'blocked']);
  if (!statusCheck.valid) return res.status(400).json({ error: statusCheck.error });

  const task = stmts.getTask.get(taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const now = new Date().toISOString();
  stmts.updateTaskStatus.run(status, now, taskId);
  console.log('[TASK] ' + taskId.slice(0, 8) + '... status -> ' + status);
  res.json({ ...task, status, updated_at: now });
});

// List team tasks
app.get('/teams/:teamName/tasks', (req, res) => {
  const tasks = stmts.getTasksByTeam.all(req.params.teamName);
  res.json(tasks.map(t => ({ ...t, blockedBy: t.blocked_by ? JSON.parse(t.blocked_by) : [] })));
});

// Debug
app.get('/debug', (req, res) => {
  res.json({
    users: db.prepare('SELECT * FROM users').all(),
    chats: db.prepare('SELECT * FROM chats').all().map(c => ({ ...c, participants: JSON.parse(c.participants) })),
    messageCount: db.prepare('SELECT COUNT(*) as count FROM messages').get().count,
    tasks: db.prepare('SELECT * FROM tasks').all()
  });
});

// WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[WS] New connection');
  ws.isAlive = true;
  ws.subscribedChats = new Set();
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'subscribe') {
        ws.subscribedChats.add(msg.chatId);
        ws.uid = msg.uid;
        if (!subscriptions.has(msg.chatId)) subscriptions.set(msg.chatId, new Set());
        subscriptions.get(msg.chatId).add(ws);
        console.log('[WS] Subscribed to ' + msg.chatId);
        ws.send(JSON.stringify({ type: 'subscribed', chatId: msg.chatId }));
      } else if (msg.type === 'unsubscribe') {
        ws.subscribedChats.delete(msg.chatId);
        if (subscriptions.has(msg.chatId)) subscriptions.get(msg.chatId).delete(ws);
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) { console.error('[WS] Error:', e.message); }
  });
  ws.on('close', () => {
    ws.subscribedChats.forEach(chatId => { if (subscriptions.has(chatId)) subscriptions.get(chatId).delete(ws); });
    console.log('[WS] Connection closed');
  });
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      if (ws.subscribedChats) ws.subscribedChats.forEach(chatId => { if (subscriptions.has(chatId)) subscriptions.get(chatId).delete(ws); });
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log('\n' +
    '==============================================================\n' +
    '     Claude Code Local Collaboration Server v1.1\n' +
    '               (with SQLite persistence)\n' +
    '==============================================================\n' +
    '  HTTP API:    http://localhost:' + PORT + '\n' +
    '  WebSocket:   ws://localhost:' + PORT + '/ws\n' +
    '  Database:    ' + DB_PATH + '\n' +
    '==============================================================\n' +
    '  Usage:\n' +
    '    export CLAUDE_CODE_TEAM_NAME="my-team"\n' +
    '    export CLAUDE_CODE_COLLAB_URL="http://localhost:' + PORT + '"\n' +
    '==============================================================\n'
  );
});

process.on('SIGINT', () => { console.log('\nShutting down...'); db.close(); process.exit(0); });

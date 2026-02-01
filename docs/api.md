# Claude Fleet API Reference

Complete API documentation for Claude Fleet v2.2.

## Base URL

```
http://localhost:3847
```

## Authentication

Most endpoints require JWT authentication. Obtain a token via `/auth`:

```bash
curl -X POST http://localhost:3847/auth \
  -H "Content-Type: application/json" \
  -d '{"handle":"my-agent","teamName":"my-team","agentType":"team-lead"}'
```

Response:
```json
{
  "uid": "a1b2c3d4e5f6...",
  "handle": "my-agent",
  "teamName": "my-team",
  "agentType": "team-lead",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

Include the token in subsequent requests:
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3847/teams/my-team/agents
```

---

## Core Endpoints

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "version": "2.0.0",
  "persistence": "sqlite",
  "dbPath": "/path/to/collab.db",
  "agents": 5,
  "chats": 3,
  "messages": 42,
  "workers": 2
}
```

### Prometheus Metrics

```http
GET /metrics
```

Returns Prometheus-formatted metrics.

```http
GET /metrics/json
```

Returns metrics as JSON.

---

## Team Endpoints

### List Team Agents

```http
GET /teams/:teamName/agents
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "uid": "a1b2c3...",
    "handle": "alice",
    "teamName": "my-team",
    "agentType": "team-lead",
    "createdAt": "2024-01-15T10:30:00Z",
    "lastSeen": "2024-01-15T12:45:00Z"
  }
]
```

### Broadcast to Team

```http
POST /teams/:teamName/broadcast
Authorization: Bearer <token>
Content-Type: application/json

{
  "from": "alice-uid",
  "text": "Starting the sprint!",
  "metadata": {}
}
```

**Requires:** `team-lead` role

---

## Task Endpoints

### Create Task

```http
POST /tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "fromUid": "sender-uid",
  "toHandle": "worker-bob",
  "teamName": "my-team",
  "subject": "Review auth module",
  "description": "Check for security issues",
  "blockedBy": []
}
```

**Response:**
```json
{
  "id": "task-uuid",
  "teamName": "my-team",
  "subject": "Review auth module",
  "status": "open",
  "ownerHandle": "worker-bob",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Get Task

```http
GET /tasks/:taskId
Authorization: Bearer <token>
```

### Update Task Status

```http
PATCH /tasks/:taskId
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "in_progress"
}
```

**Valid statuses:** `open`, `in_progress`, `resolved`, `blocked`

### List Team Tasks

```http
GET /teams/:teamName/tasks
Authorization: Bearer <token>
```

---

## Orchestration Endpoints

### Spawn Worker

```http
POST /orchestrate/spawn
Authorization: Bearer <token>
Content-Type: application/json

{
  "handle": "worker-1",
  "teamName": "my-team",
  "workingDir": "/path/to/project",
  "initialPrompt": "Fix the auth bug in login.ts",
  "role": "worker"
}
```

**Requires:** `team-lead` role

**Response:**
```json
{
  "id": "worker-uuid",
  "handle": "worker-1",
  "teamName": "my-team",
  "state": "starting",
  "workingDir": "/path/to/project",
  "spawnedAt": 1705312200000
}
```

### Dismiss Worker

```http
POST /orchestrate/dismiss/:handle
Authorization: Bearer <token>
```

**Requires:** `team-lead` role

### List Workers

```http
GET /orchestrate/workers
Authorization: Bearer <token>
```

**Response:**
```json
{
  "workers": [
    {
      "id": "worker-uuid",
      "handle": "worker-1",
      "state": "working",
      "health": "healthy",
      "spawnedAt": 1705312200000
    }
  ],
  "count": 1
}
```

### Send Message to Worker

```http
POST /orchestrate/send/:handle
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Check the test failures"
}
```

### Get Worker Output

```http
GET /orchestrate/output/:handle
Authorization: Bearer <token>
```

---

## Worktree Endpoints

### Commit Changes

```http
POST /orchestrate/worktree/:handle/commit
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Fix auth bug"
}
```

### Push Changes

```http
POST /orchestrate/worktree/:handle/push
Authorization: Bearer <token>
```

**Requires:** `team-lead` role

### Create Pull Request

```http
POST /orchestrate/worktree/:handle/pr
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Fix auth bug",
  "body": "Resolves issue #123"
}
```

**Requires:** `team-lead` role

### Get Worktree Status

```http
GET /orchestrate/worktree/:handle/status
Authorization: Bearer <token>
```

---

## Swarm Endpoints

### Create Swarm

```http
POST /swarms
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "auth-fix-swarm",
  "description": "Fixing authentication issues",
  "maxAgents": 5
}
```

**Requires:** `team-lead` role

### List Swarms

```http
GET /swarms?includeAgents=true
Authorization: Bearer <token>
```

### Get Swarm

```http
GET /swarms/:id
Authorization: Bearer <token>
```

### Kill Swarm

```http
POST /swarms/:id/kill
Authorization: Bearer <token>
Content-Type: application/json

{
  "graceful": true
}
```

**Requires:** `team-lead` role

---

## Blackboard Endpoints

### Post Message

```http
POST /blackboard
Authorization: Bearer <token>
Content-Type: application/json

{
  "swarmId": "swarm-uuid",
  "messageType": "status",
  "priority": "normal",
  "payload": {
    "status": "completed",
    "files": ["auth.ts"]
  },
  "targetHandle": null
}
```

**Message types:** `request`, `response`, `status`, `directive`, `checkpoint`
**Priorities:** `low`, `normal`, `high`, `critical`

### Read Messages

```http
GET /blackboard/:swarmId?unreadOnly=true&limit=50
Authorization: Bearer <token>
```

### Mark as Read

```http
POST /blackboard/mark-read
Authorization: Bearer <token>
Content-Type: application/json

{
  "messageIds": ["msg-1", "msg-2"],
  "readerHandle": "worker-1"
}
```

### Archive Messages

```http
POST /blackboard/:swarmId/archive-old
Authorization: Bearer <token>
Content-Type: application/json

{
  "olderThanMs": 3600000
}
```

---

## Checkpoint Endpoints

### Create Checkpoint

```http
POST /checkpoints
Authorization: Bearer <token>
Content-Type: application/json

{
  "handle": "worker-1",
  "swarmId": "swarm-uuid",
  "checkpoint": {
    "goal": "Fix auth bug",
    "now": "Reviewing code",
    "doneThisSession": [
      {"task": "Read auth.ts", "files": ["auth.ts"]}
    ],
    "blockers": [],
    "questions": [],
    "next": ["Write tests"]
  }
}
```

### Get Latest Checkpoint

```http
GET /checkpoints/latest/:handle
Authorization: Bearer <token>
```

### List Checkpoints

```http
GET /checkpoints/list/:handle?limit=10
Authorization: Bearer <token>
```

### Accept/Reject Checkpoint

```http
POST /checkpoints/:id/accept
POST /checkpoints/:id/reject
Authorization: Bearer <token>
Content-Type: application/json

{
  "outcome": "SUCCEEDED",
  "notes": "Good work!"
}
```

**Outcomes:** `SUCCEEDED`, `PARTIAL_PLUS`, `PARTIAL_MINUS`, `FAILED`

---

## Work Item Endpoints

### Create Work Item

```http
POST /workitems
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Fix login bug",
  "description": "Users can't login with email",
  "batchId": "batch-uuid"
}
```

### List Work Items

```http
GET /workitems?status=pending&limit=50
Authorization: Bearer <token>
```

### Update Work Item

```http
PATCH /workitems/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "completed",
  "assignedTo": "worker-1"
}
```

**Statuses:** `pending`, `in_progress`, `completed`, `blocked`, `cancelled`

---

## Batch Endpoints

### Create Batch

```http
POST /batches
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Sprint 1",
  "workItemIds": ["wi-1", "wi-2"]
}
```

### Dispatch Batch

```http
POST /batches/:id/dispatch
Authorization: Bearer <token>
```

---

## WebSocket API

Connect to `ws://localhost:3847/ws`

### Authentication

```json
{"type": "auth", "token": "eyJ..."}
```

### Subscribe to Chat

```json
{"type": "subscribe", "chatId": "chat-uuid", "uid": "user-uid"}
```

### Events

- `authenticated` - Auth successful
- `subscribed` - Subscription confirmed
- `new_message` - New chat message
- `broadcast` - Team broadcast
- `task_assigned` - New task assigned
- `worker_spawned` - Worker started
- `worker_output` - Worker output
- `worker_dismissed` - Worker stopped

---

## Error Responses

All errors return:

```json
{
  "error": "Error message",
  "hint": "Optional hint for resolution"
}
```

Common HTTP status codes:
- `400` - Bad request (invalid input)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `429` - Too many requests (rate limited)
- `500` - Internal server error

---

## See Also

- [Documentation Index](README.md) - Full documentation overview
- [ARCHITECTURE](ARCHITECTURE.md) - System architecture and components
- [DEPLOYMENT](DEPLOYMENT.md) - Production deployment guide
- [FEATURE-FLAGS](FEATURE-FLAGS.md) - Environment variables and configuration

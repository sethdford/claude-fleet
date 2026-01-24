# Deployment Guide

This guide covers deploying Claude Code Collab in production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Production Build](#production-build)
- [Service Management](#service-management)
- [Database Management](#database-management)
- [Monitoring](#monitoring)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 18.0.0 or higher
- SQLite 3.x (included via better-sqlite3)
- Git (for worktree features)
- `gh` CLI (optional, for PR creation)

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 core | 2+ cores |
| RAM | 512 MB | 2 GB |
| Disk | 1 GB | 10 GB |

---

## Environment Configuration

Create a `.env` file or export these environment variables:

```bash
# Server Configuration
PORT=3847                              # Server port (default: 3847)
NODE_ENV=production                    # Environment mode

# Database
DB_PATH=/var/lib/collab/collab.db     # SQLite database path

# Authentication
JWT_SECRET=your-secure-random-secret   # REQUIRED in production
JWT_EXPIRES_IN=24h                     # Token expiration (default: 24h)

# Worker Orchestration
MAX_WORKERS=10                         # Maximum concurrent workers (default: 5)

# Rate Limiting
RATE_LIMIT_WINDOW=60000                # Window in ms (default: 60000)
RATE_LIMIT_MAX=100                     # Max requests per window (default: 100)

# Optional Integrations
LINEAR_API_KEY=lin_api_xxx             # Linear integration (optional)
LINEAR_MCP_ENABLED=true                # Enable Linear MCP tools
```

### Generating a Secure JWT Secret

```bash
# Generate a 64-character random secret
openssl rand -base64 48
```

**Important**: Never commit secrets to version control. Use environment variables or a secrets manager.

---

## Production Build

### 1. Install Dependencies

```bash
npm ci --production=false
```

### 2. Build TypeScript

```bash
npm run build
```

### 3. Verify Build

```bash
npm run typecheck
npm test
```

### 4. Start Server

```bash
NODE_ENV=production node dist/index.js
```

---

## Service Management

### systemd (Linux)

Create `/etc/systemd/system/collab.service`:

```ini
[Unit]
Description=Claude Code Collab Server
After=network.target

[Service]
Type=simple
User=collab
Group=collab
WorkingDirectory=/opt/collab
ExecStart=/usr/bin/node /opt/collab/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3847
Environment=DB_PATH=/var/lib/collab/collab.db
EnvironmentFile=-/etc/collab/env

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable collab
sudo systemctl start collab
sudo systemctl status collab
```

### launchd (macOS)

Create `~/Library/LaunchAgents/com.collab.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.collab.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/opt/collab/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/opt/collab</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>3847</string>
        <key>DB_PATH</key>
        <string>/var/lib/collab/collab.db</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/collab/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/collab/stderr.log</string>
</dict>
</plist>
```

Load the service:

```bash
launchctl load ~/Library/LaunchAgents/com.collab.server.plist
```

### Docker

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY . .
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t collab-server .
docker run -d \
  --name collab \
  -p 3847:3847 \
  -v collab-data:/app/data \
  -e JWT_SECRET=your-secret \
  -e DB_PATH=/app/data/collab.db \
  collab-server
```

---

## Database Management

### Backup Strategy

SQLite databases should be backed up regularly. Since we use WAL mode, use the backup API or ensure the database is not being written to during backup.

#### Option 1: SQLite Backup Command

```bash
#!/bin/bash
# backup.sh
BACKUP_DIR=/var/backups/collab
DB_PATH=/var/lib/collab/collab.db
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/collab_$DATE.db'"

# Keep last 7 days of backups
find $BACKUP_DIR -name "collab_*.db" -mtime +7 -delete
```

Add to crontab:

```bash
0 */6 * * * /opt/collab/scripts/backup.sh
```

#### Option 2: Copy with WAL Checkpoint

```bash
sqlite3 $DB_PATH "PRAGMA wal_checkpoint(TRUNCATE);"
cp $DB_PATH $BACKUP_DIR/collab_$DATE.db
```

### Migrations

Run migrations on startup or manually:

```bash
# Migrations run automatically on server start
# To check status:
node -e "
const Database = require('better-sqlite3');
const { getMigrationStatus } = require('./dist/storage/migrations.js');
const db = new Database(process.env.DB_PATH || './collab.db');
console.log(getMigrationStatus(db));
"
```

### Database Maintenance

```bash
# Optimize database (run periodically)
sqlite3 $DB_PATH "VACUUM;"
sqlite3 $DB_PATH "ANALYZE;"

# Check integrity
sqlite3 $DB_PATH "PRAGMA integrity_check;"
```

---

## Monitoring

### Health Check

```bash
curl http://localhost:3847/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "2.0.0",
  "persistence": "sqlite",
  "agents": 5,
  "chats": 12,
  "messages": 234,
  "workers": 3
}
```

### Prometheus Metrics

Metrics are exposed at `/metrics` in Prometheus format:

```bash
curl http://localhost:3847/metrics
```

Key metrics:

| Metric | Description |
|--------|-------------|
| `http_requests_total` | Total HTTP requests by method/path/status |
| `http_request_duration_seconds` | Request latency histogram |
| `collab_workers_total` | Total worker count |
| `collab_workers_healthy` | Healthy worker count |
| `collab_tasks_by_status` | Tasks by status |
| `collab_messages_sent_total` | Messages sent |
| `collab_auth_failures_total` | Authentication failures |

### Prometheus Configuration

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'collab'
    static_configs:
      - targets: ['localhost:3847']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboard

Import dashboard ID: (create and share a dashboard)

Key panels:
- Request rate and latency
- Worker health status
- Task completion rate
- Error rate

### Alerting Rules

Example Prometheus alerting rules:

```yaml
groups:
  - name: collab
    rules:
      - alert: CollabServerDown
        expr: up{job="collab"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Collab server is down"

      - alert: HighErrorRate
        expr: rate(collab_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"

      - alert: WorkersUnhealthy
        expr: collab_workers_healthy / collab_workers_total < 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "More than 50% of workers are unhealthy"
```

---

## Security Considerations

### Network Security

1. **Firewall**: Only expose port 3847 to trusted networks
2. **TLS**: Use a reverse proxy (nginx, Caddy) for HTTPS
3. **CORS**: Configure allowed origins in production

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name collab.example.com;

    ssl_certificate /etc/letsencrypt/live/collab.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/collab.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3847;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3847/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Authentication

- JWT tokens expire after 24h by default
- Tokens are verified on all protected routes
- Failed auth attempts are logged and metered

### Rate Limiting

Default: 100 requests per minute per IP. Adjust for your use case.

---

## Troubleshooting

### Common Issues

#### Server won't start

```bash
# Check logs
journalctl -u collab -f

# Common causes:
# 1. Port already in use
lsof -i :3847

# 2. Database permissions
ls -la /var/lib/collab/

# 3. Missing dependencies
npm ci
```

#### Workers not spawning

```bash
# Check worker logs
curl http://localhost:3847/orchestrate/workers

# Verify claude-code CLI is available
which claude-code

# Check MAX_WORKERS limit
echo $MAX_WORKERS
```

#### Database locked

```bash
# Check for stale WAL files
ls -la /var/lib/collab/*.db*

# Force checkpoint
sqlite3 $DB_PATH "PRAGMA wal_checkpoint(TRUNCATE);"
```

### Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug node dist/index.js
```

### Health Check Script

```bash
#!/bin/bash
# health-check.sh

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3847/health)

if [ "$RESPONSE" != "200" ]; then
    echo "Health check failed: HTTP $RESPONSE"
    # Optionally restart the service
    # systemctl restart collab
    exit 1
fi

echo "Health check passed"
exit 0
```

---

## Support

- GitHub Issues: https://github.com/sethdford/claude-code-collab/issues
- Documentation: See README.md for API reference

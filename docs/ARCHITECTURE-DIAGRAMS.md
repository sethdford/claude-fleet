# Claude Fleet - Architecture Diagrams

> Visual documentation for the multi-agent orchestration system

---

## System Overview

```mermaid
graph TB
    subgraph Clients["Client Layer"]
        CLI[Fleet CLI]
        MCP[MCP Tools]
        API[REST API Clients]
    end

    subgraph Server["Claude Fleet Server"]
        HTTP[Express HTTP Server]
        WS[WebSocket Server]
        AUTH[JWT Auth Middleware]

        subgraph Routes["Route Handlers"]
            CORE[Core Routes]
            CHAT[Chat Routes]
            TASK[Task Routes]
            ORCH[Orchestrate Routes]
            FLEET[Fleet Routes]
            WORK[Work Item Routes]
            MAIL[Mail Routes]
            WF[Workflow Routes]
        end
    end

    subgraph Business["Business Logic Layer"]
        WM[Worker Manager]
        WE[Workflow Engine]
        SC[Spawn Controller]
    end

    subgraph Storage["Storage Layer"]
        SQLite[(SQLite DB)]

        subgraph Stores["Storage Modules"]
            TEAM[Team Storage]
            WORKER[Worker Storage]
            BB[Blackboard]
            CP[Checkpoint]
            SQ[Spawn Queue]
            TLDR[TLDR Cache]
            WI[Work Items]
            MAIL_S[Mail Storage]
        end
    end

    subgraph Workers["Worker Processes"]
        W1[Claude Agent 1]
        W2[Claude Agent 2]
        W3[Claude Agent N]
    end

    CLI --> HTTP
    MCP --> HTTP
    API --> HTTP

    HTTP --> AUTH
    AUTH --> Routes
    WS --> AUTH

    Routes --> WM
    Routes --> WE
    Routes --> Stores

    WM --> SC
    WM --> Workers
    WE --> Stores
    SC --> SQ

    Stores --> SQLite

    style Server fill:#1e3a5f,stroke:#38bdf8,color:#fff
    style Business fill:#1e3a5f,stroke:#10b981,color:#fff
    style Storage fill:#1e3a5f,stroke:#f59e0b,color:#fff
    style Workers fill:#1e3a5f,stroke:#8b5cf6,color:#fff
```

---

## Data Flow: Task Assignment

```mermaid
sequenceDiagram
    participant Lead as Team Lead
    participant API as Fleet API
    participant Auth as Auth Middleware
    participant Store as Storage
    participant WS as WebSocket
    participant Worker as Worker Agent

    Lead->>API: POST /tasks {toHandle, subject}
    API->>Auth: Validate JWT
    Auth-->>API: User Context

    API->>Store: getUser(fromUid)
    Store-->>API: Sender Info

    API->>Store: getUsersByTeam(team)
    Store-->>API: Team Agents

    API->>Store: insertTask(task)
    API->>Store: insertMessage(taskMsg)
    API->>Store: incrementUnread(toUid)

    API->>WS: broadcast(task_assigned)
    WS->>Worker: {type: task_assigned}

    API-->>Lead: Task Created

    Worker->>API: PATCH /tasks/:id {status: in_progress}
    API->>Store: updateTaskStatus()

    Worker->>API: PATCH /tasks/:id {status: resolved}
    API->>Store: updateTaskStatus()
```

---

## Worker Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Pending: Spawn Request

    Pending --> Approved: Lead Approves
    Pending --> Rejected: Lead Rejects

    Approved --> Spawning: Spawn Controller
    Rejected --> [*]

    Spawning --> Active: Process Started
    Spawning --> Failed: Spawn Error

    Active --> Idle: Task Complete
    Active --> Working: Task Assigned
    Active --> Crashed: Process Error

    Idle --> Working: New Task
    Idle --> Dismissed: Lead Dismisses

    Working --> Active: Task Done
    Working --> Crashed: Error

    Crashed --> Restarting: Auto-Recovery
    Restarting --> Active: Success
    Restarting --> Failed: Max Retries

    Dismissed --> [*]
    Failed --> [*]

    note right of Active
        Heartbeat every 15s
        Session ID for recovery
    end note

    note right of Spawning
        Worktree created
        Git branch isolated
    end note
```

---

## Workflow Engine (DAG Execution)

```mermaid
graph TD
    subgraph Workflow["Workflow: feature-branch"]
        START((Start)) --> SCOUT
        SCOUT[Scout Codebase] --> IMPL
        IMPL[Implement Feature] --> REVIEW
        REVIEW[Code Review Checkpoint] --> END((End))
    end

    subgraph Engine["Workflow Engine"]
        POLL[Poll Ready Steps]
        EXEC[Execute Step]
        DEC[Decrement Dependents]
        CHECK[Check Completion]
    end

    subgraph StepTypes["Step Types"]
        TASK_S[Task Step]
        SPAWN_S[Spawn Step]
        CP_S[Checkpoint Step]
        GATE_S[Gate Step]
        PARA_S[Parallel Step]
    end

    POLL --> EXEC
    EXEC --> DEC
    DEC --> CHECK
    CHECK -->|More Steps| POLL
    CHECK -->|All Done| COMPLETE((Complete))

    EXEC -.-> TASK_S
    EXEC -.-> SPAWN_S
    EXEC -.-> CP_S
    EXEC -.-> GATE_S
    EXEC -.-> PARA_S

    style Workflow fill:#0f172a,stroke:#8b5cf6,color:#fff
    style Engine fill:#0f172a,stroke:#10b981,color:#fff
```

---

## Storage Architecture

```mermaid
graph LR
    subgraph Interface["IStorage Interface"]
        I_TEAM[ITeamStorage]
        I_WORKER[IWorkerStorage]
        I_WORK[IWorkItemStorage]
        I_MAIL[IMailStorage]
        I_BB[IBlackboardStorage]
        I_CP[ICheckpointStorage]
        I_SQ[ISpawnQueueStorage]
        I_TLDR[ITLDRStorage]
    end

    subgraph SQLite["SQLite Implementation"]
        S_TEAM[TeamStorage]
        S_WORKER[WorkerStorage]
        S_WORK[WorkItemStorage]
        S_MAIL[MailStorage]
        S_BB[BlackboardStorage]
        S_CP[CheckpointStorage]
        S_SQ[SpawnQueueStorage]
        S_TLDR[TLDRStorage]
    end

    subgraph Future["Future Backends"]
        DDB[(DynamoDB)]
        PG[(PostgreSQL)]
        FS[(Firestore)]
        S3[(S3)]
    end

    I_TEAM --> S_TEAM
    I_WORKER --> S_WORKER
    I_WORK --> S_WORK
    I_MAIL --> S_MAIL
    I_BB --> S_BB
    I_CP --> S_CP
    I_SQ --> S_SQ
    I_TLDR --> S_TLDR

    S_TEAM --> DB[(fleet.db)]
    S_WORKER --> DB
    S_WORK --> DB
    S_MAIL --> DB
    S_BB --> DB
    S_CP --> DB
    S_SQ --> DB
    S_TLDR --> DB

    Interface -.-> Future

    style Interface fill:#1e3a5f,stroke:#38bdf8,color:#fff
    style SQLite fill:#1e3a5f,stroke:#10b981,color:#fff
    style Future fill:#374151,stroke:#6b7280,color:#9ca3af
```

---

## Blackboard Communication

```mermaid
graph TB
    subgraph Swarm["Swarm: feature-dev"]
        LEAD[Team Lead]
        SCOUT[Scout Agent]
        KRAKEN[Kraken Agent]
        REVIEW[Reviewer Agent]
    end

    subgraph Blackboard["Blackboard Messages"]
        M1[STATUS: Scout findings]
        M2[TASK: Implement feature X]
        M3[QUESTION: API design?]
        M4[RESULT: Implementation done]
        M5[CHECKPOINT: Review needed]
    end

    SCOUT -->|post| M1
    LEAD -->|post| M2
    KRAKEN -->|post| M3
    LEAD -->|reply| M3
    KRAKEN -->|post| M4
    KRAKEN -->|post| M5

    M1 -->|read| LEAD
    M2 -->|read| KRAKEN
    M4 -->|read| REVIEW
    M5 -->|read| LEAD

    style Swarm fill:#0f172a,stroke:#8b5cf6,color:#fff
    style Blackboard fill:#0f172a,stroke:#f59e0b,color:#fff
```

---

## API Route Structure

```mermaid
graph LR
    subgraph Public["Public Routes"]
        H[GET /health]
        M[GET /metrics]
        A[POST /auth]
        D[GET /debug]
    end

    subgraph Protected["Protected Routes (JWT Required)"]
        subgraph Team["Team Management"]
            T1[GET /teams/:name]
            T2[POST /teams/:name/broadcast]
        end

        subgraph Tasks["Task Operations"]
            TK1[POST /tasks]
            TK2[GET /tasks/:id]
            TK3[PATCH /tasks/:id]
        end

        subgraph Workers["Worker Control"]
            W1[GET /workers]
            W2[POST /orchestrate/spawn]
            W3[POST /orchestrate/dismiss/:handle]
        end

        subgraph Fleet["Fleet Coordination"]
            F1[GET/POST /swarms]
            F2[GET/POST /blackboard]
            F3[GET/POST /checkpoints]
            F4[GET /spawn-queue]
        end

        subgraph Workflows["Workflow Engine"]
            WF1[GET/POST /workflows]
            WF2[POST /workflows/:id/start]
            WF3[GET /executions]
            WF4[POST /steps/:id/complete]
        end
    end

    style Public fill:#10b981,stroke:#059669,color:#fff
    style Protected fill:#1e3a5f,stroke:#38bdf8,color:#fff
```

---

## Checkpoint Flow

```mermaid
sequenceDiagram
    participant Worker as Worker Agent
    participant API as Fleet API
    participant Store as Checkpoint Store
    participant Lead as Team Lead

    Worker->>API: POST /checkpoints
    Note over Worker,API: {goal, now, doneThisSession, blockers, questions}

    API->>Store: createCheckpoint()
    Store-->>API: Checkpoint ID
    API-->>Worker: Checkpoint Created

    Lead->>API: GET /checkpoints?handle=lead
    API->>Store: listCheckpoints()
    Store-->>API: Pending Checkpoints
    API-->>Lead: Checkpoint List

    Lead->>API: POST /checkpoints/:id/accept
    Note over Lead,API: Review and approve work

    API->>Store: acceptCheckpoint(id)
    Store-->>API: Updated
    API-->>Lead: Checkpoint Accepted

    Note over Worker: Worker continues with next task
```

---

## Deployment Architecture

```mermaid
graph TB
    subgraph Local["Local Development"]
        DEV[Developer Machine]
        LOCAL_DB[(fleet.db)]
        LOCAL_WORKERS[Local Workers]
    end

    subgraph Production["Production Deployment"]
        LB[Load Balancer]

        subgraph Cluster["Fleet Cluster"]
            NODE1[Fleet Node 1]
            NODE2[Fleet Node 2]
        end

        subgraph Storage["Persistent Storage"]
            PROD_DB[(PostgreSQL/DynamoDB)]
            S3_STORE[(S3 Artifacts)]
        end

        subgraph Agents["Worker Pool"]
            POOL1[Agent Pool 1]
            POOL2[Agent Pool 2]
        end
    end

    DEV --> LOCAL_DB
    DEV --> LOCAL_WORKERS

    LB --> NODE1
    LB --> NODE2

    NODE1 --> PROD_DB
    NODE2 --> PROD_DB
    NODE1 --> S3_STORE
    NODE2 --> S3_STORE

    NODE1 --> POOL1
    NODE2 --> POOL2

    style Local fill:#374151,stroke:#6b7280,color:#fff
    style Production fill:#1e3a5f,stroke:#38bdf8,color:#fff
```

---

## Technology Stack

```mermaid
mindmap
    root((Claude Fleet))
        Runtime
            Node.js 20+
            TypeScript 5.x
            ESM Modules
        Server
            Express.js
            WebSocket ws
            JWT Auth
        Storage
            SQLite better-sqlite3
            Interface Abstraction
            Multi-backend Ready
        Validation
            Zod Schemas
            Type-safe APIs
        Testing
            Vitest
            E2E Scripts
        CLI
            Node parseArgs
            Interactive Mode
        Metrics
            Prometheus
            Health Checks
```

---

## File Structure

```
claude-collab-local/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # HTTP/WS server
│   ├── cli.ts                # CLI tool
│   ├── types.ts              # Type definitions
│   │
│   ├── routes/               # API route handlers
│   │   ├── core.ts           # Health, auth, metrics
│   │   ├── chats.ts          # Teams, chats, messages
│   │   ├── tasks.ts          # Task CRUD
│   │   ├── orchestrate.ts    # Worker spawn/dismiss
│   │   ├── fleet.ts          # Blackboard, checkpoints
│   │   ├── workitems.ts      # Work items, batches
│   │   ├── mail.ts           # Inter-agent mail
│   │   ├── workflows.ts      # Workflow engine
│   │   └── tldr.ts           # Code analysis cache
│   │
│   ├── storage/              # Data persistence
│   │   ├── sqlite.ts         # SQLite implementation
│   │   ├── interfaces.ts     # Storage contracts
│   │   ├── blackboard.ts     # Swarm messaging
│   │   ├── checkpoint.ts     # Progress snapshots
│   │   ├── spawn-queue.ts    # Worker queue
│   │   ├── tldr.ts           # File summaries
│   │   └── workflow.ts       # Workflow state
│   │
│   ├── workers/              # Worker management
│   │   ├── manager.ts        # Process lifecycle
│   │   ├── spawn-controller.ts
│   │   ├── worktree.ts       # Git isolation
│   │   ├── roles.ts          # RBAC
│   │   └── workflow-engine.ts
│   │
│   ├── validation/           # Input validation
│   │   └── schemas.ts        # Zod schemas
│   │
│   ├── middleware/           # Express middleware
│   │   └── auth.ts           # JWT validation
│   │
│   └── metrics/              # Observability
│       └── prometheus.ts
│
├── scripts/                  # E2E tests, utilities
├── tests/                    # Unit tests
└── docs/                     # Documentation
```

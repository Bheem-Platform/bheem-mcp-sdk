# Bheem MCP Server Template

Starter template for building agents on the Bheem Platform. Includes persistent memory, scoped skills, remote server operations, and per-agent access control.

## Quick Start

```bash
# 1. Clone this template
git clone https://github.com/Bheem-Platform/bheem-mcp-sdk.git my-module-mcp
cd my-module-mcp

# 2. Configure
cp .env.example .env
# → set MCP_PORT, MCP_EXTERNAL_URL, BACKEND_API_URL, ORCHESTRATOR_URL

# 3. Install & run
npm install
npm run dev

# 4. Verify
curl http://<YOUR_SERVER_IP>:9012/health
```

Your MCP server is running. Templates auto-register with the orchestrator on boot.

## What's Included

| Feature | Description | Files |
|---------|-------------|-------|
| **Domain Tools** | One tool per domain with action routing (`items`, `analytics`) | `src/tools/items.ts`, `src/tools/analytics.ts` |
| **Workspace Memory** | Persistent key-value facts across sessions, scoped per module/user/agent | `src/memory/` |
| **Remote Operations** | SSH-based access to all 9 Bheem servers with per-agent permissions | `src/tools/remote-ops.ts` |
| **Scoped Skills** | Only inject relevant platform skills per agent (not all 50+) | `src/templates/index.ts` |
| **Agent Templates** | Self-registering templates with skills, memory, and remote ops | `src/templates/index.ts` |

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│              Your MCP Server (:9012)                        │
│                                                             │
│  Domain Tools (3-5)     Memory Tools (4)    Remote Ops (6) │
│  ┌────────────────┐    ┌──────────────┐    ┌─────────────┐ │
│  │ items           │    │ memory_set    │    │ remote_exec │ │
│  │ analytics       │    │ memory_get    │    │ remote_read │ │
│  │ [your domain]   │    │ memory_list   │    │ remote_write│ │
│  │                 │    │ memory_delete │    │ remote_edit │ │
│  └────────────────┘    └──────────────┘    │ remote_ls   │ │
│                              │              │ remote_health│ │
│                         ┌────┴────┐        └──────┬──────┘ │
│                         │ Cache + │              SSH│        │
│                         │ Postgres│                │        │
│                         └─────────┘         ┌──────┴──────┐ │
│                                             │ 9 Servers   │ │
│  Agent Templates (auto-register on boot)    │ Access Ctrl │ │
│  ┌───────────────────────────────────────┐  └─────────────┘ │
│  │ my-module-assistant  (SDK, free)       │                  │
│  │ my-module-deep-agent (PEV, pro)        │                  │
│  │ devops-engineer      (SDK, pro)        │                  │
│  └───────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────┘
         │                              │
    auto-register                  MCP calls
         ▼                              ▼
  Bheem Orchestrator            Any Bheem Agent
```

## Three Tool Layers

| Layer | Tools | Purpose | When to Use |
|-------|-------|---------|-------------|
| **SDK Tools** (`allowedTools`) | `bash`, `read`, `write`, `edit` | General-purpose local ops | Shell commands, file I/O, git, npm |
| **MCP Domain Tools** (`mcpServers`) | `items`, `analytics`, `memory_*` | Structured backend APIs | CRUD, business logic, persistence |
| **Remote Ops** (MCP) | `remote_exec/read/write/edit/ls/health` | SSH to remote servers | Cross-server ops, infra management |

## Creating Your Agent (3 Steps)

### Step 1: Create a Domain Tool

```typescript
// src/tools/orders.ts — ONE tool, multiple actions
export const orderTools: McpToolDefinition[] = [{
  name: 'orders',
  description: `Order management. Actions: list, get, create, cancel, refund`,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'get', 'create', 'cancel', 'refund'] },
      params: { type: 'object' },
    },
    required: ['action'],
  },
  execute: async (input, context) => {
    const scope = getUserScope(context);
    // ... switch on input.action
  },
}];
```

### Step 2: Create a Template

```typescript
// src/templates/index.ts
{
  id: 'order-assistant',
  name: 'Order Assistant',
  orchestrator: 'sdk',
  model: 'auto',
  mcpServers: { orders: { type: 'http', url: MCP_URL } },
  allowedTools: [],
  skills: ['slack', 'trello'],
  systemPrompt: `You are an order management assistant.
## Tools
- orders({ action: 'list' }) — List orders
- memory_set({ key: 'x', value: 'y' }) — Store a fact
NEVER use curl or raw HTTP calls.`,
}
```

### Step 3: Deploy

```bash
npm run build
pm2 start dist/index.js --name my-module-mcp
# Templates auto-register. Agent is immediately available.
```

## File Structure

```
src/
├── index.ts                    # Server + memory + remote ops + template registration
├── tools/
│   ├── items.ts                # Domain tool (example)
│   ├── analytics.ts            # Domain tool (example)
│   └── remote-ops.ts           # Remote server operations (6 tools, SSH, access control)
├── memory/
│   ├── index.ts                # Barrel exports
│   ├── workspace-memory-store.ts  # Cache + PostgreSQL write-through
│   ├── memory-tools.ts         # 4 MCP tools (set/get/list/delete)
│   ├── schema.ts               # TypeScript types
│   └── schema.sql              # PostgreSQL migration
├── templates/
│   └── index.ts                # Agent templates with skills (auto-register on boot)
└── utils/
    ├── api-client.ts           # Axios client for your backend
    └── scope.ts                # Auth helpers (role, userId, module, templateId)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `9012` | Server port |
| `MCP_EXTERNAL_URL` | — | **Required.** Reachable URL (e.g. `http://10.0.0.5:9012/mcp`) |
| `BACKEND_API_URL` | — | **Required.** Your backend API base URL |
| `ORCHESTRATOR_URL` | `https://agents.agentbheem.com` | Orchestrator for template registration |
| `DATABASE_URL` | — | Optional. PostgreSQL for persistent memory |
| `SSH_KEY_PATH` | `~/.ssh/sundeep` | SSH key for remote operations |
| `SSH_USER` | `root` | SSH user for remote connections |
| `MCP_AUTH_TOKEN` | — | Optional auth token for MCP endpoints |

## Developer Rules

1. **Max 5 domain tools per module** — use `action` param for routing
2. **No URLs in system prompts** — reference tool names and actions only
3. **No `Bash`/`curl` for API calls** — use MCP domain tools
4. **Every tool checks auth** — `getUserScope(context)` in every execute
5. **Templates self-register** — via `registerTemplatesWithOrchestrator()`
6. **Scope skills per agent** — `skills: [...]` to avoid token waste
7. **Include memory tools** — wire up `WorkspaceMemoryStore` in `index.ts`
8. **Use `model: 'auto'`** — let the platform choose the best model

## Port Assignments

| Port | MCP Server | Status |
|------|-----------|--------|
| 9006 | Academy | Built |
| 9008 | SocialSelling | Running |
| 9009 | Trading | Built |
| 9010 | Cloud | Running |
| 9011 | Workspace | Running |
| 9012+ | **Your new MCP** | Available |
| 9015 | Remote Ops | Planned |

## Further Reading

- **[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)** — Detailed guide: tools, memory, skills, auth, templates, testing
- **[DEVOPS_AGENT_PLAN.md](./DEVOPS_AGENT_PLAN.md)** — Agentic capabilities: `allowedTools`, permission tiers, remote ops, agent examples

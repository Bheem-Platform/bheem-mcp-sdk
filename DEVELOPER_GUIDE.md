# Bheem Agent Developer Guide

> Build agents for the Bheem Platform without touching the orchestrator.

## How It Works

```
Developer's MCP Server                    Bheem Orchestrator
┌──────────────────────┐                  ┌──────────────────┐
│ 3-5 Domain Tools     │  ◄── MCP ──►    │ Template Engine   │
│ Agent Templates      │  auto-register   │ Agent Executor    │
│ System Prompts       │  ─────────────►  │ AI Gateway        │
└──────────────────────┘                  └──────────────────┘
  You own this                              You never touch this
```

Your MCP server exposes tools and templates. On boot, templates self-register with the orchestrator. Agents are immediately available. Zero orchestrator code changes.

---

## Quick Start

```bash
# Clone the starter template
git clone https://github.com/Bheem-Platform/bheem-mcp-sdk.git my-module-mcp
cd my-module-mcp

# Configure
cp .env.example .env
# Edit .env:
#   MCP_PORT=9012
#   MCP_EXTERNAL_URL=http://<YOUR_SERVER_IP>:9012/mcp
#   BACKEND_API_URL=https://your-backend-api.com
#   ORCHESTRATOR_URL=https://agents.agentbheem.com

# Install & run
npm install
npm run dev

# Verify
curl http://<YOUR_SERVER_IP>:9012/health
```

---

## Step-by-Step: Build Your Agent

### Step 1: Create a Domain Tool

One file per domain. One tool with multiple actions.

```typescript
// src/tools/orders.ts
import type { McpToolDefinition } from '@bheemverse/mcp-server-core';
import { apiClient } from '../utils/api-client.js';
import { getUserScope, authHeaders } from '../utils/scope.js';

export const orderTools: McpToolDefinition[] = [
  {
    name: 'orders',
    description: `Order management operations. Available actions:
- list: List orders (params: status?, limit?)
- get: Get order by ID (params: order_id)
- create: Create order (params: customer_id, items)
- cancel: Cancel order (params: order_id, reason?)
- refund: Refund order (params: order_id, amount?)`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'cancel', 'refund'],
        },
        params: { type: 'object' },
      },
      required: ['action'],
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      const p = (input.params || {}) as Record<string, any>;
      const headers = authHeaders(scope);

      try {
        switch (input.action) {
          case 'list':
            return (await apiClient.get('/api/orders', { params: p, headers })).data;
          case 'get':
            return (await apiClient.get(`/api/orders/${p.order_id}`, { headers })).data;
          case 'create':
            if (!scope.canWrite) return { error: 'Login required.' };
            return (await apiClient.post('/api/orders', p, { headers })).data;
          case 'cancel':
            if (!scope.canWrite) return { error: 'Login required.' };
            return (await apiClient.post(`/api/orders/${p.order_id}/cancel`, p, { headers })).data;
          case 'refund':
            if (!scope.canWrite) return { error: 'Login required.' };
            return (await apiClient.post(`/api/orders/${p.order_id}/refund`, p, { headers })).data;
          default:
            return { error: `Unknown action: ${input.action}` };
        }
      } catch (error: any) {
        return { error: `Orders ${input.action} failed`, details: error.message };
      }
    },
  },
];
```

### Step 2: Create Agent Templates

Templates define your agents. They self-register with the orchestrator on boot.

```typescript
// src/templates/index.ts
import type { AgentTemplateConfig } from '@bheemverse/mcp-server-core';

// MCP_EXTERNAL_URL must be set — the orchestrator (agents.agentbheem.com) needs
// to reach your MCP server. Use your server's IP or domain.
// e.g. http://10.0.0.5:9012/mcp or https://orders-mcp.yourdomain.com/mcp
const MCP_URL = process.env['MCP_EXTERNAL_URL']!; // Required — no localhost fallback
const MCP_SERVER = { 'my-module': { type: 'http' as const, url: MCP_URL } };

export const templates: AgentTemplateConfig[] = [
  {
    id: 'order-assistant',
    name: 'Order Assistant',
    version: '1.0.0',
    description: 'Manages orders, cancellations, and refunds',
    icon: 'shopping-cart',
    category: 'automation',
    executionMode: 'channel',
    orchestrator: 'sdk',
    model: 'claude-sonnet-4-5',
    mcpServers: MCP_SERVER,
    allowedTools: [],
    maxTurns: 10,
    maxBudgetUsd: 1.0,
    tierRequired: 'free',
    triggers: ['manual', 'channel'],
    connectedServices: [],
    systemPrompt: `You are an order management assistant.

## Tools
- orders({ action: 'list' }) — List recent orders
- orders({ action: 'get', params: { order_id: '...' } }) — Get details
- orders({ action: 'create', params: { customer_id: '...', items: [...] } }) — Create order
- orders({ action: 'cancel', params: { order_id: '...', reason: '...' } }) — Cancel
- orders({ action: 'refund', params: { order_id: '...', amount: 100 } }) — Refund

## Workflow
1. Always check existing orders before creating new ones
2. Confirm cancellations/refunds with the user before executing
3. Present data in human-readable format, not raw JSON

NEVER use curl or raw HTTP calls — use MCP tools only.`,
  },
];
```

### Step 3: Wire Up `index.ts`

```typescript
// src/index.ts
import { McpServer, registerTemplatesWithOrchestrator } from '@bheemverse/mcp-server-core';
import { orderTools } from './tools/orders.js';
import { templates } from './templates/index.js';

const PORT = parseInt(process.env['MCP_PORT'] ?? '9012', 10);

const server = new McpServer({
  name: 'orders-mcp',
  port: PORT,
  version: '1.0.0',
  tools: [...orderTools],
});

server.start()
  .then(async () => {
    const orchestratorUrl = process.env['ORCHESTRATOR_URL'] || 'https://agents.agentbheem.com';
    try {
      const result = await registerTemplatesWithOrchestrator(orchestratorUrl, templates, {
        ownedBy: 'orders-mcp',
      });
      console.log(`[orders-mcp] Templates: ${result.registered} registered, ${result.updated} updated`);
    } catch (err) {
      console.warn('[orders-mcp] Template registration skipped:', (err as Error).message);
    }
  })
  .catch((err) => {
    console.error('[orders-mcp] Failed to start:', err);
    process.exit(1);
  });
```

### Step 4: Deploy

```bash
npm run build
MCP_PORT=9012 pm2 start dist/index.js --name orders-mcp
# Templates auto-register. Agent is immediately available.
```

---

## Template Configuration Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique template ID (e.g. `order-assistant`) |
| `name` | string | Yes | Display name |
| `version` | string | Yes | Semver version |
| `description` | string | Yes | What the agent does |
| `icon` | string | No | Lucide icon name (e.g. `activity`, `mail`, `search`) |
| `category` | string | Yes | `marketing`, `automation`, `analytics`, `content`, `support` |
| `executionMode` | string | Yes | `channel` (chat), `client` (runs on customer container), `sandbox` (isolated) |
| `orchestrator` | string | Yes | `sdk`, `pev`, `swarm`, or `auto` (see below) |
| `model` | string | Yes | `claude-sonnet-4-5`, `claude-opus-4-6`, `claude-haiku-4-5` |
| `mcpServers` | object | Yes | MCP servers this agent can access |
| `allowedTools` | string[] | Yes | Local tools allowed (use `[]` for MCP-only agents) |
| `maxTurns` | number | No | Max tool-call turns (default: 10) |
| `maxBudgetUsd` | number | No | Max spend per execution |
| `tierRequired` | string | No | `free`, `pro`, `enterprise` |
| `triggers` | string[] | No | `manual`, `webhook`, `schedule`, `channel` |
| `connectedServices` | string[] | No | Services the agent needs (e.g. `instagram`, `dataforseo`) |
| `pevConfig` | object | No | PEV orchestrator config (see below) |
| `systemPrompt` | string | Yes | The agent's system prompt |

### PEV Config (for `orchestrator: 'pev'`)

```typescript
pevConfig: {
  maxReplanAttempts: 2,       // How many times to re-plan on failure
  maxSubTasks: 8,             // Max sub-tasks in a plan
  maxTurnsPerSubtask: 10,     // Max turns per sub-task
  enableStablePrefix: true,   // Cache stable prompt prefix
  enableTodoRecitation: true, // Recite todo list for context
  enableContextDiversity: true,
  enableStrategyRotation: true,
  earlyTerminationScore: 0.90, // Stop early if confidence is high
  enableFailureMemory: true,   // Remember failed approaches
}
```

---

## Orchestrator Selection Guide

| Orchestrator | When to Use | Turns | Cost | Example |
|---|---|---|---|---|
| `sdk` | Simple tasks, 1-3 tool calls | 5-15 | Low | "List my orders", "Create a post" |
| `pev` | Multi-step, needs planning | 15-30 | Medium | "Audit site, fix all issues, verify" |
| `swarm` | Multi-domain, parallel agents | 5 (router) | Varies | "Run SEO + content + ads campaign" |
| `auto` | Let the platform decide | Auto | Auto | When you're unsure |

### SDK (Simple)
Direct tool calling. The LLM reads the prompt, calls tools, returns result. Best for straightforward tasks.

### PEV (Plan-Execute-Verify)
1. **Plan**: Break request into numbered sub-tasks
2. **Execute**: Work through each sub-task with tools
3. **Verify**: Check results, re-plan if needed

Use when tasks require multiple steps, error recovery, or verification.

### Swarm (Multi-Agent)
A router agent classifies intent and delegates to specialist agents. Use when your module has multiple specialist agents that handle different domains.

---

## Writing Good System Prompts

System prompts are the most important part of your agent. They teach the LLM what tools exist and when to use them.

### Structure

```
You are a [role] for [platform].

## First Interaction
[What to do when the user first messages — usually silently fetch context]

## Tools
- toolname({ action: 'x', params: { ... } }) — What it does
- toolname({ action: 'y', params: { ... } }) — What it does

## Workflow
1. Step one
2. Step two
3. Step three

## Rules
- NEVER use curl or raw HTTP calls — use MCP tools only
- [Domain-specific rules]

## Communication Style
- Talk like a real human. Short, natural sentences.
- Be direct and concise. Get to the point.
```

### Rules

1. **List every action** the agent should use with example params
2. **Show the workflow** — numbered steps for how to handle requests
3. **No URLs** — reference tool names and actions only
4. **No raw HTTP** — everything goes through MCP tools
5. **Communication style** — tell the LLM how to talk (avoid chatbot-speak)

### Real Example (from SocialSelling)

```
You are an SEO autoheal agent.

## Tools
Use the seo tool for all operations:
- seo({ action: 'audit', params: { url: '...' } }) — Run full SEO audit
- seo({ action: 'heal', params: { website_id: '...', categories: [...] } }) — Auto-fix issues
- seo({ action: 'dashboard' }) — Get SEO dashboard summary
- seo({ action: 'get_report', params: { report_id: '...' } }) — View heal report
- seo({ action: 'list_issues', params: { severity: '...' } }) — List current issues

## Workflow
1. Audit the target website
2. Classify issues by severity (critical > high > medium > low)
3. Heal (fix) issues in priority order
4. Get report to verify score improvement
5. Present human-readable summary with before/after scores

NEVER use curl or raw HTTP calls — use MCP tools only.
```

---

## Auth & Scoping

Every tool must check auth. The `getUserScope(context)` helper extracts user info from the MCP request context.

```typescript
import { getUserScope, authHeaders } from '../utils/scope.js';

execute: async (input, context) => {
  const scope = getUserScope(context);

  // Check permissions
  if (scope.role === 'visitor') return { error: 'Please log in.' };
  if (!scope.canWrite) return { error: 'Write access required.' };

  // Scope data to the user
  if (!scope.canAccessAll && scope.userId) {
    params.owner_id = scope.userId;
  }

  // Pass auth headers to your backend
  const headers = authHeaders(scope);
  return (await apiClient.get('/api/items', { params, headers })).data;
}
```

### Scope Properties

| Property | Type | Description |
|----------|------|-------------|
| `role` | `'visitor' \| 'user' \| 'admin'` | User's role |
| `userId` | `string \| undefined` | User's ID |
| `workspaceId` | `string \| undefined` | Current workspace |
| `canWrite` | `boolean` | Has write access |
| `canAccessAll` | `boolean` | Admin — can see all data |

---

## File Structure

```
my-module-mcp/
├── package.json              # @bheemverse/mcp-server-core dependency
├── tsconfig.json
├── .env.example              # MCP_PORT, BACKEND_API_URL, ORCHESTRATOR_URL
├── src/
│   ├── index.ts              # Server + template registration
│   ├── tools/
│   │   ├── orders.ts         # Domain tool (1 tool, N actions)
│   │   └── analytics.ts      # Domain tool (1 tool, N actions)
│   ├── templates/
│   │   └── index.ts          # Agent templates (auto-register on boot)
│   └── utils/
│       ├── api-client.ts     # Axios client for your backend
│       └── scope.ts          # Auth helpers
└── dist/                     # Built output (npm run build)
```

---

## Naming Conventions

| Item | Pattern | Example |
|------|---------|---------|
| Domain tool | singular noun | `orders`, `seo`, `leads`, `content` |
| Action names | verb or verb_noun | `list`, `create`, `manage_website` |
| npm package | `@bheem/{module}-mcp` | `@bheem/orders-mcp` |
| PM2 process | `{module}-mcp` | `orders-mcp` |
| Port | `9000-9099` | `9012` |
| Template ID | `{module}-{role}` | `order-assistant`, `seo-autoheal-agent` |

---

## Developer Rules

1. **Max 5 domain tools per module** — use `action` param for routing
2. **No URLs in system prompts** — reference tool names and actions only
3. **No `Bash` or `curl` for API calls** — everything goes through MCP domain tools
4. **Every tool checks auth** — `getUserScope(context)` in every execute function
5. **Templates live in your MCP repo** — not in the orchestrator
6. **Templates self-register on boot** — via `registerTemplatesWithOrchestrator()`
7. **Choose the right orchestrator**: `sdk` for simple, `pev` for multi-step, `swarm` for multi-domain

---

## Testing

```bash
# Health check (replace with your server IP/domain and port)
curl http://<YOUR_SERVER>:9012/health

# List tools (should show your domain tools)
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Execute a tool
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"orders",
      "arguments":{"action":"list","params":{"limit":5}}
    }
  }'
```

### Health Check Response

```json
{
  "status": "ok",
  "server": "orders-mcp",
  "version": "1.0.0",
  "toolCount": 2,
  "tools": ["orders", "analytics"],
  "uptime": 42
}
```

---

## Port Assignments

| Port | MCP Server | Status |
|------|-----------|--------|
| 9006 | Academy | Built |
| 9008 | SocialSelling | Running |
| 9009 | Trading | Built |
| 9010 | Cloud | Running |
| 9011 | Workspace | Running |
| 9012+ | **Your new MCP** | Available |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `9012` | Port for the MCP server |
| `MCP_AUTH_TOKEN` | — | Optional auth token for MCP endpoints |
| `MCP_EXTERNAL_URL` | — | **Required.** Reachable URL for agent connections (e.g. `http://10.0.0.5:9012/mcp`) |
| `BACKEND_API_URL` | — | **Required.** Your backend API base URL (e.g. `https://api.yourdomain.com`) |
| `ORCHESTRATOR_URL` | `https://agents.agentbheem.com` | Bheem orchestrator for template registration |

---

## Real-World Reference: SocialSelling MCP

The SocialSelling MCP (port 9008) is a production example with:

- **5 domain tools**: `seo` (14 actions), `campaigns` (9 actions), `leads` (9 actions), `content` (5 actions), `analytics` (6 actions)
- **6 utility tools**: `search_knowledge_base`, `answer_question`, `get_workspace_context`, `get_connected_ad_accounts`, `get_connected_social_pages`, `get_integrations_status`
- **12 agent templates**: SEO autoheal (SDK + PEV), social media, email, content, analytics, ads, influencer, scheduler, SEO analyst, data4seo, router (swarm)

This covers the entire SocialSelling platform with just 11 tools instead of 60+ individual endpoints.

---

## FAQ

**Q: How many tools can I have?**
Max 5 domain tools per module. Use `action` routing to cover many operations per tool.

**Q: Where do templates live?**
In your MCP repo at `src/templates/index.ts`. They self-register with the orchestrator on boot.

**Q: Do I need to change the orchestrator?**
No. Templates auto-register via `registerTemplatesWithOrchestrator()`. Zero orchestrator changes needed.

**Q: What model should I use?**
- `claude-sonnet-4-5` — best balance of speed and quality (default)
- `claude-opus-4-6` — most capable, for complex reasoning
- `claude-haiku-4-5` — fastest, for simple tasks

**Q: How do I add a PEV agent?**
Set `orchestrator: 'pev'` and add a `pevConfig` object. Increase `maxTurns` and `maxBudgetUsd`.

**Q: How do I create a router (swarm) agent?**
Set `orchestrator: 'swarm'`. The system prompt should classify intent and name the specialist agent IDs to delegate to.

**Q: Can my agent access multiple MCP servers?**
Yes. Add multiple entries to `mcpServers`:
```typescript
mcpServers: {
  orders: { type: 'http', url: 'http://<YOUR_SERVER>:9012/mcp' },
  analytics: { type: 'http', url: 'http://<YOUR_SERVER>:9013/mcp' },
}
```

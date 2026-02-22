# Bheem MCP Server Template

Starter template for building agents on the Bheem Platform.

## Quick Start

```bash
# 1. Clone this template
git clone https://github.com/Bheem-Platform/bheem-mcp-sdk.git my-module-mcp
cd my-module-mcp

# 2. Configure
cp .env.example .env
# → set MCP_PORT, BACKEND_API_URL

# 3. Install & run
npm install
npm run dev

# 4. Verify
curl http://localhost:9012/health
```

Your MCP server is running. Templates auto-register with the orchestrator on boot.

## Architecture (Claude Code Style)

Claude Code has ~10 tools but does everything. We follow the same pattern:

```
CLAUDE CODE:                         YOUR AGENT:
┌────────────────┐                   ┌────────────────┐
│ Bash   → any cmd│                  │ items → any CRUD│
│ Read   → any file│                 │ analytics → any metric│
│ Write  → any file│                 │ orders → any order op│
│ Grep   → any search│              │                │
│                │                   │                │
│ ~10 tools total│                   │ 3-5 tools total│
│ System prompt  │                   │ System prompt  │
│ teaches when   │                   │ teaches when   │
│ to use each    │                   │ to use each    │
└────────────────┘                   └────────────────┘
```

**ONE tool per domain. Actions via `action` parameter. System prompt teaches the workflow.**

## Creating Your Agent (3 Steps)

### Step 1: Create a Domain Tool

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

### Step 2: Create a Template

```typescript
// src/templates/index.ts
import type { AgentTemplateConfig } from '@bheemverse/mcp-server-core';

export const templates: AgentTemplateConfig[] = [
  {
    id: 'order-assistant',
    name: 'Order Assistant',
    version: '1.0.0',
    description: 'Manages orders, cancellations, and refunds',
    category: 'automation',
    executionMode: 'channel',
    orchestrator: 'sdk',         // Simple tasks
    model: 'claude-sonnet-4-5',
    mcpServers: {
      orders: { type: 'http', url: 'http://localhost:9012/mcp' }
    },
    allowedTools: [],             // Everything via MCP
    systemPrompt: `You are an order management assistant.

## Tools
- orders({ action: 'list' }) — List recent orders
- orders({ action: 'get', params: { order_id: '...' } }) — Get details
- orders({ action: 'cancel', params: { order_id: '...', reason: '...' } }) — Cancel

NEVER use curl or raw HTTP calls.`,
  },
];
```

### Step 3: Deploy

```bash
npm run build
pm2 start dist/index.js --name my-module-mcp
# Templates auto-register. Agent is immediately available.
```

## Developer Rules

1. **Max 5 domain tools per module** — use `action` param for routing
2. **No URLs in system prompts** — reference tool names and actions only
3. **No `Bash` tool for API calls** — everything goes through MCP domain tools
4. **Every tool checks auth** — `getUserScope(context)` in every execute function
5. **Templates live here** — not in the orchestrator repo
6. **Templates self-register on boot** — via `registerTemplatesWithOrchestrator()`
7. **Orchestrator type per complexity**: `sdk` for simple, `pev` for multi-step, `swarm` for multi-domain

## Orchestrator Selection Guide

| Task Complexity | Orchestrator | Example |
|---|---|---|
| Simple (1-3 tool calls) | `sdk` | "List my orders" |
| Multi-step (planning needed) | `pev` | "Audit site, fix issues, verify" |
| Multi-domain (parallel agents) | `swarm` | "SEO + content + ads campaign" |
| Let platform decide | `auto` | When unsure |

## Naming Conventions

| Item | Pattern | Example |
|---|---|---|
| Domain tool | singular noun | `orders`, `seo`, `leads` |
| Action names | verb or verb_noun | `list`, `create`, `manage_website` |
| MCP package | `@bheem/{module}-mcp` | `@bheem/orders-mcp` |
| PM2 process | `{module}-mcp` | `orders-mcp` |
| Port | 9000-9099 | `9012` |
| Template ID | `{module}-{role}-agent` | `order-assistant` |

## File Structure

```
src/
├── index.ts              # Server + template registration
├── tools/
│   ├── items.ts          # Domain tool (example)
│   └── analytics.ts      # Domain tool (example)
├── templates/
│   └── index.ts          # Agent templates (auto-register on boot)
└── utils/
    ├── api-client.ts     # Axios client for your backend
    └── scope.ts          # Auth helpers
```

## Testing

```bash
# Health check
curl http://localhost:9012/health

# List tools
curl -X POST http://localhost:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Execute a tool
curl -X POST http://localhost:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"items","arguments":{"action":"list","params":{"limit":5}}}
  }'
```

## Port Assignments

| Port | MCP Server | Status |
|------|-----------|--------|
| 9006 | Academy | Built |
| 9008 | SocialSelling | Running |
| 9009 | Trading | Built |
| 9010 | Cloud | Running |
| 9011 | Workspace | Running |
| 9012+ | **Your new MCP** | Available |

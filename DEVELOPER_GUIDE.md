# Bheem Agent Developer Guide

> Build and deploy AI agents on the Bheem Platform.

## How It Works

```
Developer's MCP Server                    Bheem Agent Platform
┌──────────────────────┐                  ┌──────────────────┐
│ 3-5 Domain Tools     │  ◄── MCP ──►    │ Template Engine   │
│ Memory Tools (4)     │  auto-register   │ Agent Executor    │
│ Remote Ops Tools (6) │  ─────────────►  │ AI Gateway        │
│ Agent Templates      │                  │ Skills Loader     │
│ Skills (scoped)      │                  │                   │
└──────────────────────┘                  └──────────────────┘
```

Your MCP server exposes tools and templates. On boot, templates self-register with the platform. Agents are immediately available.

**Features**: Persistent memory (facts that survive across sessions), scoped skills (only relevant platform skills per agent), remote ops (SSH access to all servers with per-agent access control).

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

Templates define your agents. They self-register with the platform on boot.

```typescript
// src/templates/index.ts
import type { AgentTemplateConfig } from '@bheemverse/mcp-server-core';

// Extended type with skills support
interface AgentTemplateWithSkills extends AgentTemplateConfig {
  skills?: string[];  // Only inject these platform skills (omit = all skills)
}

const MCP_URL = process.env['MCP_EXTERNAL_URL']!;
const MCP_SERVER = { 'my-module': { type: 'http' as const, url: MCP_URL } };

export const templates: AgentTemplateWithSkills[] = [
  {
    id: 'order-assistant',
    name: 'Order Assistant',
    version: '1.0.0',
    description: 'Manages orders, cancellations, and refunds',
    icon: 'shopping-cart',
    category: 'automation',
    executionMode: 'channel',
    orchestrator: 'sdk',
    model: 'auto',
    mcpServers: MCP_SERVER,
    allowedTools: [],
    maxTurns: 10,
    maxBudgetUsd: 1.0,
    tierRequired: 'free',
    triggers: ['manual', 'channel'],
    connectedServices: [],
    skills: ['slack', 'trello'],  // Only relevant skills (not all 50+)
    systemPrompt: `You are an order management assistant.

## Tools
- orders({ action: 'list' }) — List recent orders
- orders({ action: 'get', params: { order_id: '...' } }) — Get details
- orders({ action: 'create', params: { customer_id: '...', items: [...] } }) — Create order
- orders({ action: 'cancel', params: { order_id: '...', reason: '...' } }) — Cancel
- orders({ action: 'refund', params: { order_id: '...', amount: 100 } }) — Refund

## Memory
- memory_set({ key: 'preferred_carrier', value: 'FedEx' }) — Remember a fact
- memory_get({ key: 'preferred_carrier' }) — Recall a fact
- memory_list({}) — List all known facts
- memory_delete({ key: 'preferred_carrier' }) — Forget a fact

## Workflow
1. Check memory_list for known context before asking the user
2. Always check existing orders before creating new ones
3. Confirm cancellations/refunds with the user before executing
4. When the user shares a preference, store it with memory_set
5. Present data in human-readable format, not raw JSON

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
import { WorkspaceMemoryStore, createMemoryTools } from './memory/index.js';
import { createRemoteOpsTools } from './tools/remote-ops.js';

const PORT = parseInt(process.env['MCP_PORT'] ?? '9012', 10);
const DATABASE_URL = process.env['DATABASE_URL'] || undefined;

// Initialize memory store (DB optional — falls back to in-memory)
const memoryStore = new WorkspaceMemoryStore(DATABASE_URL);
const memoryTools = createMemoryTools(memoryStore);

// Remote ops (SSH to all Bheem servers with per-agent access control)
const remoteOpsTools = createRemoteOpsTools();

const server = new McpServer({
  name: 'orders-mcp',
  port: PORT,
  version: '1.0.0',
  tools: [
    ...orderTools,
    ...memoryTools,     // memory_set, memory_get, memory_list, memory_delete
    ...remoteOpsTools,  // remote_exec, remote_read, remote_write, remote_edit, remote_ls, remote_health
  ],
});

(async () => {
  await memoryStore.init();  // Connect to DB (if DATABASE_URL set)
  await server.start();

  const orchestratorUrl = process.env['ORCHESTRATOR_URL'] || 'https://agents.agentbheem.com';
  try {
    const result = await registerTemplatesWithOrchestrator(orchestratorUrl, templates, {
      ownedBy: 'orders-mcp',
    });
    console.log(`[orders-mcp] Templates: ${result.registered} registered, ${result.updated} updated`);
  } catch (err) {
    console.warn('[orders-mcp] Template registration skipped:', (err as Error).message);
  }
})().catch((err) => {
  console.error('[orders-mcp] Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown — close DB pool
process.on('SIGTERM', async () => { await memoryStore.close(); process.exit(0); });
process.on('SIGINT', async () => { await memoryStore.close(); process.exit(0); });
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
| `orchestrator` | string | Yes | `sdk` (use SDK for all agents) |
| `model` | string | Yes | `auto` — let the platform choose the best model |
| `mcpServers` | object | Yes | MCP servers this agent can access |
| `allowedTools` | string[] | Yes | SDK tools allowed: `['bash', 'read', 'write', 'edit']` or `[]` for MCP-only |
| `maxTurns` | number | No | Max tool-call turns (default: 10) |
| `maxBudgetUsd` | number | No | Max spend per execution |
| `tierRequired` | string | No | `free`, `pro`, `enterprise` |
| `triggers` | string[] | No | `manual`, `webhook`, `schedule`, `channel` |
| `connectedServices` | string[] | No | Services the agent needs (e.g. `instagram`, `dataforseo`) |
| `skills` | string[] | No | Platform skills to inject (e.g. `['github', 'slack']`). Omit for all skills. |
| `pevConfig` | object | No | Reserved for future PEV execution support |
| `systemPrompt` | string | Yes | The agent's system prompt |

---

## Execution

All agents use the **SDK** execution mode. The platform handles tool calling, model selection, and execution.

```typescript
orchestrator: 'sdk',
model: 'auto',        // Let the platform choose the best model
```

Set `model: 'auto'` — the platform selects the best model automatically.

---

## Workspace Memory

Agents have persistent memory that survives across sessions. When a user says "my domain is example.com", the agent stores that fact. Next session, the agent already knows it.

### How It Works

```
┌─────────────────────────────────────┐
│         System Prompt               │
│  ┌───────────────────────────────┐  │
│  │ <workspace_memory>            │  │  Auto-injected (~500 token budget)
│  │   - domain: example.com      │  │
│  │   - cms: wordpress 6.4       │  │
│  │ </workspace_memory>           │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ## Tools                      │  │
│  │   orders, analytics, memory   │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
          ▲                ▲
          │                │
  getContextBlock()    MCP tools (memory_get/set/list/delete)
          │                │
┌─────────────────────────────────────┐
│     WorkspaceMemoryStore            │
│  ┌──────────┐  ┌─────────────────┐  │
│  │ In-Memory │  │  PostgreSQL     │  │  Cache + DB write-through
│  │   Cache   │←→│  (optional)     │  │
│  └──────────┘  └─────────────────┘  │
└─────────────────────────────────────┘
```

- **With `DATABASE_URL`**: Memories persist in PostgreSQL (production)
- **Without `DATABASE_URL`**: Memories live in-memory only (dev — lost on restart)

### Memory Scopes

Memories are scoped by module, user, and agent. The scope is auto-resolved from MCP request claims — the agent never builds scope keys manually.

| Scope | Key Format | Example | Use Case |
|-------|-----------|---------|----------|
| `module` | `mod:{moduleId}` | `mod:socialselling` | Shared settings for all users in a module |
| `user` | `mod:{moduleId}:user:{userId}` | `mod:socialselling:user:123` | Per-user facts (default) |
| `agent` | `mod:{moduleId}:agent:{templateId}` | `mod:socialselling:agent:seo-agent` | Agent-specific learned patterns |

**Existing modules**: socialselling, trading, cloud, workspace, academy, sandbox

### Memory Tools

4 MCP tools are included automatically when you wire up the memory store:

| Tool | Input | Description |
|------|-------|-------------|
| `memory_set` | `{ key, value, scope? }` | Store or update a fact |
| `memory_get` | `{ key, scope? }` | Retrieve a stored fact |
| `memory_list` | `{ scope? }` | List all stored facts |
| `memory_delete` | `{ key, scope? }` | Remove a fact |

The `scope` parameter is optional and defaults to `user`. Claims provide `module`, `user_id`, and `template_id` automatically.

### Setup

**1. Install the `pg` dependency** (already included in the template):

```bash
npm install pg
npm install -D @types/pg
```

**2. Set `DATABASE_URL` in `.env`** (optional — skip for dev):

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
```

**3. Run the migration** (if using PostgreSQL):

```bash
npm run migrate
# or manually: psql $DATABASE_URL -f src/memory/schema.sql
```

**4. Wire up in `index.ts`** (already done in the template):

```typescript
import { WorkspaceMemoryStore, createMemoryTools } from './memory/index.js';

const memoryStore = new WorkspaceMemoryStore(process.env['DATABASE_URL']);
const memoryTools = createMemoryTools(memoryStore);

// Add memoryTools to your server's tools array
tools: [...orderTools, ...memoryTools],

// Initialize before server.start()
await memoryStore.init();
```

### Context Injection

The `getContextBlock()` method builds a text block you can inject into the system prompt. It merges facts from all 3 scopes (module + user + agent) into a single block:

```typescript
const context = await memoryStore.getContextBlock(
  'socialselling',   // moduleId (from claims.module)
  '123',             // userId (from claims.user_id)
  'seo-agent',       // templateId (from claims.template_id)
);
// Returns:
// <workspace_memory>
// ## Known Facts (module: socialselling, user: 123, agent: seo-agent)
// - domain: example.com
// - cms: wordpress 6.4
// - industry: e-commerce
// </workspace_memory>
// You can update facts with memory_set and retrieve with memory_get.
```

Inject this into the system prompt before sending to the LLM. Budget: ~500 tokens max (~50 facts).

### Teaching Your Agent to Use Memory

Add memory tools to your system prompt's `## Tools` section:

```
## Memory
Use memory tools to remember facts across sessions:
- memory_set({ key: 'domain', value: 'example.com' }) — Store a fact
- memory_get({ key: 'domain' }) — Retrieve a fact
- memory_list({}) — List all known facts
- memory_delete({ key: 'old_fact' }) — Forget a fact

When the user shares a preference or fact, store it with memory_set.
Before asking for information, check memory_list first.
```

### Multi-Module Isolation

Each module's memory is isolated by the scope key prefix. A socialselling agent can never read a trading agent's memories:

```
mod:socialselling:user:123  →  { domain: 'shop.com', cms: 'shopify' }
mod:trading:user:123        →  { broker: 'interactive_brokers', strategy: 'momentum' }
```

No cross-contamination. No extra configuration needed — the module ID from claims handles it.

---

## Remote Operations

Agents can access any of the 9 Bheem servers via SSH. The remote ops tools handle server resolution, permission checking, and command safety.

### How It Works

```
Agent calls:  remote_exec({ server: "bheem-cloud", command: "pm2 list" })
                ↓
MCP Server:   1. Resolves "bheem-cloud" → 37.27.40.113
              2. Checks agent permissions (template_id from claims)
              3. Checks command against blocked patterns
              4. Executes: ssh -i ~/.ssh/sundeep root@37.27.40.113 "pm2 list"
              5. Returns stdout/stderr
```

### Remote Ops Tools

| Tool | Input | Description |
|------|-------|-------------|
| `remote_exec` | `{ server, command }` | Run a command on a remote server |
| `remote_read` | `{ server, path, line_start?, line_end? }` | Read a file (supports line ranges) |
| `remote_write` | `{ server, path, content }` | Write/create a file |
| `remote_edit` | `{ server, path, old_text, new_text }` | Search-and-replace edit |
| `remote_ls` | `{ server, path?, recursive? }` | List directory contents |
| `remote_health` | `{ server }` | Health check (`"all"` for all servers) |

### Server Registry

Servers can be referenced by ID, IP address, or name:

| ID | Name | IP | Description |
|----|------|----|-------------|
| `socialselling` | SocialSelling | 46.62.171.247 | Platform, MCPs, dashboard |
| `bheem-cloud` | bheem.cloud | 37.27.40.113 | Cloud frontend/backend, Docker registry |
| `academy` | Academy | 157.180.84.127 | Academy portal, LMS |
| `bheemflow` | Bheemflow | 46.62.142.13 | Workflow engine |
| `codeserver` | CodeServer | 37.27.89.140 | ERP, code-server, Meet |
| `platform` | BheemPlatform | 157.180.122.188 | Platform services |
| `mail` | Mail | 135.181.25.62 | Mailcow email |
| `docs` | Docs | 46.62.165.32 | Nextcloud docs + calendar |
| `backup` | Backup | 65.108.109.167 | DB backups, pg_dump, S3 |

### Per-Agent Access Control

Each agent template has specific server and operation permissions. Controlled by `AGENT_PERMISSIONS` in `src/tools/remote-ops.ts`:

| Agent | Servers | Operations |
|-------|---------|------------|
| `devops-engineer` | ALL (`*`) | exec, read, write, edit, ls, health |
| `coding-agent` | bheem-cloud, platform | exec, read, ls, health |
| `seo-autoheal-agent` | bheem-cloud | exec, read, ls |
| `analytics-agent` | backup | exec, read, ls |
| `*` (default) | none | health only |

To add permissions for a new agent, add an entry to the `AGENT_PERMISSIONS` map:

```typescript
const AGENT_PERMISSIONS: Record<string, AgentPermission> = {
  'my-new-agent': { servers: ['bheem-cloud', 'academy'], operations: ['exec', 'read', 'ls'] },
  // ...existing entries
};
```

### Blocked Commands

Dangerous patterns are blocked before SSH execution:

| Pattern | Description |
|---------|-------------|
| `rm -rf /` | Filesystem destruction |
| `mkfs` | Format filesystem |
| `dd if=` | Disk destroyer |
| `shutdown`, `reboot`, `poweroff` | Power operations |
| `iptables -F` | Flush firewall |
| `userdel`, `useradd`, `passwd` | User management |
| `chmod 777` | World-writable permissions |
| `> /dev/sd*` | Write to raw disk |

### Teaching Your Agent to Use Remote Ops

Add remote ops tools to your system prompt:

```
## Remote Operations
Access remote servers via MCP tools:
- remote_exec({ server: "bheem-cloud", command: "pm2 list" }) — Run commands
- remote_read({ server: "academy", path: "/etc/nginx/sites-enabled/default" }) — Read files
- remote_write({ server: "bheem-cloud", path: "/tmp/fix.sh", content: "..." }) — Write files
- remote_edit({ server: "bheem-cloud", path: "...", old_text: "...", new_text: "..." }) — Edit files
- remote_ls({ server: "platform", path: "/root" }) — List directories
- remote_health({ server: "all" }) — Health check all servers
```

### Setup

Remote ops are already wired in the template's `index.ts`. Configure SSH access:

```bash
# In .env
SSH_KEY_PATH=~/.ssh/sundeep     # Path to SSH private key
SSH_USER=root                    # SSH user
```

---

## Skills (Scoped to Agents)

By default, ALL platform skills (50+) are injected into every agent's prompt. This wastes tokens — an SEO agent doesn't need `weather` or `spotify-player`.

The `skills` field on templates controls which skills get injected.

### How It Works

```
Without skills field:               With skills field:
┌────────────────────────┐          ┌────────────────────────┐
│ ## Available Skills    │          │ ## Available Skills    │
│   github               │          │   github               │
│   slack                │          │   slack                │
│   trello               │          │   trello               │
│   weather              │          └────────────────────────┘
│   spotify-player       │            3 skills (~150 tokens)
│   ... (50+ skills)     │
└────────────────────────┘
  All skills (~2500 tokens)
```

### Usage

Add `skills` to your template definition:

```typescript
{
  id: 'order-assistant',
  // ... other fields ...
  skills: ['slack', 'trello'],  // Only these 2 skills injected
  systemPrompt: '...',
}
```

**Rules**:
- `skills: ['github', 'slack']` — only these skills are injected
- `skills: []` — no platform skills injected (MCP tools only)
- `skills` field omitted — ALL skills injected (backwards compatible)

### Choosing Skills for Your Agent

Pick skills that match the agent's domain:

| Agent Type | Recommended Skills |
|------------|-------------------|
| SEO / Marketing | `google-search`, `github`, `slack` |
| Order Management | `slack`, `trello`, `email` |
| Data Analysis | `google-sheets`, `slack` |
| DevOps / Cloud | `github`, `coding-agent`, `slack` |
| Content Creation | `google-search`, `image-gen`, `slack` |

When in doubt, start with fewer skills and add more as needed. Fewer skills = less token waste = better agent focus.

---

## Centralized AI Gateway

The platform provides a centralized AI endpoint for all LLM calls. **Do NOT call LLM provider APIs directly.** Use the platform's `/v1/messages` endpoint instead.

### Why

- **No API keys needed** — developers don't need their own provider keys
- **Centralized billing** — all AI costs tracked per workspace/module
- **Model routing** — platform picks the best model automatically
- **Cost control** — budget limits enforced per request
- **Security** — no API keys hardcoded or leaked in containers

### The endpoint

```
POST https://agents.agentbheem.com/v1/messages
```

### Before vs After

**BEFORE (wrong — direct provider call):**

```python
# ❌ Direct API call with hardcoded key
import httpx

API_KEY = os.getenv("LLM_API_KEY", "sk-...")

async def generate_insights(data: dict) -> str:
    response = await httpx.AsyncClient().post(
        "https://some-provider.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"},
        json={
            "model": "some-model",
            "messages": [{"role": "user", "content": f"Analyze: {data}"}],
        },
    )
    return response.json()["choices"][0]["message"]["content"]
```

**AFTER (correct — centralized AI):**

```python
# ✅ Platform AI gateway — no API key needed
import httpx

PLATFORM_URL = os.getenv("PLATFORM_URL", "https://agents.agentbheem.com")

async def generate_insights(data: dict, jwt_token: str = None) -> str:
    headers = {"Content-Type": "application/json"}
    if jwt_token:
        headers["Authorization"] = f"Bearer {jwt_token}"

    response = await httpx.AsyncClient().post(
        f"{PLATFORM_URL}/v1/messages",
        headers=headers,
        json={
            "model": "auto",               # Platform picks the best model
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": f"Analyze: {data}"}],
        },
    )
    result = response.json()
    return result["content"][0]["text"]     # Messages API format
```

### TypeScript (for MCP tools)

```typescript
// src/utils/ai-client.ts
const PLATFORM_URL = process.env['PLATFORM_URL'] || 'https://agents.agentbheem.com';

export async function aiComplete(
  prompt: string,
  options?: { model?: string; maxTokens?: number; system?: string }
): Promise<string> {
  const res = await fetch(`${PLATFORM_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model ?? 'auto',
      max_tokens: options?.maxTokens ?? 2048,
      system: options?.system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`AI call failed: ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? data.choices?.[0]?.message?.content ?? '';
}
```

Usage in MCP tools:

```typescript
import { aiComplete } from '../utils/ai-client.js';

// In your tool's execute function:
case 'generate_insights':
  const insights = await aiComplete(
    `Analyze this SEO data and provide actionable insights:\n${JSON.stringify(p.data)}`,
    { model: 'auto', maxTokens: 1024 }
  );
  return { insights };

case 'sort_keywords':
  const sorted = await aiComplete(
    `Sort these keywords by commercial intent, return JSON array:\n${JSON.stringify(p.keywords)}`,
    { model: 'fast', maxTokens: 512 }
  );
  return JSON.parse(sorted);

case 'import_csv':
  const parsed = await aiComplete(
    `Parse this CSV data into structured JSON with proper types:\n${p.csvContent.slice(0, 5000)}`,
    { model: 'fast', maxTokens: 4096 }
  );
  return JSON.parse(parsed);
```

### Model tiers for AI calls

| Tier | Use for | Cost |
|------|---------|------|
| `auto` | Default — platform picks best model | ~$0.003/1K tokens |
| `fast` | Simple tasks: sorting, parsing, classification | ~$0.001/1K tokens |
| `pro` | Complex analysis, long-form content | ~$0.015/1K tokens |

### Environment variable

```bash
# In .env (defaults to production platform)
PLATFORM_URL=https://agents.agentbheem.com
```

### Common use cases

| Task | Model | Example |
|------|-------|---------|
| Parse/import CSV data | `fast` | `aiComplete('Parse this CSV...', { model: 'fast' })` |
| Sort/rank items by criteria | `fast` | `aiComplete('Sort by intent...', { model: 'fast' })` |
| Generate insights from data | `auto` | `aiComplete('Analyze this data...', { model: 'auto' })` |
| Generate blog content | `auto` | `aiComplete('Write a blog about...', { model: 'auto' })` |
| SEO optimization suggestions | `auto` | `aiComplete('Optimize this page...', { model: 'auto' })` |
| Complex strategy/planning | `pro` | `aiComplete('Create a marketing plan...', { model: 'pro' })` |
| Image/video generation | — | Use [Media Generation](#media-generation) endpoints (`/v1/images/*`, `/v1/videos/*`, `/v1/cinema/*`) |

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

## Memory
- memory_set/get/list/delete — remember facts across sessions

## Remote Operations (if applicable)
- remote_exec/read/write/edit/ls/health — access remote servers

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
| `module` | `string \| undefined` | Module ID (e.g. `socialselling`, `trading`) — used for memory scoping |
| `templateId` | `string \| undefined` | Agent template ID — used for agent-scoped memory and remote ops permissions |
| `canWrite` | `boolean` | Has write access |
| `canAccessAll` | `boolean` | Admin — can see all data |

---

## File Structure

```
my-module-mcp/
├── package.json              # @bheemverse/mcp-server-core + pg dependencies
├── tsconfig.json
├── .env.example              # MCP_PORT, BACKEND_API_URL, DATABASE_URL, SSH_KEY_PATH
├── src/
│   ├── index.ts              # Server + memory + remote ops + template registration
│   ├── tools/
│   │   ├── items.ts          # Domain tool example (1 tool, N actions)
│   │   ├── analytics.ts      # Domain tool example (1 tool, N actions)
│   │   └── remote-ops.ts     # Remote server ops (6 tools, SSH, per-agent ACL)
│   ├── memory/
│   │   ├── index.ts              # Barrel exports
│   │   ├── workspace-memory-store.ts  # Cache + DB store class
│   │   ├── memory-tools.ts       # 4 MCP tools (get/set/list/delete)
│   │   ├── schema.ts             # TypeScript types + Drizzle reference
│   │   └── schema.sql            # PostgreSQL migration
│   ├── templates/
│   │   └── index.ts          # Agent templates with skills (auto-register on boot)
│   └── utils/
│       ├── api-client.ts     # Axios client for your backend
│       └── scope.ts          # Auth helpers (includes module + templateId)
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
5. **Templates live in your MCP repo** — self-contained
6. **Templates self-register on boot** — via `registerTemplatesWithOrchestrator()`
7. **Use `orchestrator: 'sdk'` and `model: 'auto'`** — let the platform handle model selection
8. **Scope skills per agent** — add `skills: [...]` to templates so agents only get relevant skills
9. **Include memory tools** — wire up `WorkspaceMemoryStore` + `createMemoryTools` in `index.ts`
10. **Teach agents to use memory** — add `memory_set`/`memory_get` to system prompts
11. **Remote ops require permissions** — add agent entries to `AGENT_PERMISSIONS` in `remote-ops.ts`
12. **Never call LLM providers directly** — use `PLATFORM_URL` for all LLM calls (see [Centralized AI Gateway](#centralized-ai-gateway))
13. **Use platform media endpoints for image/video** — never call generation providers directly (see [Media Generation](#media-generation))

---

## Media Generation

Centralized image and video generation via the platform. All endpoints are available at `PLATFORM_URL` — no direct provider API calls needed.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/images/generate` | POST | Generate images from text prompts |
| `/v1/videos/generate` | POST | Generate videos from text prompts |
| `/v1/videos/status/:id` | GET | Check video generation status |
| `/v1/cinema/generate` | POST | Cinematic video generation (single or director mode) |
| `/v1/cinema/jobs/:id` | GET | Check cinema job status |
| `/v1/cinema/models` | GET | List available cinema models |
| `/v1/cinema/presets` | GET | List available camera presets |

### Image Generation

```typescript
const PLATFORM_URL = process.env['PLATFORM_URL'] || 'https://agents.agentbheem.com';

const res = await fetch(`${PLATFORM_URL}/v1/images/generate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'],
  },
  body: JSON.stringify({
    prompt: 'A futuristic city skyline at sunset, photorealistic',
    model: 'flux-pro-1.1',
    aspectRatio: '16:9',
  }),
});

const result = await res.json();
// { imageUrl: "https://...", width: 1920, height: 1080 }
```

### Video Generation

```typescript
// Start video generation
const res = await fetch(`${PLATFORM_URL}/v1/videos/generate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'],
  },
  body: JSON.stringify({
    prompt: 'A drone shot flying over mountains at golden hour',
    model: 'veo3',
    duration: 8,
    aspectRatio: '16:9',
  }),
});

const { jobId } = await res.json();

// Poll for status
const status = await fetch(`${PLATFORM_URL}/v1/videos/status/${jobId}`, {
  headers: { 'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'] },
});
const result = await status.json();
// { status: "completed", videoUrl: "https://...", duration: 8 }
```

### Cinema Generation

Two modes: **single** (one model, one shot) and **director** (AI plans a multi-shot sequence).

```typescript
// Single mode
const res = await fetch(`${PLATFORM_URL}/v1/cinema/generate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'],
  },
  body: JSON.stringify({
    prompt: 'A product reveal shot of a luxury watch',
    mode: 'single',
    model: 'veo3',
    cameraPreset: 'crane_high_rise',
    duration: 8,
    aspectRatio: '16:9',
  }),
});

const { jobId } = await res.json();

// Director mode — AI plans multi-shot cinematic sequence
const directorRes = await fetch(`${PLATFORM_URL}/v1/cinema/generate`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'],
  },
  body: JSON.stringify({
    prompt: 'A product launch video for a luxury watch brand',
    mode: 'director',
    style: 'cinematic luxury',
    directorOptions: {
      shotCount: 4,
      mood: 'elegant and aspirational',
    },
  }),
});

const directorJob = await directorRes.json();

// Check job status
const jobStatus = await fetch(`${PLATFORM_URL}/v1/cinema/jobs/${directorJob.jobId}`, {
  headers: { 'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'] },
});
const job = await jobStatus.json();
// { status: "completed", shots: [...], videoUrl: "https://..." }
```

### List Models & Presets

```typescript
// Get available models
const models = await fetch(`${PLATFORM_URL}/v1/cinema/models`, {
  headers: { 'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'] },
}).then(r => r.json());

// Get camera presets (70+ options: dolly, crane, orbit, pan, tilt, tracking, etc.)
const presets = await fetch(`${PLATFORM_URL}/v1/cinema/presets`, {
  headers: { 'X-Api-Key': process.env['ORCHESTRATOR_API_KEY'] },
}).then(r => r.json());
```

### Kodee IDE Integration

Media generation is available as a built-in widget in Kodee IDE with a full UI for:
- Model selection
- Camera preset picker with live preview descriptions
- Single shot and Director mode toggle
- Real-time generation progress
- Video/image preview and download

---

## Testing

```bash
# Health check (replace with your server IP/domain and port)
curl http://<YOUR_SERVER>:9012/health

# List tools (should show domain + memory + remote ops tools)
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Execute a domain tool
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"orders",
      "arguments":{"action":"list","params":{"limit":5}}
    }
  }'

# Test memory_set
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"memory_set",
      "arguments":{"key":"domain","value":"example.com"}
    }
  }'

# Test memory_list
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":4,"method":"tools/call",
    "params":{
      "name":"memory_list",
      "arguments":{}
    }
  }'

# Test remote_health (all servers)
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":5,"method":"tools/call",
    "params":{
      "name":"remote_health",
      "arguments":{"server":"all"}
    }
  }'

# Test remote_exec
curl -X POST http://<YOUR_SERVER>:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":6,"method":"tools/call",
    "params":{
      "name":"remote_exec",
      "arguments":{"server":"bheem-cloud","command":"uptime"}
    }
  }'
```

### Health Check Response

```json
{
  "status": "ok",
  "server": "my-module-mcp",
  "version": "1.0.0",
  "toolCount": 12,
  "tools": [
    "items", "analytics",
    "memory_set", "memory_get", "memory_list", "memory_delete",
    "remote_exec", "remote_read", "remote_write", "remote_edit", "remote_ls", "remote_health"
  ],
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
| 9015 | Remote Ops (standalone) | Planned |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_PORT` | `9012` | Port for the MCP server |
| `MCP_AUTH_TOKEN` | — | Optional auth token for MCP endpoints |
| `MCP_EXTERNAL_URL` | — | **Required.** Reachable URL for agent connections (e.g. `http://10.0.0.5:9012/mcp`) |
| `BACKEND_API_URL` | — | **Required.** Your backend API base URL (e.g. `https://api.yourdomain.com`) |
| `ORCHESTRATOR_URL` | `https://agents.agentbheem.com` | Bheem platform URL for template registration |
| `PLATFORM_URL` | `https://agents.agentbheem.com` | Centralized AI platform (LLM via `/v1/messages`, media via `/v1/images/*`, `/v1/videos/*`, `/v1/cinema/*`) |
| `DATABASE_URL` | — | Optional. PostgreSQL connection for persistent memory |
| `SSH_KEY_PATH` | `~/.ssh/sundeep` | SSH private key for remote operations |
| `SSH_USER` | `root` | SSH user for remote connections |

---

## Real-World Reference: SocialSelling MCP

The SocialSelling MCP (port 9008) is a production example with:

- **5 domain tools**: `seo` (14 actions), `campaigns` (9 actions), `leads` (9 actions), `content` (5 actions), `analytics` (6 actions)
- **6 utility tools**: `search_knowledge_base`, `answer_question`, `get_workspace_context`, `get_connected_ad_accounts`, `get_connected_social_pages`, `get_integrations_status`
- **12 agent templates**: SEO autoheal (SDK + PEV), social media, email, content, analytics, ads, influencer, scheduler, SEO analyst, data4seo, router (swarm)

This covers the entire SocialSelling platform with just 11 tools instead of 60+ individual endpoints.

---

## Multi-Developer / Container Setup

When multiple developers work on the same module (e.g. 5 devs on SocialSelling), each developer runs their own MCP server inside their own container (Kodee IDE or similar).

### How it works

```
┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐
│ Dev 1 Container     │   │ Dev 2 Container     │   │ Dev 3 Container     │
│ IP: 10.0.0.11       │   │ IP: 10.0.0.12       │   │ IP: 10.0.0.13       │
│                     │   │                     │   │                     │
│ my-module-mcp:9012  │   │ my-module-mcp:9012  │   │ my-module-mcp:9012  │
│ templates:          │   │ templates:          │   │ templates:          │
│   dev1-order-agent  │   │   dev2-order-agent  │   │   dev3-order-agent  │
└────────┬────────────┘   └────────┬────────────┘   └────────┬────────────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │  register templates
                                   ▼
                    ┌──────────────────────────┐
                    │  Bheem Agent Platform     │
                    │  agents.agentbheem.com    │
                    │                          │
                    │  Routes agent calls back  │
                    │  to the right container   │
                    └──────────────────────────┘
```

### Setup per container

Each developer's `.env`:

```bash
# Same port is fine — each container has its own IP
MCP_PORT=9012

# CRITICAL: Must be this container's reachable IP/hostname
MCP_EXTERNAL_URL=http://<THIS_CONTAINER_IP>:9012/mcp

# Shared backend (or each dev can point to their own)
BACKEND_API_URL=https://api.yourdomain.com

# Central platform
ORCHESTRATOR_URL=https://agents.agentbheem.com

# Optional: shared DB for persistent memory
DATABASE_URL=postgresql://user:pass@shared-db:5432/mydb
```

### Avoiding template ID conflicts

When multiple developers register templates with the same `id`, the last one to register wins. To avoid conflicts during development, **prefix template IDs with the developer's name or container ID**:

```typescript
// src/templates/index.ts
const DEV_PREFIX = process.env['DEV_PREFIX'] || '';  // e.g. 'dev1-', 'alice-'

export const templates: AgentTemplateConfig[] = [
  {
    id: `${DEV_PREFIX}order-assistant`,    // → 'dev1-order-assistant'
    name: `Order Assistant ${DEV_PREFIX ? `(${DEV_PREFIX.replace('-','')})` : ''}`,
    version: '1.0.0',
    // ... rest of template
    mcpServers: {
      'my-module': { type: 'http', url: process.env['MCP_EXTERNAL_URL']! },
    },
  },
];
```

```bash
# Dev 1's .env
DEV_PREFIX=dev1-

# Dev 2's .env
DEV_PREFIX=dev2-
```

### Production merge

When a developer's work is ready for production:

1. Remove the `DEV_PREFIX` (or set it to empty)
2. Deploy to the production MCP server (shared port, e.g. `9008` for SocialSelling)
3. Templates register with their final IDs (e.g. `order-assistant` without prefix)

### Kodee IDE containers

Each Kodee IDE container already has:
- Its own IP address
- Node.js and npm pre-installed
- Port 8080 exposed via NGINX (IDE), but you can bind MCP to any port

To expose MCP from a Kodee IDE container:

```bash
# Inside the container
git clone https://github.com/Bheem-Platform/bheem-mcp-sdk.git my-module-mcp
cd my-module-mcp
npm install

# Set MCP_EXTERNAL_URL to the container's external IP
# (check with: hostname -I or curl ifconfig.me)
export MCP_EXTERNAL_URL=http://$(hostname -I | awk '{print $1}'):9012/mcp
export ORCHESTRATOR_URL=https://agents.agentbheem.com
export DEV_PREFIX=$(whoami)-

npm run dev
```

### Testing across containers

Each developer can test their own agent independently:

```bash
# Test your MCP server locally
curl http://localhost:9012/health

# Verify your templates registered with the platform
curl https://agents.agentbheem.com/api/v1/templates/by-module/my-module | python3 -m json.tool

# Execute your agent via the platform
curl -X POST https://agents.agentbheem.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "model": "dev1-order-assistant",
    "max_tokens": 2048,
    "messages": [{"role": "user", "content": "List my orders"}],
    "stream": false
  }'
```

The platform routes the tool calls back to **your specific container** via the `MCP_EXTERNAL_URL` you registered.

---

## FAQ

**Q: How many tools can I have?**
Max 5 domain tools per module. Use `action` routing to cover many operations per tool. The 4 memory tools and 6 remote ops tools don't count toward this limit — they're infrastructure.

**Q: Where do templates live?**
In your MCP repo at `src/templates/index.ts`. They self-register with the platform on boot.

**Q: Do I need to change anything on the platform side?**
No. Templates auto-register via `registerTemplatesWithOrchestrator()`. Just build your MCP server and deploy.

**Q: What model should I use?**
Always use `model: 'auto'`. The platform picks the best model automatically.

**Q: Can my agent access multiple MCP servers?**
Yes. Add multiple entries to `mcpServers`:
```typescript
mcpServers: {
  orders: { type: 'http', url: 'http://<YOUR_SERVER>:9012/mcp' },
  'remote-ops': { type: 'http', url: 'http://<YOUR_SERVER>:9012/mcp' },
}
```

**Q: Do I need PostgreSQL for memory?**
No. Without `DATABASE_URL`, memory works in-memory (lost on restart). This is fine for development. Set `DATABASE_URL` in production to persist across restarts.

**Q: Can one module's agent read another module's memories?**
No. Memory is scoped by module ID from claims. A `socialselling` agent can only access `mod:socialselling:*` keys. There's no way to cross-read.

**Q: What happens if I don't set `skills` on my template?**
All 50+ platform skills are injected into the agent's prompt (backwards compatible). This wastes ~2500 tokens. Add `skills: [...]` to only inject what the agent needs.

**Q: How do I add memory to an existing agent?**
Three steps: (1) Add `...memoryTools` to your server's tools array, (2) add `memory_set`/`memory_get` to the agent's system prompt, (3) optionally set `DATABASE_URL` for persistence. See the [Workspace Memory](#workspace-memory) section.

**Q: What's the memory token budget?**
`getContextBlock()` returns at most 50 facts (~500 tokens). Each fact is one key-value pair. If an agent stores more than 50 facts, the oldest are truncated from the context block (but still accessible via `memory_get`).

**Q: How do I give my agent remote server access?**
Three steps: (1) Add `...remoteOpsTools` to your server's tools array (already done), (2) add your agent's template ID to `AGENT_PERMISSIONS` in `remote-ops.ts` with allowed servers and operations, (3) add remote ops tool docs to your agent's system prompt. See the [Remote Operations](#remote-operations) section.

**Q: Can Kodee IDE agents use remote ops?**
Yes. Kodee IDE containers can connect to the remote-ops MCP server via `mcpServers: { 'remote-ops': { type: 'http', url: 'http://46.62.171.247:9015/mcp' } }`. SSH keys stay on the MCP server, never exposed to customer containers.

# @bheem/mcp-template

Starter template for building MCP (Model Context Protocol) servers on the Bheem Platform.

## Quick Start

```bash
# 1. Copy this template
cp -r packages/@bheem/mcp-template packages/@bheem/my-module-mcp

# 2. Update package.json name
cd packages/@bheem/my-module-mcp
#    → change "name" to "@bheem/my-module-mcp"

# 3. Configure
cp .env.example .env
#    → set MCP_PORT, BACKEND_API_URL

# 4. Install & run
npm install
npm run dev

# 5. Test health
curl http://localhost:9012/health
```

## Architecture

```
Your MCP Server                     Bheem Platform
┌──────────────────────┐            ┌─────────────────────────┐
│  src/tools/           │            │  Orchestrator           │
│   ├─ items.ts         │◄───────── │  (registers your URL)   │
│   ├─ analytics.ts     │  JSON-RPC │                         │
│   └─ your-tools.ts    │           │  Agents call your tools │
│                       │           │  via tools/call          │
│  src/utils/           │           └─────────────────────────┘
│   ├─ api-client.ts    │───────►  Your Backend API
│   └─ scope.ts         │          (REST/GraphQL)
└──────────────────────┘
```

**You write tools. The framework handles everything else:**
- JSON-RPC 2.0 protocol
- Auth (Bearer token or header-based)
- Health endpoint
- Error formatting
- Role-based access (visitor/user/admin)

## Adding a New Tool

### 1. Create a tool file

```typescript
// src/tools/orders.ts
import type { McpToolDefinition } from '@bheemverse/mcp-server-core';
import { apiClient } from '../utils/api-client.js';
import { getUserScope, authHeaders } from '../utils/scope.js';

export const orderTools: McpToolDefinition[] = [
  {
    name: 'list_orders',
    description: 'List orders with optional status filter',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter: pending, shipped, delivered' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      if (scope.role === 'visitor') {
        return { error: 'Please log in to view orders.' };
      }
      try {
        const { data } = await apiClient.get('/api/orders', {
          params: { status: input.status, limit: input.limit ?? 20 },
          headers: authHeaders(scope),
        });
        return data;
      } catch (error: any) {
        return { error: 'Failed to list orders', details: error.message };
      }
    },
  },
];
```

### 2. Register in src/index.ts

```typescript
import { orderTools } from './tools/orders.js';

const server = new McpServer({
  // ...
  tools: [
    ...itemTools,
    ...analyticsTools,
    ...orderTools,        // ← add here
  ],
});
```

### 3. Test

```bash
# Start dev server
npm run dev

# Call your tool via JSON-RPC
curl -X POST http://localhost:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'

# Execute a tool
curl -X POST http://localhost:9012/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list_orders",
      "arguments": { "status": "pending", "limit": 5 }
    }
  }'
```

## Tool Patterns

| Pattern | Auth Required? | Example |
|---------|---------------|---------|
| **LIST** | Yes (scoped) | `list_items` — user sees own, admin sees all |
| **GET** | Yes | `get_item` — single item by ID |
| **CREATE** | Yes (write) | `create_item` — requires `canWrite` |
| **ACTION** | Yes (write) | `archive_item` — mutate existing item |
| **PUBLIC** | No | `get_public_stats` — anyone can call |

## Deploying

```bash
# Build
npm run build

# Start with PM2
pm2 start dist/index.js \
  --name my-module-mcp \
  --env MCP_PORT=9012 \
  --env BACKEND_API_URL=http://localhost:3000

pm2 save
```

## Register with Orchestrator

Add your MCP to an agent template:

```typescript
// In orchestrator builtin-templates or via API
{
  "mcpServers": {
    "my-module": {
      "type": "http",
      "url": "http://localhost:9012"
    }
  }
}
```

Or via API:

```bash
curl -X POST http://localhost:8009/api/v1/agents \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "templateId": "support-agent",
    "name": "My Agent",
    "configOverrides": {
      "mcpServers": {
        "my-module": { "type": "http", "url": "http://localhost:9012" }
      }
    }
  }'
```

## File Structure

```
src/
├── index.ts              # Entry point — register tools & start server
├── tools/
│   ├── items.ts          # CRUD tools (example — replace with your domain)
│   └── analytics.ts      # Analytics tools (example)
└── utils/
    ├── api-client.ts     # Axios client for your backend API
    └── scope.ts          # User role/permission helpers
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MCP_PORT` | No | `9012` | Port to listen on |
| `MCP_AUTH_TOKEN` | No | — | Static Bearer token for auth |
| `BACKEND_API_URL` | No | `http://localhost:3000` | Your backend API URL |
| `RAG_SERVICE_URL` | No | `http://localhost:9100` | RAG service (if using) |

## Port Assignments (Existing)

| Port | MCP Server | Status |
|------|-----------|--------|
| 9006 | Academy | Built, not running |
| 9008 | SocialSelling | Running |
| 9009 | Trading | Built, not running |
| 9010 | Cloud | Running |
| 9011 | Workspace | Running |
| 9012+ | **Your new MCP** | Available |

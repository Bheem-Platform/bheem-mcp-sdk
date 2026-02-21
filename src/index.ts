/**
 * [YOUR MODULE] MCP Server
 *
 * ┌─────────────────────────────────────────────────┐
 * │  HOW TO USE THIS TEMPLATE                       │
 * │                                                 │
 * │  1. Rename package in package.json              │
 * │  2. Set your port in .env (MCP_PORT=9012)       │
 * │  3. Add tools in src/tools/                     │
 * │  4. Import & register them below                │
 * │  5. npm run dev  →  test at /health             │
 * │  6. npm run build  →  deploy with PM2           │
 * └─────────────────────────────────────────────────┘
 *
 * Tools are organized by domain in src/tools/:
 *   - items.ts      → CRUD operations (example)
 *   - analytics.ts  → Reporting & metrics (example)
 *
 * Each file exports McpToolDefinition[] which gets
 * registered here. The framework handles JSON-RPC,
 * auth, health checks, and error formatting.
 */

import { McpServer } from '@bheemverse/mcp-server-core';
import { itemTools } from './tools/items.js';
import { analyticsTools } from './tools/analytics.js';

// ─── Config ──────────────────────────────────────────
const PORT = parseInt(process.env['MCP_PORT'] ?? '9012', 10);
const AUTH_TOKEN = process.env['MCP_AUTH_TOKEN'] || undefined;

// ─── Server ──────────────────────────────────────────
const server = new McpServer({
  name: 'my-module-mcp',       // ← Change this
  port: PORT,
  version: '1.0.0',
  authToken: AUTH_TOKEN,
  tools: [
    ...itemTools,
    ...analyticsTools,
    // ...yourNewTools,          // ← Add your tool arrays here
  ],
});

// ─── Start ───────────────────────────────────────────
server.start().catch((err) => {
  console.error('[my-module-mcp] Failed to start:', err);
  process.exit(1);
});

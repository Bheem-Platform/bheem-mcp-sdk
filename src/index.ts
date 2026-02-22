/**
 * [YOUR MODULE] MCP Server
 *
 * ┌─────────────────────────────────────────────────┐
 * │  HOW TO USE THIS TEMPLATE                       │
 * │                                                 │
 * │  1. Rename package in package.json              │
 * │  2. Set your port in .env (MCP_PORT=9012)       │
 * │  3. Replace tools in src/tools/                 │
 * │  4. Replace templates in src/templates/         │
 * │  5. npm run dev  →  test at /health             │
 * │  6. npm run build  →  deploy with PM2           │
 * │                                                 │
 * │  On boot, your templates auto-register          │
 * │  with the orchestrator. Zero orchestrator        │
 * │  code changes needed.                           │
 * └─────────────────────────────────────────────────┘
 */

import { McpServer, registerTemplatesWithOrchestrator } from '@bheemverse/mcp-server-core';
import { itemTools } from './tools/items.js';
import { analyticsTools } from './tools/analytics.js';
import { templates } from './templates/index.js';

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
    // ...yourDomainTools,       // ← Add your domain tool arrays here
  ],
});

// ─── Start + Register Templates ──────────────────────
server.start()
  .then(async () => {
    // Self-register templates with the orchestrator
    const orchestratorUrl = process.env['ORCHESTRATOR_URL'] || 'http://localhost:8009';
    try {
      const result = await registerTemplatesWithOrchestrator(orchestratorUrl, templates, {
        ownedBy: 'my-module-mcp',  // ← Change this
      });
      console.log(`[my-module-mcp] Templates: ${result.registered} registered, ${result.updated} updated`);
    } catch (err) {
      // Non-fatal — orchestrator may be offline, templates register on next restart
      console.warn('[my-module-mcp] Template registration skipped:', (err as Error).message);
    }
  })
  .catch((err) => {
    console.error('[my-module-mcp] Failed to start:', err);
    process.exit(1);
  });

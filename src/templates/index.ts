/**
 * Agent Templates (EXAMPLE — replace with your templates)
 *
 * These templates self-register with the orchestrator on boot.
 * The orchestrator stores them in DB — you never edit orchestrator code.
 *
 * Each template defines:
 *   - Which MCP server to connect (mcpServers)
 *   - What model to use (model)
 *   - How complex the task is (orchestrator: sdk/pev/swarm)
 *   - System prompt with tool descriptions (NO raw URLs)
 */

import type { AgentTemplateConfig } from '@bheemverse/mcp-server-core';

// MCP_EXTERNAL_URL must be set — the orchestrator (agents.agentbheem.com) needs
// to reach your MCP server from outside. Use your server's IP or domain.
// e.g. http://10.0.0.5:9012/mcp or https://orders-mcp.yourdomain.com/mcp
const MCP_URL = process.env['MCP_EXTERNAL_URL'] || `http://${process.env['MCP_HOST'] ?? '0.0.0.0'}:${process.env['MCP_PORT'] ?? '9012'}/mcp`;
const MCP_SERVER = { 'my-module': { type: 'http' as const, url: MCP_URL } };

export const templates: AgentTemplateConfig[] = [
  // ─── Simple Agent (SDK orchestrator) ────────────────────
  {
    id: 'my-module-assistant',
    name: 'My Module Assistant',
    version: '1.0.0',
    description: 'Helps users manage items and view analytics',
    icon: 'box',
    category: 'automation',
    executionMode: 'channel',
    orchestrator: 'sdk',       // Simple — single-turn tool calls
    model: 'auto',
    mcpServers: MCP_SERVER,
    allowedTools: [],           // No local tools — all via MCP
    maxTurns: 10,
    maxBudgetUsd: 1.0,
    tierRequired: 'free',
    triggers: ['manual', 'buddy'],
    connectedServices: [],
    systemPrompt: `You are a helpful assistant for managing items.

## Tools
Use the items tool for all item operations:
- items({ action: 'list', params: { status: 'active' } }) — List items
- items({ action: 'get', params: { item_id: '...' } }) — Get details
- items({ action: 'create', params: { name: '...', description: '...' } }) — Create
- items({ action: 'archive', params: { item_id: '...' } }) — Archive

Use the analytics tool for metrics:
- analytics({ action: 'dashboard', params: { period: '30d' } }) — Stats

## Rules
- NEVER use curl or raw HTTP calls — use MCP tools only
- Be concise and natural. No emoji spam.
- Present data in human-readable format, not raw JSON.`,
  },

  // ─── Complex Agent (PEV orchestrator) ───────────────────
  {
    id: 'my-module-deep-agent',
    name: 'My Module Deep Agent',
    version: '1.0.0',
    description: 'Complex multi-step operations with planning and verification',
    icon: 'cpu',
    category: 'automation',
    executionMode: 'channel',
    orchestrator: 'pev',       // Complex — Plan-Execute-Verify
    model: 'auto',
    mcpServers: MCP_SERVER,
    allowedTools: [],
    maxTurns: 25,
    maxBudgetUsd: 3.0,
    tierRequired: 'pro',
    triggers: ['manual', 'webhook', 'schedule'],
    connectedServices: [],
    pevConfig: {
      maxReplanAttempts: 2,
      maxSubTasks: 6,
      maxTurnsPerSubtask: 8,
      enableStablePrefix: true,
      enableTodoRecitation: true,
    },
    systemPrompt: `You are a deep analysis agent.

## Tools
Same tools as the basic assistant (items, analytics).

## Workflow (PEV)
1. PLAN: Break the user's request into sub-tasks
2. EXECUTE: Work through each sub-task using MCP tools
3. VERIFY: Check results and re-plan if needed

## Rules
- NEVER use curl or raw HTTP calls
- Be thorough — this mode is for complex tasks`,
  },
];

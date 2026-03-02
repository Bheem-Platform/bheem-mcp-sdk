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
 *   - Which skills to include (skills) — if omitted, all skills are injected
 */

import type { AgentTemplateConfig } from '@bheemverse/mcp-server-core';

/**
 * Extended template config with skills support.
 * The `skills` field controls which platform skills are injected into the agent prompt.
 * If omitted or empty, ALL skills are included (backwards compatible).
 *
 * Skills are platform-level capabilities (e.g. 'github', 'slack', 'trello', 'google-search')
 * loaded by the orchestrator's SkillsLoader. Adding skills here tells the orchestrator
 * to only inject the listed skills instead of all 50+.
 */
export interface AgentTemplateWithSkills extends AgentTemplateConfig {
  skills?: string[];
}

// MCP_EXTERNAL_URL must be set — the orchestrator (agents.agentbheem.com) needs
// to reach your MCP server from outside. Use your server's IP or domain.
// e.g. http://10.0.0.5:9012/mcp or https://orders-mcp.yourdomain.com/mcp
const MCP_URL = process.env['MCP_EXTERNAL_URL'] || `http://${process.env['MCP_HOST'] ?? '0.0.0.0'}:${process.env['MCP_PORT'] ?? '9012'}/mcp`;
const MCP_SERVER = { 'my-module': { type: 'http' as const, url: MCP_URL } };

// Remote Ops MCP — same server exposes remote_exec/read/write/edit/ls/health tools
// Agents that need remote server access include this in their mcpServers.
const REMOTE_OPS_SERVER = { 'remote-ops': { type: 'http' as const, url: MCP_URL } };

export const templates: AgentTemplateWithSkills[] = [
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
    // Skills: only include relevant skills for this agent.
    // If omitted, ALL platform skills are injected (wastes tokens).
    skills: ['slack', 'trello'],
    systemPrompt: `You are a helpful assistant for managing items.

## Tools
Use the items tool for all item operations:
- items({ action: 'list', params: { status: 'active' } }) — List items
- items({ action: 'get', params: { item_id: '...' } }) — Get details
- items({ action: 'create', params: { name: '...', description: '...' } }) — Create
- items({ action: 'archive', params: { item_id: '...' } }) — Archive

Use the analytics tool for metrics:
- analytics({ action: 'dashboard', params: { period: '30d' } }) — Stats

Use memory tools to remember facts across sessions:
- memory_set({ key: 'domain', value: 'example.com' }) — Store a fact
- memory_get({ key: 'domain' }) — Retrieve a fact
- memory_list({}) — List all known facts
- memory_delete({ key: 'domain' }) — Forget a fact

## Rules
- NEVER use curl or raw HTTP calls — use MCP tools only
- Be concise and natural. No emoji spam.
- Present data in human-readable format, not raw JSON.
- When the user tells you a fact worth remembering (domain, preferences, etc.), use memory_set to store it.`,
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
    // Skills: deep agent gets more skills for complex workflows
    skills: ['github', 'slack', 'trello', 'google-search'],
    pevConfig: {
      maxReplanAttempts: 2,
      maxSubTasks: 6,
      maxTurnsPerSubtask: 8,
      enableStablePrefix: true,
      enableTodoRecitation: true,
    },
    systemPrompt: `You are a deep analysis agent.

## Tools
Same tools as the basic assistant (items, analytics, memory).

## Memory
You have access to persistent memory. Use it to:
- Remember facts the user shares (memory_set)
- Look up previously stored facts (memory_get)
- Check what you already know (memory_list)

## Workflow (PEV)
1. PLAN: Break the user's request into sub-tasks
2. EXECUTE: Work through each sub-task using MCP tools
3. VERIFY: Check results and re-plan if needed

## Rules
- NEVER use curl or raw HTTP calls
- Be thorough — this mode is for complex tasks
- Proactively use memory_set when you learn new facts about the user's setup`,
  },

  // ─── DevOps Agent (Remote Ops enabled) ───────────────
  {
    id: 'devops-engineer',
    name: 'DevOps Engineer',
    version: '1.0.0',
    description: 'Infrastructure management with remote server access across all Bheem servers',
    icon: 'terminal',
    category: 'automation',
    executionMode: 'channel',
    orchestrator: 'sdk',
    model: 'auto',
    mcpServers: { ...MCP_SERVER, ...REMOTE_OPS_SERVER },
    allowedTools: ['bash', 'read', 'write', 'edit'],
    maxTurns: 30,
    maxBudgetUsd: 3.0,
    tierRequired: 'pro',
    triggers: ['manual', 'buddy', 'schedule'],
    connectedServices: [],
    skills: ['github', 'slack'],
    systemPrompt: `You are a senior DevOps engineer for the Bheem platform.

## Remote Operations
You have MCP tools for accessing remote servers:
- remote_exec({ server: "bheem-cloud", command: "pm2 list" }) — Run commands
- remote_read({ server: "academy", path: "/etc/nginx/sites-enabled/default" }) — Read files
- remote_write({ server: "bheem-cloud", path: "/tmp/fix.sh", content: "..." }) — Write files
- remote_edit({ server: "bheem-cloud", path: "...", old_text: "...", new_text: "..." }) — Edit files
- remote_ls({ server: "platform", path: "/root" }) — List directories
- remote_health({ server: "all" }) — Health check all servers

## Servers
| ID | IP | Description |
|----|------|-------------|
| socialselling | 46.62.171.247 | Orchestrator, MCPs, dashboard |
| bheem-cloud | 37.27.40.113 | Cloud frontend/backend, Docker registry |
| academy | 157.180.84.127 | Academy portal, LMS |
| bheemflow | 46.62.142.13 | Workflow engine |
| codeserver | 37.27.89.140 | ERP, code-server, Meet |
| platform | 157.180.122.188 | Platform services |
| mail | 135.181.25.62 | Mailcow email |
| docs | 46.62.165.32 | Nextcloud docs + calendar |
| backup | 65.108.109.167 | DB backups, pg_dump, S3 |

## Memory
- memory_set/get/list/delete — store facts across sessions
- Always store: deploy outcomes, incidents, server changes, SSL dates, disk warnings

## Workflow
1. Health checks: remote_health({ server: "all" }) → present summary table
2. Deployments: check state → confirm with user → deploy → verify → store result
3. Troubleshooting: check resources → read logs → find root cause → suggest fix → confirm → apply → verify
4. Database: list backups → dump from backup server → confirm restore → verify

## Safety Rules
- ALWAYS confirm before: deploy, restart, restore, edit production files
- NEVER: rm -rf, DROP/DELETE SQL, modify SSH keys, change firewall
- ALWAYS: show commands before running, explain findings, verify after fixing
- Be direct. Use tables. Lead with severity (CRITICAL/WARNING/INFO).`,
  },
];

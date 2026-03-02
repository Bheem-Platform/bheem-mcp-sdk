# Agentic Capabilities for Every Agent

> Give every Bheem agent real power — bash, read, write, edit, explore, find issues, fix them.

---

## The Problem

Right now, agents can only call MCP tools with pre-coded action routes. An SEO agent calls `seo({ action: 'audit' })`. A content agent calls `content({ action: 'generate' })`. They can only do what you've explicitly coded.

**Agentic SDK tools** are different. General-purpose tools (`bash`, `read`, `write`, `edit`) that solve any problem — exploring codebases, reading logs, editing configs, running tests, chaining commands dynamically. Not limited to pre-coded paths.

**Your agents should work the same way.**

---

## The Solution: `allowedTools` in the SDK

The SDK already supports this. The `allowedTools` field in agent templates controls which local tools the agent gets — provided by the SDK, not your code.

```typescript
// Any agent can get agentic capabilities
{
  id: 'seo-analysis-agent',
  allowedTools: ['bash', 'read', 'write', 'edit'],  // ← This is all it takes
  mcpServers: { ... },  // MCP tools for domain-specific business logic
  ...
}
```

The agent now has:
- `bash` — Run shell commands (SSH, curl, git, npm, docker, psql, anything)
- `read` — Read any file (configs, logs, source code, CSVs)
- `write` — Create files (reports, scripts, configs)
- `edit` — Modify existing files (fix code, update configs)

**The system prompt teaches the agent WHEN and HOW to use these tools for its specific domain.**

---

## Architecture: Two Tool Layers

```
┌─────────────────────────────────────────────────────────┐
│                    Any Bheem Agent                        │
│                                                          │
│  Layer 1: SDK Tools (allowedTools)                       │
│  ┌────────────────────────────────────────────────────┐  │
│  │ bash  — Shell commands, SSH, infrastructure        │  │
│  │ read  — Read files, logs, configs, source code     │  │
│  │ write — Create files, reports, scripts             │  │
│  │ edit  — Modify files, fix code, update configs     │  │
│  └────────────────────────────────────────────────────┘  │
│  These are general-purpose SDK tools.                     │
│  The system prompt teaches when/how to use them.         │
│                                                          │
│  Layer 2: MCP Tools (mcpServers)                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Domain-specific business logic                     │  │
│  │ memory_set/get/list/delete — persistent memory     │  │
│  │ seo({ action: 'audit' })  — SEO-specific API      │  │
│  │ leads({ action: 'list' }) — CRM-specific API      │  │
│  └────────────────────────────────────────────────────┘  │
│  These call structured backend APIs. Typed input/output. │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**When to use which layer:**

| Use SDK Tools (bash/read/write/edit) | Use MCP Tools |
|--------------------------------------|---------------|
| Run shell commands | Call structured backend APIs |
| SSH into servers | CRUD operations on your database |
| Read/edit config files | Domain-specific business logic |
| Explore codebases | Memory persistence |
| Tail logs, grep errors | Integrations (Slack, GitHub) |
| Install packages, run builds | User management, billing |
| Git operations | Analytics dashboards |
| Anything a developer would do in terminal | Anything that needs a typed API |

---

## How Each Agent Type Benefits

### SEO Agent — Before vs After

**Before** (MCP tools only):
```
User: "My site has a 404 page that should be a 301 redirect"
Agent: I can run an SEO audit. Use seo({ action: 'audit' }).
       Sorry, I don't have a tool to fix redirects.
       You'll need to manually edit your NGINX config.
```

**After** (SDK tools + MCP tools):
```
User: "My site has a 404 page that should be a 301 redirect"
Agent: Let me check your NGINX config.
  bash("ssh -i ~/.ssh/sundeep root@37.27.40.113 'cat /etc/nginx/sites-enabled/default'")
  → reads the config, finds the server block

Agent: I see the issue. The /old-page path has no redirect rule.
       I'll add a 301 redirect. Here's the change:
       [shows diff]
       Should I apply this?

User: "yes"
Agent: edit(nginx config — adds redirect rule)
       bash("ssh root@... 'nginx -t && systemctl reload nginx'")
Agent: Done. Redirect is live. Verified: curl -I shows 301.
```

### Content Agent — Before vs After

**Before**: Can only generate text via LLM. Can't save to CMS, can't read existing content.

**After**:
```
User: "Update the pricing page — change the Pro plan from $49 to $59"

Agent: bash("find /root/bheem-platform -name 'pricing*' -type f")
  → finds frontend/src/pages/pricing.tsx

Agent: read("frontend/src/pages/pricing.tsx")
  → reads the file, finds the Pro plan section

Agent: I found the pricing at line 45. Changing $49 → $59.
       edit(pricing.tsx — updates the price)

Agent: Updated. Want me to rebuild and deploy?
```

### DevOps Agent

```
User: "The academy portal is slow"

Agent: bash("ssh -i ~/.ssh/sundeep root@157.180.84.127 'top -b -n1 | head -15'")
  → CPU at 95%, node process consuming 4GB RAM

Agent: bash("ssh root@157.180.84.127 'pm2 logs academy --lines 30 --nostream'")
  → [ERROR] heap out of memory

Agent: CRITICAL: Academy server (157.180.84.127) — Node.js heap out of memory.
       PM2 process is thrashing (restart loop).
       Fix: Increase Node.js memory limit.

       bash("ssh root@... 'pm2 delete academy && NODE_OPTIONS=--max-old-space-size=2048 pm2 start ...'")

Agent: Fixed. Academy portal responding. Load time back to normal.
       memory_set({ key: "academy_heap_fix", value: "Increased to 2GB on 2026-02-23" })
```

### Trading Agent

```
User: "Check if our market data feed is still connected"

Agent: bash("ssh -i ~/.ssh/sundeep root@<trading-server> 'pm2 logs trading-feed --lines 20 --nostream'")
  → [WARN] WebSocket disconnected from exchange API, reconnecting...
  → [INFO] Reconnected to Binance WS feed

Agent: The market data feed disconnected briefly but auto-reconnected.
       Last disconnect: 2 minutes ago. Currently connected and streaming.
       No data loss — the reconnection handler caught it.
```

---

## Template Examples for Every Module

### DevOps Engineer

```typescript
{
  id: 'devops-engineer',
  name: 'DevOps Engineer',
  icon: 'terminal',
  category: 'automation',
  orchestrator: 'sdk',
  model: 'auto',
  allowedTools: ['bash', 'read', 'write', 'edit'],
  maxTurns: 30,
  maxBudgetUsd: 3.0,
  tierRequired: 'pro',
  skills: ['github', 'slack'],
  mcpServers: { cloud: { type: 'http', url: '...:9010/mcp' } },
  systemPrompt: `You are a senior DevOps engineer...
    [infrastructure map, SSH commands, safety rules]`,
}
```

### SEO Agent (Enhanced)

```typescript
{
  id: 'seo-autoheal-agent',
  name: 'SEO Autoheal',
  icon: 'search',
  category: 'marketing',
  orchestrator: 'sdk',
  model: 'auto',
  allowedTools: ['bash', 'read', 'edit'],  // No 'write' — reads + edits only
  maxTurns: 25,
  maxBudgetUsd: 2.0,
  tierRequired: 'pro',
  skills: ['google-search'],
  mcpServers: { socialselling: { type: 'http', url: '...:9008/mcp' } },
  systemPrompt: `You are an SEO engineer...
    Use seo() MCP tool for audits and healing.
    Use bash for: checking NGINX configs, reading robots.txt,
    verifying redirects, testing page speed with curl.
    Use edit for: fixing NGINX redirects, updating meta tags,
    editing sitemap configs.`,
}
```

### Content Agent (Enhanced)

```typescript
{
  id: 'content-agent',
  name: 'Content Manager',
  icon: 'file-text',
  category: 'content',
  orchestrator: 'sdk',
  model: 'auto',
  allowedTools: ['bash', 'read', 'write', 'edit'],
  maxTurns: 20,
  maxBudgetUsd: 2.0,
  tierRequired: 'pro',
  skills: ['google-search'],
  mcpServers: { socialselling: { type: 'http', url: '...:9008/mcp' } },
  systemPrompt: `You are a content manager...
    Use content() MCP tool for generating/scheduling posts.
    Use bash for: checking published content, verifying URLs,
    running lighthouse audits, testing OG tags.
    Use read/edit for: updating static content files,
    fixing typos in source code, updating copy.`,
}
```

### Coding Agent

```typescript
{
  id: 'coding-agent',
  name: 'Coding Assistant',
  icon: 'code',
  category: 'automation',
  orchestrator: 'sdk',
  model: 'auto',
  allowedTools: ['bash', 'read', 'write', 'edit'],
  maxTurns: 30,
  maxBudgetUsd: 5.0,
  tierRequired: 'pro',
  skills: ['github'],
  mcpServers: { workspace: { type: 'http', url: '...:9011/mcp' } },
  systemPrompt: `You are a software engineer...
    Use bash for: git, npm, python, docker, testing.
    Use read for: understanding existing code.
    Use write for: creating new files.
    Use edit for: modifying existing code.
    Follow the codebase conventions you observe.`,
}
```

### Analytics Agent (Read-Only)

```typescript
{
  id: 'analytics-agent',
  name: 'Analytics Agent',
  icon: 'bar-chart',
  category: 'analytics',
  orchestrator: 'sdk',
  model: 'auto',
  allowedTools: ['bash', 'read'],  // Read-only — no write/edit
  maxTurns: 15,
  maxBudgetUsd: 1.5,
  tierRequired: 'free',
  skills: ['google-sheets'],
  mcpServers: { socialselling: { type: 'http', url: '...:9008/mcp' } },
  systemPrompt: `You are a data analyst...
    Use analytics() MCP tool for dashboards and reports.
    Use bash for: running SQL queries (SELECT only), checking data freshness.
    Use read for: reading CSV exports, config files.
    NEVER modify any data — you are read-only.`,
}
```

---

## Permission Tiers

Not every agent needs full access. Control what each agent can do:

| Tier | `allowedTools` | Use Case |
|------|---------------|----------|
| **Observer** | `['bash', 'read']` | Analytics, monitoring, reporting — can explore but can't change anything |
| **Operator** | `['bash', 'read', 'edit']` | SEO, content, config fixes — can edit existing files but can't create new ones |
| **Builder** | `['bash', 'read', 'write', 'edit']` | DevOps, coding, full development — can create and modify anything |
| **Restricted** | `[]` | Chatbot, Q&A — MCP tools only, no local access |

```
                    Observer     Operator     Builder     Restricted
Read files             ✓            ✓            ✓
Run commands           ✓            ✓            ✓
Edit files                          ✓            ✓
Create files                                     ✓
MCP tools              ✓            ✓            ✓            ✓
```

### Mapping agents to tiers

| Agent | Tier | Why |
|-------|------|-----|
| DevOps Engineer | Builder | Needs full infra access |
| Coding Agent | Builder | Creates and edits code |
| SEO Autoheal | Operator | Edits configs, doesn't create new files |
| Content Manager | Builder | Creates content files |
| Analytics | Observer | Read-only data access |
| Email Campaign | Restricted | Only uses MCP tools, no shell |
| Lead Scorer | Restricted | Only uses MCP tools |
| Buddy (chat) | Restricted | General Q&A, no infra access |

---

## Permission Hooks (Orchestrator-Level)

The system prompt tells the agent to ask for confirmation. But for production safety, enforce it at the orchestrator level:

```typescript
// orchestrator/src/permissions/tool-permission-hook.ts

type Decision = 'allow' | 'confirm' | 'deny';

function checkPermission(agentId: string, toolCall: ToolCall): Decision {
  if (toolCall.name !== 'bash') return 'allow';  // MCP tools are always allowed

  const cmd = toolCall.input.command;

  // Always deny: catastrophic commands
  const BLOCKED = /rm -rf|dd if=|mkfs|shutdown|reboot|DROP TABLE|DELETE FROM|iptables -F/;
  if (BLOCKED.test(cmd)) return 'deny';

  // Auto-allow: read-only commands (local and SSH)
  const READ_ONLY = /^(cat |head |tail |grep |ls |find |uptime|free |df |pm2 list|docker ps|curl -s|echo |wc )/;
  const SSH_READ = /^ssh .+ ['"]?(cat |head |tail |grep |ls |uptime|free |df |pm2 list|docker ps)/;
  if (READ_ONLY.test(cmd) || SSH_READ.test(cmd)) return 'allow';

  // Confirm: write operations
  return 'confirm';
}
```

When the hook returns `'confirm'`, the orchestrator pauses execution and sends a confirmation request to the user via WebSocket:

```
Agent wants to run: pm2 restart socialselling-backend
Allow? [Yes] [No]
```

Same UX pattern — the user confirms before the agent proceeds.

---

## Memory Integration

Every agent benefits from persistent memory across sessions:

```
Session 1:
  User: "My domain is shop.example.com, we use Shopify"
  Agent: memory_set({ key: "domain", value: "shop.example.com" })
  Agent: memory_set({ key: "cms", value: "shopify" })

Session 2 (next day):
  User: "Run an SEO audit"
  Agent: [reads <workspace_memory> from system prompt]
         Already knows: domain = shop.example.com, cms = shopify
         Proceeds directly — doesn't ask again
```

Memory is scoped per module, so a socialselling agent's memories don't leak into a trading agent's context.

---

## DevOps Agent System Prompt (Complete)

For the DevOps engineer specifically, here's the full system prompt:

```
You are a senior DevOps engineer for the Bheem platform.
You have bash access to the local server and SSH access to all 8 servers.
You can explore, diagnose, and fix infrastructure issues.

## Infrastructure

| Server | IP | SSH | Services |
|--------|----|-----|----------|
| socialselling (local) | 46.62.171.247 | — | Orchestrator (8009), Dashboard (3002), MCPs (9006-9011) |
| bheem.cloud | 37.27.40.113 | ssh -i ~/.ssh/sundeep root@37.27.40.113 | Cloud frontend/backend, Docker registry (5050) |
| academy | 157.180.84.127 | ssh -i ~/.ssh/sundeep root@157.180.84.127 | Academy portal, LMS |
| bheemflow | 46.62.142.13 | ssh -i ~/.ssh/sundeep root@46.62.142.13 | Workflow engine |
| codeserver | 37.27.89.140 | ssh -i ~/.ssh/sundeep root@37.27.89.140 | ERP, code-server, Meet (7880) |
| platform | 157.180.122.188 | ssh -i ~/.ssh/sundeep root@157.180.122.188 | Platform services |
| mail | 135.181.25.62 | ssh -i ~/.ssh/sundeep root@135.181.25.62 | Mailcow email |
| docs | 46.62.165.32 | ssh -i ~/.ssh/sundeep root@46.62.165.32 | Nextcloud docs + calendar |
| backup | 65.108.109.167 | ssh -i ~/.ssh/sundeep root@65.108.109.167 | DB backups, pg_dump 16.11 |

## Database
- Host: 65.109.167.218:5432, User: postgres
- bheem_socialselling (prod ~17MB), bheem_socialselling_staging (~25MB)
- PostgreSQL 16.9. Use backup server for pg_dump (has 16.11).
- Backups: every 6h to s3://bheem/database/daily/

## Key Paths (Local)
- /root/bheem-platform/ — monorepo root
- /root/bheem-platform/modules/bheem-socialselling/deploy.sh — deploy script
- /var/log/socialselling-deploy.log — deploy logs
- /var/log/agentbheem-token-refresh.log — token refresh logs
- /opt/traefik/dynamic/ — Traefik routing configs

## Common Patterns
- Local PM2: pm2 list, pm2 logs <proc> --lines 50 --nostream
- Remote PM2: ssh -i ~/.ssh/sundeep root@<IP> "pm2 list"
- Docker: ssh -i ~/.ssh/sundeep root@<IP> "docker ps --format 'table {{.Names}}\t{{.Status}}'"
- Resources: ssh -i ~/.ssh/sundeep root@<IP> "uptime && free -m && df -h /"
- Deploy: cd /root/bheem-platform/modules/bheem-socialselling && bash deploy.sh
- DB dump: ssh root@65.108.109.167 "PGPASSWORD='Bheem924924.@' pg_dump -h 65.109.167.218 -U postgres -d bheem_socialselling > /tmp/dump.sql"
- SSL check: echo | openssl s_client -servername DOMAIN -connect DOMAIN:443 2>/dev/null | openssl x509 -noout -dates
- S3 backups: ssh root@65.108.109.167 "aws --endpoint-url https://hel1.your-objectstorage.com s3 ls s3://bheem/database/daily/"

## Memory
Store important facts for future sessions:
- memory_set/get/list/delete via MCP
- Always store: deploy outcomes, incidents, server changes, SSL dates, disk warnings

## Workflow
1. Health checks: pm2 list + SSH resource checks → present summary table
2. Deployments: check state → confirm with user → deploy → verify health → store result
3. Troubleshooting: check resources → read logs → find root cause → suggest fix → confirm → apply → verify
4. Database: list backups → dump from backup server → strip \restrict tokens → confirm restore → verify

## Safety Rules
- ALWAYS confirm before: deploy, restart, restore, edit production files, any rm/mv
- NEVER: rm -rf, DROP/DELETE SQL, modify SSH keys, change firewall, install packages without asking
- ALWAYS: show commands before running, explain findings, verify after fixing, store incidents in memory
- Use --nostream with pm2 logs, --tail N with docker logs
- Be direct. Use tables. Lead with severity (CRITICAL/WARNING/INFO).
```

---

## Remote Operations MCP Server

### The Problem

SDK tools (`bash`, `read`, `write`, `edit`) only work on the **local** filesystem — the server running the orchestrator. But Bheem has 9 servers. A DevOps agent on `socialselling` (46.62.171.247) can't `read("/etc/nginx/sites-enabled/default")` on `bheem.cloud` (37.27.40.113).

SSH via `bash("ssh root@...")` works but has no access control, no command blocking, and no audit trail.

### Solution: Remote Ops MCP Server (Port 9015)

A single MCP server that gives **any agent** structured SSH access to remote servers. SSH keys stay centralized. Per-agent access control.

```
┌──────────────────────────────────────────────────────┐
│              Remote Ops MCP Server (:9015)             │
│                                                        │
│  Tools:                                                │
│    remote_exec   — Run command on remote server        │
│    remote_read   — Read file on remote server          │
│    remote_write  — Write file on remote server         │
│    remote_edit   — Search-replace edit on remote       │
│    remote_ls     — List directory on remote server     │
│    remote_health — Check server health (or all)        │
│                                                        │
│  Access Control:                                       │
│    Per-agent permission matrix (AGENT_PERMISSIONS)     │
│    Blocked command patterns (rm -rf, mkfs, etc.)       │
│    SSH key stays on this server — never exposed        │
│                                                        │
│  Server Registry:                                      │
│    9 servers with ID, name, IP, description            │
│    Resolve by ID ("bheem-cloud"), IP, or name          │
└──────────────────────────────────────────────────────┘
```

### How It Works

1. Agent calls `remote_exec({ server: "bheem-cloud", command: "pm2 list" })`
2. MCP server resolves "bheem-cloud" → `37.27.40.113`
3. Checks agent's permissions (template_id from claims)
4. Checks command against blocked patterns
5. Executes via SSH: `ssh -i ~/.ssh/sundeep root@37.27.40.113 "pm2 list"`
6. Returns stdout/stderr

### Server Registry

| ID | Name | IP | Description |
|----|------|----|-------------|
| socialselling | SocialSelling | 46.62.171.247 | Orchestrator, MCPs, dashboard |
| bheem-cloud | bheem.cloud | 37.27.40.113 | Cloud frontend/backend, Docker registry |
| academy | Academy | 157.180.84.127 | Academy portal, LMS |
| bheemflow | Bheemflow | 46.62.142.13 | Workflow engine |
| codeserver | CodeServer | 37.27.89.140 | ERP, code-server, Meet |
| platform | BheemPlatform | 157.180.122.188 | Platform services |
| mail | Mail | 135.181.25.62 | Mailcow email |
| docs | Docs | 46.62.165.32 | Nextcloud docs + calendar |
| backup | Backup | 65.108.109.167 | DB backups, pg_dump, S3 |

### Per-Agent Access Control

| Agent | Servers | Operations |
|-------|---------|------------|
| devops-engineer | ALL (`*`) | exec, read, write, edit, ls, health |
| coding-agent | bheem-cloud, platform | exec, read, ls, health |
| seo-autoheal-agent | bheem-cloud | exec, read, ls |
| analytics-agent | backup | exec, read, ls |
| * (default) | none | health only |

### Blocked Commands

Dangerous patterns are blocked at the MCP level (before SSH):
- `rm -rf /` — filesystem destruction
- `mkfs` — format filesystem
- `dd if=` — disk destroyer
- `shutdown`, `reboot`, `poweroff` — power operations
- `iptables -F` — flush firewall
- `userdel`, `useradd`, `passwd` — user management
- `chmod 777` — world-writable permissions
- `> /dev/sd*` — write to raw disk

### Usage by Agent Type

**DevOps agent** — full access to all servers:
```
remote_exec({ server: "academy", command: "pm2 list" })
remote_read({ server: "bheem-cloud", path: "/etc/nginx/sites-enabled/default" })
remote_edit({ server: "bheem-cloud", path: "/etc/nginx/...", old_text: "...", new_text: "..." })
remote_health({ server: "all" })
```

**SEO agent** — read-only on bheem.cloud:
```
remote_exec({ server: "bheem-cloud", command: "curl -s -o /dev/null -w '%{http_code}' https://site.com" })
remote_read({ server: "bheem-cloud", path: "/etc/nginx/sites-enabled/default" })
```

**Kodee IDE agents** — same MCP tools available:
```
// Agent in customer container connects to remote-ops MCP at :9015
mcpServers: { 'remote-ops': { type: 'http', url: 'http://46.62.171.247:9015/mcp' } }
```

### Environment Variables

```bash
SSH_KEY_PATH=~/.ssh/sundeep     # Path to SSH private key (default: ~/.ssh/sundeep)
SSH_USER=root                    # SSH user (default: root)
```

---

## Implementation Checklist

| Step | What | Effort |
|------|------|--------|
| 1 | Add `allowedTools` support to orchestrator's SDK executor (if not already there) | Check existing code |
| 2 | Create DevOps agent template with system prompt | 1 hour |
| 3 | Test read-only mode (`['bash', 'read']`) — "is everything healthy?" | 1 hour |
| 4 | Add write/edit — test "deploy socialselling", "fix NGINX config" | 1 hour |
| 5 | Add permission hooks in orchestrator (confirm for writes) | 2-3 hours |
| 6 | Create enhanced templates for SEO, content, coding agents | 2-3 hours |
| 7 | Test multi-module isolation (cloud agent can't read socialselling memory) | 30 min |
| 8 | Add scheduled health checks (trigger: 'schedule') | 1 hour |
| 9 | Deploy Remote Ops MCP server on port 9015 | 1 hour |
| 10 | Test remote_exec + remote_read from agent → verify permission matrix | 1 hour |

**Total: 1-2 days** (vs 2-4 weeks for the MCP-tools-only approach).

---

## Summary

| | Old Approach | New Approach |
|-|-------------|-------------|
| **Philosophy** | Pre-code every action as an MCP tool | Give the agent general tools + teach via system prompt |
| **Agent capability** | Can only do what's coded | Can do anything a developer can |
| **Infra tools** | 5 MCP tools + FastAPI backend | `allowedTools: ['bash', 'read', 'write', 'edit']` |
| **New capability** | Code a new action + endpoint | Add a line to system prompt |
| **Troubleshooting** | Limited to coded checks | Agent explores freely |
| **Time to build** | 2-4 weeks | 1-2 days |
| **Code to maintain** | ~1400 lines | ~60 lines + system prompt |
| **Applies to** | One agent (DevOps) | **Every agent on the platform** |

The system prompt is the agent's programming. `allowedTools` is the capability switch. MCP tools handle structured business logic. Together, every agent gets full agentic power.

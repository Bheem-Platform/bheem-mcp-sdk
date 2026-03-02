# Agentic Events: Per-Page Agents for SocialSelling

## Context

SocialSelling has 100+ agentic events across 10 categories (Configuration, Leads, AI Calls, Campaigns, Channels, Integrations, Compliance, Performance, Billing, System). Users need:
1. **Proactive alerts** — pushed via WebSocket when issues are detected
2. **Per-page agent** — each major page gets a dedicated AI agent the user can chat with to configure/fix/optimize

The existing analysis at `/root/1d501e17-7c74-4aa5-aea0-fe5655311525_AGENTIC_EVENTS_IMPLEMENTATION.md` defines all 100+ events with IDs, trigger conditions, priorities, and message templates.

## Architecture

```
Frontend (Next.js)
┌─────────────────────────────────────────────────────┐
│  AgentEventProvider (React Context)                  │
│    ├─ listens WebSocket "agent_alert" events         │
│    ├─ stores alerts per page                         │
│    └─ exposes usePageAlerts(pageId) hook              │
│                                                      │
│  PageAgentPanel (reusable on every page)              │
│    ├─ alert banner (dismissible, severity-colored)    │
│    ├─ "Talk to Agent" button → chat drawer            │
│    └─ chat drawer = extracted from SEO ChatTab        │
└──────────────────────┬──────────────────┬────────────┘
                WebSocket              Orchestrator API
                  │                        │
┌─────────────────▼───────────┐  ┌────────▼─────────────┐
│  Python Backend (FastAPI)   │  │ Orchestrator (:8009)  │
│                             │  │                       │
│  agentic_events/ module     │  │ New Agent Templates:  │
│    ├─ handler.py            │  │  dashboard-page-agent │
│    ├─ realtime_handlers.py  │  │  leads-page-agent     │
│    └─ constants.py          │  │  campaign-page-agent  │
│                             │  │  settings-page-agent  │
│  Celery monitors:           │  │                       │
│    ├─ check_workspace_setup │  │ Existing Templates:   │
│    ├─ check_lead_quality    │  │  seo-specialist       │
│    ├─ check_campaign_health │  │  analytics-agent      │
│    └─ check_integrations    │  │  ads-agent            │
└─────────────────────────────┘  └───────────────────────┘
```

**Key decisions:**
- Event monitors live in **existing Python backend** (Celery + EventBus) — no new service
- Per-page agents are **orchestrator templates** using existing socialselling-mcp tools
- Events delivered via **existing WebSocket** (new `AGENT_ALERT` event type)
- Chat UI **extracted from SEO ChatTab** into reusable `AgentChatDrawer`

## MVP Scope: 4 Pages, 23 Events

### MVP Pages & Agents

| Page | Template ID | Event Categories |
|------|-------------|-----------------|
| Dashboard | `dashboard-page-agent` | All (overview/triage) |
| Leads | `leads-page-agent` | Lead Management, AI Call |
| Campaigns | `campaign-page-agent` | Campaign, Communication |
| Settings | `settings-page-agent` | Configuration, Integration |

### MVP Events (23 of 100+)

**Configuration (8):** CFG_010 no pipelines, CFG_020 AI call not configured, CFG_021 AI call disabled, CFG_022 no voice selected, CHAN_001 mailjet not connected, CHAN_010 WhatsApp not connected, CHAN_020 Facebook not connected, CFG_004 no team members

**Lead Management (6):** LEAD_001 missing phone, LEAD_003 missing email, LEAD_005 duplicates, LEAD_011 stuck in stage, LEAD_013 hot lead no action, LEAD_012 no owner

**Campaign (4):** CAMP_001 no audience, CAMP_011 high bounce rate, CAMP_014 scheduled failed, CAMP_010 low open rate

**AI Call (3):** CALL_001 call failed, CALL_003 queue stuck, CALL_010 short duration

**System (2):** BILL_001 credits low, CHAN_022 token expiring

---

## Implementation Plan

### Phase 1: Backend — Agentic Event Infrastructure

#### 1.1 NEW: `backend/agentic_events/constants.py`
- `EventSeverity` enum: info, warning, critical, success
- `EventCategory` enum: 10 categories
- `PAGE_AGENT_MAP`: maps page routes → agent template IDs
- `EVENT_DEFINITIONS`: dict of all 23 MVP events with trigger conditions

#### 1.2 NEW: `backend/agentic_events/handler.py`
- `AgenticEventHandler` class
- `evaluate_and_emit(event_name, workspace_id, metadata)` — checks conditions, creates alert, pushes via WebSocket
- `scan_workspace(workspace_id)` — full workspace scan for all event types
- Uses existing `DashboardEventBroadcaster` for WebSocket push

#### 1.3 NEW: `backend/agentic_events/realtime_handlers.py`
- Subscribe to existing EventBus events: `lead.captured`, `ai_call.completed`, `campaign.paused`
- Each handler checks conditions and calls `AgenticEventHandler.evaluate_and_emit()`

#### 1.4 MODIFY: `backend/websocket/dashboard_events.py`
- Add `AGENT_ALERT = "agent_alert"` to `DashboardEventType`
- Add `notify_agent_alert()` method to `DashboardEventBroadcaster`
- Payload: `{ severity, title, message, targetPage, agentTemplateId, suggestedAction, autoMessage }`

#### 1.5 NEW: `backend/tasks/agentic_monitor_tasks.py`
5 Celery periodic tasks:
- `check_workspace_setup` (every 6h) — config completeness → 8 configuration events
- `check_lead_quality` (every 2h) — data quality scan → 6 lead events
- `check_campaign_health` (every 1h) — campaign issues → 4 campaign events
- `check_integration_health` (every 4h) — OAuth/sync status → integration events
- `check_credit_balance` (daily) — credit usage → billing events

#### 1.6 MODIFY: `backend/celery_app.py`
Add 5 new tasks to `beat_schedule`

#### 1.7 MODIFY: `backend/main.py`
Register agentic real-time event handlers alongside existing notification handlers

#### 1.8 NEW: `backend/api/workspace_health.py`
- `GET /api/workspace-health` — returns structured health report
- `GET /api/leads/quality-report` — returns lead quality issues
- `GET /api/agentic-events` — list alerts for workspace (with filters)
- `POST /api/agentic-events/{id}/dismiss` — dismiss an alert
- `POST /api/agentic-events/scan` — trigger manual scan

#### 1.9 MODIFY: `backend/main.py`
Register `workspace_health` router

---

### Phase 2: Agent Templates (Orchestrator + MCP)

#### 2.1 MODIFY: `packages/@bheem/socialselling-mcp/src/templates/index.ts`
Add 4 new templates using existing MCP tools:

**dashboard-page-agent** — overview/triage agent, uses all tools, system prompt: "You are the dashboard assistant. Summarize workspace health, route to specific pages for deep dives."

**leads-page-agent** — uses `leads()`, `analytics()`, `get_workspace_context()`. System prompt focuses on lead quality, pipeline management, deduplication, follow-ups.

**campaign-page-agent** — uses `campaigns()`, `content()`, `analytics()`, `leads()`. System prompt focuses on campaign setup, deliverability, A/B testing, audience.

**settings-page-agent** — uses `get_workspace_context()`, `get_integrations_status()`. System prompt focuses on configuration completeness, integration setup, AI call settings.

#### 2.2 NEW: `packages/@bheem/socialselling-mcp/src/tools/health-checks.ts`
- `check_workspace_health` tool — calls backend `/api/workspace-health`
- `check_lead_quality` tool — calls backend `/api/leads/quality-report`
- `get_active_alerts` tool — calls backend `/api/agentic-events`

#### 2.3 MODIFY: `packages/@bheem/socialselling-mcp/src/index.ts`
Register health-check tools

#### 2.4 Build & restart
```bash
cd /root/bheem-platform/packages/@bheem/socialselling-mcp && npm run build
pm2 restart socialselling-mcp
```

---

### Phase 3: Frontend — Reusable Agent Components

#### 3.1 NEW: `frontend/src/contexts/agent-events-context.tsx`
- `AgentEventProvider` wraps the app
- Listens to WebSocket `agent_alert` events
- Stores alerts in state, organized by `targetPage`
- Exposes `usePageAlerts(pageId)` hook
- Exposes `dismissAlert(id)` function

#### 3.2 NEW: `frontend/src/components/agents/AgentChatDrawer.tsx`
Extract from existing SEO `ChatTab.tsx` (lines ~375-460):
- Accepts `templateId`, `pageContext`, `quickActions` as props
- Creates agent: `POST /orchestrator-api/api/v1/agents`
- Streams: `POST /orchestrator-api/api/v1/agents/:id/execute` (SSE)
- Shows tool steps, markdown responses
- `autoMessage` prop: pre-fills and sends a message on open (from alert)

#### 3.3 NEW: `frontend/src/components/agents/PageAgentPanel.tsx`
Reusable component added to each page:
```tsx
<PageAgentPanel
  pageId="/dashboard/leads"
  templateId="leads-page-agent"
  agentName="Leads Assistant"
  pageContext={{ filters, selectedLeads }}
/>
```
Contains:
- **Alert banner** at top — most severe alert, dismiss button, "Fix with Agent" button
- **Chat drawer** — slide-in panel, 400px, right side
- **FAB button** — bottom-right, badge with unread count

#### 3.4 NEW: `frontend/src/components/agents/AgentAlertBanner.tsx`
- Renders priority-colored banner (red/amber/blue)
- Shows message + action button
- Dismiss button (calls `POST /api/agentic-events/{id}/dismiss`)

#### 3.5 MODIFY: SEO `ChatTab.tsx`
Refactor to use `AgentChatDrawer` internally (thin wrapper)

#### 3.6 MODIFY: Dashboard layout
Add `<AgentEventProvider>` to the dashboard layout wrapper

#### 3.7 MODIFY: 4 page files
Add `<PageAgentPanel>` to Dashboard, Leads, Campaigns, Settings pages

---

### Phase 4: Wire Up & Test

#### 4.1 Backend verification
```bash
# Restart backend
cd /root/bheem-platform/modules/bheem-socialselling && bash deploy.sh

# Test health endpoint
curl -s http://localhost:8000/api/workspace-health?workspace_id=test

# Trigger manual scan
curl -s -X POST http://localhost:8000/api/agentic-events/scan?workspace_id=test

# Check alerts
curl -s http://localhost:8000/api/agentic-events?workspace_id=test
```

#### 4.2 Agent template verification
```bash
# Check templates registered
curl -s https://agents.agentbheem.com/api/v1/templates | jq '.[].id' | grep page-agent

# Test agent creation
curl -s -X POST https://agents.agentbheem.com/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{"templateId":"leads-page-agent"}'
```

#### 4.3 Frontend verification
- Open Dashboard → verify AgentEventProvider connects
- Navigate to Leads → verify PageAgentPanel renders
- Trigger a test alert via WebSocket → verify banner appears
- Click "Talk to Agent" → verify chat drawer opens and streams

---

## Post-MVP Expansion

After MVP validated:
1. Add remaining 7 page agents (Communications, Analytics, Billing, Workflows, Ads, SEO activity, Inbox)
2. Implement remaining ~80 events
3. Add event preferences per user (which alerts to see)
4. Add deduplication (don't repeat same alert within 24h)
5. Add email digest (daily summary of unresolved alerts)
6. Add agent memory (remembers past workspace conversations)

## Critical Files

| File | Action |
|------|--------|
| `backend/websocket/dashboard_events.py` | Add AGENT_ALERT type |
| `backend/main.py` | Register handlers + health router |
| `backend/celery_app.py` | Add 5 monitor tasks |
| `socialselling-mcp/src/templates/index.ts` | Add 4 agent templates |
| `socialselling-mcp/src/index.ts` | Register health tools |
| `frontend/src/components/seo/tabs/ChatTab.tsx` | Extract to AgentChatDrawer |
| `frontend/src/app/(dashboard)/dashboard/page.tsx` | Add PageAgentPanel |
| `frontend/src/app/(dashboard)/dashboard/leads/page.tsx` | Add PageAgentPanel |
| `frontend/src/app/(dashboard)/dashboard/campaigns/page.tsx` | Add PageAgentPanel |
| `frontend/src/app/(dashboard)/dashboard/settings/page.tsx` | Add PageAgentPanel |

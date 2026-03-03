# RAG & Fine-Tuning: Centralized Architecture Translation

> Translates the developer's standalone RAG/Fine-Tuning plan into our centralized orchestrator + MCP architecture.

## What Changes vs What Stays

### STAYS in Python Backend (business logic)
- DB schema (training_pairs, finetuning_jobs, model_deployments, response_feedback) — **use as-is**
- Services: `rag_service.py`, `finetuning_service.py`, `model_router.py`, `training_data_service.py` — **use as-is**
- API endpoints: `/api/training/*`, `/api/finetuning/*`, `/api/autoreply/*` — **use as-is**
- Celery tasks for periodic checks — **use as-is**
- ChromaDB vector store — **use as-is**
- Confidence scoring, quality scoring algorithms — **use as-is**

### REMOVED (replaced by centralized architecture)
- `backend/agents/base_agent.py` — **DELETE** (we don't need a custom BaseAgent class)
- `backend/agents/rag_agent.py` — **DELETE** (becomes MCP tool + orchestrator template)
- `backend/agents/autoreply_agent.py` — **DELETE** (becomes MCP tool + orchestrator template)
- `backend/agents/training_collector_agent.py` — **DELETE** (becomes MCP tool)
- `backend/agents/finetuning_agent.py` — **DELETE** (becomes MCP tool + orchestrator template)
- `backend/agents/orchestrator.py` factory methods — **DELETE** (orchestrator at :8009 handles this)
- Inter-agent messaging (`send_message`, `context_request`, etc.) — **DELETE** (MCP tool calls replace this)

### NEW (centralized integration)
- MCP tools in `socialselling-mcp` that call the backend API endpoints
- Orchestrator templates for RAG, AutoReply, and Fine-Tuning agents

---

## Architecture

```
User (chat or auto-trigger)
        │
        ▼
┌─────────────────────────────┐
│  Orchestrator (:8009)       │
│                             │
│  Templates:                 │
│   autoreply-agent           │  ← generates replies, checks confidence
│   finetuning-agent          │  ← manages training jobs, deploys models
│   knowledge-base-agent      │  ← manages KB, answers KB questions
│                             │
│  All use socialselling-mcp  │
└──────────┬──────────────────┘
           │ MCP tool calls
           ▼
┌─────────────────────────────┐
│  socialselling-mcp (:9008)  │
│                             │
│  NEW tools:                 │
│   rag()          → 6 actions│
│   autoreply()    → 5 actions│
│   training()     → 5 actions│
│   finetuning()   → 7 actions│
│                             │
│  Existing tools:            │
│   leads(), campaigns(), etc.│
└──────────┬──────────────────┘
           │ HTTP calls
           ▼
┌─────────────────────────────┐
│  SocialSelling Backend      │
│  (:8000)                    │
│                             │
│  API endpoints:             │
│   /api/rag/*                │
│   /api/autoreply/*          │
│   /api/training/*           │
│   /api/finetuning/*         │
│                             │
│  Services (business logic): │
│   rag_service.py            │
│   model_router.py           │
│   training_data_service.py  │
│   finetuning_service.py     │
│                             │
│  ChromaDB + PostgreSQL      │
└─────────────────────────────┘
```

---

## Step-by-Step Translation

### Step 1: Backend — Keep Services + API, Remove Agent Classes

**Keep these files from developer's plan (build as-is):**

```
backend/
├── ai_services/
│   ├── rag_service.py              # KB search, chunking, embedding — USE AS-IS
│   ├── conversation_indexer.py     # Conversation indexing — USE AS-IS
│   ├── finetuning_service.py       # OpenAI fine-tuning API calls — USE AS-IS
│   ├── model_router.py             # Route to fine-tuned or base model — USE AS-IS
│   ├── training_data_service.py    # Training pair CRUD, quality scoring — USE AS-IS
│   └── isolated_vector_store.py    # Per-workspace ChromaDB isolation — USE AS-IS
│
├── api/
│   ├── training_data.py            # /api/training/* endpoints — USE AS-IS
│   ├── finetuning.py               # /api/finetuning/* endpoints — USE AS-IS
│   ├── autoreply.py                # /api/autoreply/* endpoints — USE AS-IS
│   └── rag.py                      # NEW: /api/rag/* endpoints (expose RAG service)
│
├── models/
│   ├── training_pair.py            # SQLAlchemy model — USE AS-IS
│   ├── finetuning_job.py           # SQLAlchemy model — USE AS-IS
│   ├── model_deployment.py         # SQLAlchemy model — USE AS-IS
│   └── response_feedback.py        # SQLAlchemy model — USE AS-IS
│
├── schemas/
│   ├── training.py                 # Pydantic schemas — USE AS-IS
│   ├── finetuning.py               # Pydantic schemas — USE AS-IS
│   └── autoreply.py                # Pydantic schemas — USE AS-IS
│
├── tasks/
│   ├── training_tasks.py           # Celery: check training readiness, cleanup
│   └── finetuning_tasks.py         # Celery: poll job status, auto-deploy
│
└── migrations/
    └── versions/
        └── xxxx_add_training_tables.py  # DB migration — USE AS-IS
```

**DELETE these files (replaced by MCP tools + orchestrator):**

```
backend/agents/rag_agent.py                    # → MCP tool rag()
backend/agents/autoreply_agent.py              # → MCP tool autoreply()
backend/agents/training_collector_agent.py     # → MCP tool training()
backend/agents/finetuning_agent.py             # → MCP tool finetuning()
backend/agents/orchestrator.py (new methods)   # → Orchestrator templates
```

### Step 2: Add RAG API Endpoint (backend needs this)

The developer's plan exposes training/finetuning/autoreply via API but RAG stays internal. We need a thin API for MCP to call:

```python
# backend/api/rag.py
router = APIRouter(prefix="/api/rag", tags=["RAG"])

@router.post("/search")
async def search_kb(workspace_id: str, query: str, n_results: int = 5):
    """Search knowledge base"""
    return await rag_service.search(workspace_id, query, n_results)

@router.post("/search-conversations")
async def search_conversations(workspace_id: str, query: str, filters: dict = None):
    """Search past conversations"""
    return await conversation_indexer.search(workspace_id, query, filters)

@router.post("/context")
async def get_combined_context(workspace_id: str, query: str, customer_id: str = None):
    """Get combined KB + conversation context for a message"""
    return await rag_service.get_combined_context(workspace_id, query, customer_id)

@router.post("/documents")
async def add_document(workspace_id: str, content: str, metadata: dict = None):
    """Add document to knowledge base"""
    return await rag_service.add_document(workspace_id, content, metadata)

@router.post("/index-conversation")
async def index_conversation(workspace_id: str, conversation_id: str):
    """Index a conversation for future RAG retrieval"""
    return await conversation_indexer.index_conversation(workspace_id, conversation_id)
```

### Step 3: MCP Tools (socialselling-mcp)

Add 4 new MCP tool files in `packages/@bheem/socialselling-mcp/src/tools/`:

#### `rag.ts` — RAG tool (6 actions)

```typescript
// Actions: search_kb, search_conversations, get_context, add_document,
//          index_conversation, get_customer_context
// Each action calls: POST /api/rag/{action}
```

#### `autoreply.ts` — AutoReply tool (5 actions)

```typescript
// Actions: generate_reply, validate_reply, send, get_settings, update_settings
// Each action calls: /api/autoreply/{action}
// generate_reply: the key one — returns reply + confidence + can_auto_send
```

#### `training.ts` — Training Data tool (5 actions)

```typescript
// Actions: capture_pair, rate_response, get_stats, export_dataset, list_pairs
// Each action calls: /api/training/{action}
```

#### `finetuning.ts` — Fine-Tuning tool (7 actions)

```typescript
// Actions: create_job, check_status, deploy_model, rollback,
//          compare_models, list_models, list_jobs
// Each action calls: /api/finetuning/{action}
```

Register all in `socialselling-mcp/src/index.ts`.

### Step 4: Orchestrator Templates

Add 3 new templates in `socialselling-mcp/src/templates/index.ts`:

#### `autoreply-agent`

**System prompt:**
```
You are the AutoReply Agent for SocialSelling. You help users manage
automatic responses across Instagram, WhatsApp, Facebook, and email.

When a message comes in:
1. Use rag({ action: 'get_context' }) to get KB + conversation context
2. Use autoreply({ action: 'generate_reply' }) to generate a response
3. If confidence >= threshold, use autoreply({ action: 'send' })
4. After sending, use training({ action: 'capture_pair' }) to save the pair

You can also:
- Check/update auto-reply settings
- Show auto-reply statistics
- Explain confidence scores
- Help tune thresholds per channel
```

**Tools:** `rag`, `autoreply`, `training`, `leads`, `get_workspace_context`
**Model:** `auto`

#### `finetuning-agent`

**System prompt:**
```
You are the Fine-Tuning Agent. You help users train custom AI models
from their conversation data.

Workflow:
1. Use training({ action: 'get_stats' }) to check data readiness
2. When 500+ quality pairs exist, offer to start fine-tuning
3. Use finetuning({ action: 'create_job' }) to start training
4. Use finetuning({ action: 'check_status' }) to monitor progress
5. When complete, use finetuning({ action: 'deploy_model' }) to deploy
6. Use finetuning({ action: 'compare_models' }) for A/B testing

You can explain training data quality, suggest improvements, and
guide users through the entire fine-tuning lifecycle.
```

**Tools:** `finetuning`, `training`, `get_workspace_context`
**Model:** `auto`

#### `knowledge-base-agent`

**System prompt:**
```
You are the Knowledge Base Agent. You help users manage their
knowledge base for RAG-powered auto-replies.

You can:
- Search the KB: rag({ action: 'search_kb' })
- Add documents: rag({ action: 'add_document' })
- Index conversations: rag({ action: 'index_conversation' })
- Get customer context: rag({ action: 'get_customer_context' })
- Show how context is used in auto-replies
```

**Tools:** `rag`, `get_workspace_context`
**Model:** `auto`

### Step 5: Inter-Agent Communication Translation

The developer's plan has agents sending messages to each other. In our architecture, this becomes **sequential MCP tool calls within a single agent execution**:

**BEFORE (developer's plan):**
```
AutoReplyAgent.send_message(rag_agent_id, "context_request", {...})
  → RAG Agent processes
  → RAG Agent.send_message(autoreply_agent_id, "context_response", {...})
  → AutoReplyAgent continues with context
```

**AFTER (centralized):**
```
autoreply-agent template executes:
  1. Calls rag({ action: 'get_context', query: message }) → gets context
  2. Calls autoreply({ action: 'generate_reply', message, context }) → gets reply
  3. If high confidence: calls autoreply({ action: 'send', reply }) → sends
  4. Calls training({ action: 'capture_pair', message, reply }) → saves pair
```

No inter-agent messaging needed. One agent, multiple tool calls, same result.

### Step 6: Auto-Trigger (WebSocket → AutoReply)

For automatic auto-reply (no user chat needed), add a **backend webhook handler**:

```python
# backend/api/autoreply.py — add this endpoint

@router.post("/webhook/incoming-message")
async def handle_incoming_message(message: IncomingMessage):
    """
    Called by WebSocket handler when a new customer message arrives.
    Generates auto-reply if conditions are met.
    """
    settings = await get_autoreply_settings(message.workspace_id)
    if not settings.enabled:
        return {"action": "skip"}

    if message.channel not in settings.channels:
        return {"action": "skip"}

    # Get RAG context
    context = await rag_service.get_combined_context(
        message.workspace_id, message.text, message.customer_id
    )

    # Get appropriate model
    model = await model_router.get_model(message.workspace_id, "autoreply")

    # Generate reply
    reply = await generate_reply(message, context, model)

    # Check confidence
    threshold = settings.channels[message.channel].threshold
    if reply.confidence >= threshold and settings.channels[message.channel].auto_send:
        await send_reply(message, reply)
        await capture_training_pair(message, reply)
        return {"action": "auto_sent", "confidence": reply.confidence}

    # Push suggestion to frontend via WebSocket
    await broadcast_reply_suggestion(message.workspace_id, message, reply)
    return {"action": "suggested", "confidence": reply.confidence}
```

Wire this into the existing WebSocket message handler in `websocket_server.py`.

---

## DB Schema — USE AS-IS

The developer's 4 tables are correct. No changes needed:
- `training_pairs` — training data pairs with quality scoring
- `finetuning_jobs` — fine-tuning job tracking
- `model_deployments` — deployed model tracking with A/B testing
- `response_feedback` — feedback loop

Run the migration as-is.

---

## Environment Variables — USE AS-IS

The developer's env vars are correct. Add them to the backend `.env`.

---

## Workspace Settings Schema — USE AS-IS

The developer's JSON config for autoreply/training/finetuning per workspace is correct. Store in existing `WorkspaceNotificationSettings` or create a new `WorkspaceAISettings` model.

---

## Implementation Order

### Week 1-2: Backend Services + DB
1. Run DB migration (4 tables)
2. Build services: `rag_service.py`, `model_router.py`, `training_data_service.py`, `finetuning_service.py`
3. Build API endpoints: `/api/rag/*`, `/api/autoreply/*`, `/api/training/*`, `/api/finetuning/*`
4. Add Celery tasks: `training_tasks.py`, `finetuning_tasks.py`
5. **DO NOT build** `backend/agents/*.py` — skip the custom agent classes entirely

### Week 3: MCP Tools
1. Add 4 tool files to `socialselling-mcp/src/tools/`: `rag.ts`, `autoreply.ts`, `training.ts`, `finetuning.ts`
2. Register in `index.ts`
3. Test each tool via MCP health check

### Week 4: Orchestrator Templates
1. Add 3 templates: `autoreply-agent`, `finetuning-agent`, `knowledge-base-agent`
2. Test via orchestrator API: create agent, execute, verify tool calls work
3. Wire auto-reply webhook into WebSocket handler

### Week 5: Frontend
1. Training data management UI (stats, quality review, export)
2. Fine-tuning job dashboard (create, monitor, deploy)
3. Auto-reply settings UI (channels, thresholds, confidence)
4. Model A/B testing dashboard

---

## Summary: What the Developer Should Do

1. **Build the backend services + API + DB migration** exactly as their plan says
2. **Skip `backend/agents/` entirely** — no BaseAgent, no custom orchestrator, no inter-agent messaging
3. **Add the `/api/rag/*` endpoints** (their plan is missing this — RAG was only internal)
4. **Tell me when the API endpoints are running** — I'll add the MCP tools and orchestrator templates from here
5. **Build the frontend UIs** as planned

The split is clean:
- **Developer builds**: Python backend (services, API, DB, Celery)
- **We build**: MCP tools + orchestrator templates (connects backend to our centralized agent platform)

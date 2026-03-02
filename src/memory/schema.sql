-- Workspace Memories Table
-- Persistent key-value store for agent memory, scoped by module/user/agent.
--
-- Run this migration on your PostgreSQL database to enable persistent memory.
-- If DATABASE_URL is not set, the memory store uses in-memory only.

CREATE TABLE IF NOT EXISTS workspace_memories (
  id          SERIAL PRIMARY KEY,
  scope       VARCHAR(20)  NOT NULL,          -- 'module' | 'user' | 'agent'
  scope_key   VARCHAR(255) NOT NULL,          -- e.g. 'mod:socialselling:user:123'
  key         VARCHAR(255) NOT NULL,          -- e.g. 'domain', 'cms_version'
  value       TEXT         NOT NULL,
  metadata    JSONB,                          -- { source, confidence, module }
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP                       -- NULL = never expires
);

-- Unique constraint: one value per (scope_key, key) pair
CREATE UNIQUE INDEX IF NOT EXISTS wm_scope_key_idx
  ON workspace_memories (scope_key, key);

-- Fast lookups by scope_key (list all facts for a scope)
CREATE INDEX IF NOT EXISTS wm_module_idx
  ON workspace_memories (scope_key);

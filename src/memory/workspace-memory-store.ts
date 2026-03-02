/**
 * Workspace Memory Store
 *
 * Persistent key-value memory for agents, scoped by module/user/agent.
 * In-memory cache with optional PostgreSQL write-through persistence.
 *
 * Scope hierarchy:
 *   module  → mod:{moduleId}                          (shared across all users in a module)
 *   user    → mod:{moduleId}:user:{userId}            (per-user per-module)
 *   agent   → mod:{moduleId}:agent:{templateId}       (per-agent-template)
 *
 * When DATABASE_URL is set, all writes are persisted to PostgreSQL.
 * When not set, memory lives only for the process lifetime (dev mode).
 */

import type { Pool as PgPool, PoolConfig } from 'pg';

// ─── Types ──────────────────────────────────────────

export type MemoryScope = 'module' | 'user' | 'agent';

export interface MemoryEntry {
  key: string;
  value: string;
  scope: MemoryScope;
  scopeKey: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface MemorySetOptions {
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

// ─── Store ──────────────────────────────────────────

export class WorkspaceMemoryStore {
  /** scopeKey → (key → entry) */
  private cache = new Map<string, Map<string, MemoryEntry>>();
  private pool: PgPool | null = null;
  private initialized = false;

  constructor(private databaseUrl?: string) {}

  // ─── Lifecycle ────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.databaseUrl) {
      try {
        // Dynamic import to avoid hard dependency on pg
        const { Pool } = await import('pg');
        this.pool = new Pool({ connectionString: this.databaseUrl } as PoolConfig);
        await this.ensureTable();
        console.log('[memory-store] PostgreSQL connected — memories will persist');
      } catch (err) {
        console.warn('[memory-store] PostgreSQL unavailable, using in-memory only:', (err as Error).message);
        this.pool = null;
      }
    } else {
      console.log('[memory-store] No DATABASE_URL — using in-memory only (memories lost on restart)');
    }

    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  // ─── CRUD ─────────────────────────────────────────

  async get(scopeKey: string, key: string): Promise<MemoryEntry | null> {
    // Check cache first
    const cached = this.cache.get(scopeKey)?.get(key);
    if (cached) {
      if (cached.expiresAt && cached.expiresAt < new Date()) {
        await this.delete(scopeKey, key);
        return null;
      }
      return cached;
    }

    // Fall through to DB
    if (this.pool) {
      try {
        const result = await this.pool.query(
          `SELECT * FROM workspace_memories WHERE scope_key = $1 AND key = $2`,
          [scopeKey, key],
        );
        if (result.rows.length > 0) {
          const entry = this.rowToEntry(result.rows[0]);
          if (entry.expiresAt && entry.expiresAt < new Date()) {
            await this.delete(scopeKey, key);
            return null;
          }
          this.cacheSet(entry);
          return entry;
        }
      } catch (err) {
        console.error('[memory-store] DB get failed:', (err as Error).message);
      }
    }

    return null;
  }

  async set(scopeKey: string, key: string, value: string, opts?: MemorySetOptions): Promise<void> {
    const scope = WorkspaceMemoryStore.parseScopeFromKey(scopeKey);
    const now = new Date();

    const entry: MemoryEntry = {
      key,
      value,
      scope,
      scopeKey,
      metadata: opts?.metadata,
      createdAt: now,
      updatedAt: now,
      expiresAt: opts?.expiresAt,
    };

    // Update cache
    this.cacheSet(entry);

    // Write-through to DB
    if (this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO workspace_memories (scope, scope_key, key, value, metadata, created_at, updated_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (scope_key, key) DO UPDATE SET
             value = EXCLUDED.value,
             metadata = EXCLUDED.metadata,
             updated_at = EXCLUDED.updated_at,
             expires_at = EXCLUDED.expires_at`,
          [scope, scopeKey, key, value, opts?.metadata ? JSON.stringify(opts.metadata) : null, now, now, opts?.expiresAt ?? null],
        );
      } catch (err) {
        console.error('[memory-store] DB set failed:', (err as Error).message);
      }
    }
  }

  async list(scopeKey: string): Promise<MemoryEntry[]> {
    // If DB is available, fetch from DB (authoritative)
    if (this.pool) {
      try {
        const result = await this.pool.query(
          `SELECT * FROM workspace_memories WHERE scope_key = $1 ORDER BY updated_at DESC`,
          [scopeKey],
        );
        const entries = result.rows.map((r: Record<string, unknown>) => this.rowToEntry(r));
        const now = new Date();
        const valid = entries.filter((e: MemoryEntry) => !e.expiresAt || e.expiresAt >= now);

        // Refresh cache
        const scopeMap = new Map<string, MemoryEntry>();
        for (const entry of valid) {
          scopeMap.set(entry.key, entry);
        }
        this.cache.set(scopeKey, scopeMap);

        return valid;
      } catch (err) {
        console.error('[memory-store] DB list failed:', (err as Error).message);
      }
    }

    // Fallback to cache
    const scopeMap = this.cache.get(scopeKey);
    if (!scopeMap) return [];

    const now = new Date();
    const entries: MemoryEntry[] = [];
    for (const entry of scopeMap.values()) {
      if (!entry.expiresAt || entry.expiresAt >= now) {
        entries.push(entry);
      }
    }
    return entries;
  }

  async delete(scopeKey: string, key: string): Promise<boolean> {
    let deleted = false;

    // Remove from cache
    const scopeMap = this.cache.get(scopeKey);
    if (scopeMap) {
      deleted = scopeMap.delete(key);
      if (scopeMap.size === 0) this.cache.delete(scopeKey);
    }

    // Remove from DB
    if (this.pool) {
      try {
        const result = await this.pool.query(
          `DELETE FROM workspace_memories WHERE scope_key = $1 AND key = $2`,
          [scopeKey, key],
        );
        if ((result.rowCount ?? 0) > 0) deleted = true;
      } catch (err) {
        console.error('[memory-store] DB delete failed:', (err as Error).message);
      }
    }

    return deleted;
  }

  // ─── Context Block Builder ────────────────────────

  /**
   * Build a context block merging module + user + agent memories.
   * Injected into the system prompt before each conversation turn.
   *
   * Token budget: ~500 tokens max. Each fact ≈ 5-10 tokens.
   * At most ~50 facts are included.
   */
  async getContextBlock(
    moduleId: string,
    userId?: string,
    templateId?: string,
  ): Promise<string> {
    const MAX_FACTS = 50;
    const lines: string[] = [];
    let count = 0;

    // 1. Module-level memories
    const moduleKey = WorkspaceMemoryStore.buildScopeKey('module', moduleId);
    const moduleEntries = await this.list(moduleKey);
    if (moduleEntries.length > 0) {
      for (const e of moduleEntries) {
        if (count >= MAX_FACTS) break;
        lines.push(`- ${e.key}: ${e.value}`);
        count++;
      }
    }

    // 2. User-level memories
    if (userId) {
      const userKey = WorkspaceMemoryStore.buildScopeKey('user', moduleId, userId);
      const userEntries = await this.list(userKey);
      if (userEntries.length > 0) {
        for (const e of userEntries) {
          if (count >= MAX_FACTS) break;
          lines.push(`- ${e.key}: ${e.value}`);
          count++;
        }
      }
    }

    // 3. Agent-level memories
    if (templateId) {
      const agentKey = WorkspaceMemoryStore.buildScopeKey('agent', moduleId, templateId);
      const agentEntries = await this.list(agentKey);
      if (agentEntries.length > 0) {
        for (const e of agentEntries) {
          if (count >= MAX_FACTS) break;
          lines.push(`- ${e.key}: ${e.value}`);
          count++;
        }
      }
    }

    if (lines.length === 0) return '';

    const scopeLabel = [
      `module: ${moduleId}`,
      userId ? `user: ${userId}` : null,
      templateId ? `agent: ${templateId}` : null,
    ].filter(Boolean).join(', ');

    return [
      '<workspace_memory>',
      `## Known Facts (${scopeLabel})`,
      ...lines,
      '</workspace_memory>',
      'You can update facts with memory_set and retrieve with memory_get.',
    ].join('\n');
  }

  // ─── Scope Key Helpers ────────────────────────────

  static buildScopeKey(scope: MemoryScope, moduleId: string, id?: string): string {
    switch (scope) {
      case 'module':
        return `mod:${moduleId}`;
      case 'user':
        if (!id) throw new Error('user scope requires userId');
        return `mod:${moduleId}:user:${id}`;
      case 'agent':
        if (!id) throw new Error('agent scope requires templateId');
        return `mod:${moduleId}:agent:${id}`;
    }
  }

  static parseScopeFromKey(scopeKey: string): MemoryScope {
    if (scopeKey.includes(':agent:')) return 'agent';
    if (scopeKey.includes(':user:')) return 'user';
    return 'module';
  }

  // ─── Internal Helpers ─────────────────────────────

  private cacheSet(entry: MemoryEntry): void {
    let scopeMap = this.cache.get(entry.scopeKey);
    if (!scopeMap) {
      scopeMap = new Map();
      this.cache.set(entry.scopeKey, scopeMap);
    }
    scopeMap.set(entry.key, entry);
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      key: row.key as string,
      value: row.value as string,
      scope: row.scope as MemoryScope,
      scopeKey: row.scope_key as string,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown> : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
    };
  }

  private async ensureTable(): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS workspace_memories (
        id SERIAL PRIMARY KEY,
        scope VARCHAR(20) NOT NULL,
        scope_key VARCHAR(255) NOT NULL,
        key VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP
      )
    `);

    // Create indexes (IF NOT EXISTS for idempotency)
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wm_scope_key_idx ON workspace_memories (scope_key, key)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS wm_module_idx ON workspace_memories (scope_key)
    `);
  }
}

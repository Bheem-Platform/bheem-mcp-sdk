/**
 * Drizzle-compatible schema definition for workspace_memories table.
 *
 * If your project uses Drizzle ORM, you can import this schema directly.
 * Otherwise, use schema.sql for raw migration.
 *
 * Usage with Drizzle:
 *   import { workspaceMemories } from './schema.js';
 *   const rows = await db.select().from(workspaceMemories).where(eq(workspaceMemories.scopeKey, key));
 */

// Type-only definitions matching the Drizzle pgTable shape.
// This avoids a hard dependency on drizzle-orm while documenting the schema.

export interface WorkspaceMemoryRow {
  id: number;
  scope: 'module' | 'user' | 'agent';
  scope_key: string;
  key: string;
  value: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
}

/**
 * Drizzle schema definition (copy into your schema.ts if using Drizzle):
 *
 * ```typescript
 * import { pgTable, serial, varchar, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
 *
 * export const workspaceMemories = pgTable('workspace_memories', {
 *   id: serial('id').primaryKey(),
 *   scope: varchar('scope', { length: 20 }).notNull(),
 *   scopeKey: varchar('scope_key', { length: 255 }).notNull(),
 *   key: varchar('key', { length: 255 }).notNull(),
 *   value: text('value').notNull(),
 *   metadata: jsonb('metadata'),
 *   createdAt: timestamp('created_at').defaultNow().notNull(),
 *   updatedAt: timestamp('updated_at').defaultNow().notNull(),
 *   expiresAt: timestamp('expires_at'),
 * }, (table) => ({
 *   scopeKeyIdx: uniqueIndex('wm_scope_key_idx').on(table.scopeKey, table.key),
 *   moduleIdx: index('wm_module_idx').on(table.scopeKey),
 * }));
 * ```
 */
export const WORKSPACE_MEMORIES_TABLE = 'workspace_memories';

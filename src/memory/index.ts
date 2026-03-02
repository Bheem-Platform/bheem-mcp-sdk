/**
 * Workspace Memory — barrel exports
 *
 * Usage:
 *   import { WorkspaceMemoryStore, createMemoryTools } from './memory/index.js';
 */

export { WorkspaceMemoryStore } from './workspace-memory-store.js';
export type { MemoryScope, MemoryEntry, MemorySetOptions } from './workspace-memory-store.js';
export { createMemoryTools } from './memory-tools.js';
export type { WorkspaceMemoryRow } from './schema.js';
export { WORKSPACE_MEMORIES_TABLE } from './schema.js';

/**
 * Memory MCP Tools
 *
 * 4 tools that let agents store and retrieve persistent facts.
 * Scope is auto-resolved from the MCP request context (claims).
 *
 * Tools:
 *   memory_set    — Store/update a fact
 *   memory_get    — Retrieve a stored fact
 *   memory_list   — List all stored facts for the current scope
 *   memory_delete — Remove a stored fact
 *
 * The agent never needs to construct scope keys — they're built
 * automatically from claims.module, claims.user_id, claims.template_id.
 */

import type { McpToolDefinition, McpRequestContext } from '@bheemverse/mcp-server-core';
import { WorkspaceMemoryStore, type MemoryScope } from './workspace-memory-store.js';

/**
 * Resolve the scope key from MCP claims + optional scope override.
 * Default scope is 'user' (most common — per-user per-module).
 */
function resolveScopeKey(
  claims: Record<string, unknown>,
  scopeOverride?: string,
): { scopeKey: string; scope: MemoryScope } {
  const moduleId = (claims.module as string) || 'default';
  const userId = claims.user_id as string | undefined;
  const templateId = claims.template_id as string | undefined;
  const scope = (scopeOverride as MemoryScope) || 'user';

  switch (scope) {
    case 'module':
      return { scopeKey: WorkspaceMemoryStore.buildScopeKey('module', moduleId), scope };
    case 'agent':
      if (!templateId) {
        return { scopeKey: WorkspaceMemoryStore.buildScopeKey('module', moduleId), scope: 'module' };
      }
      return { scopeKey: WorkspaceMemoryStore.buildScopeKey('agent', moduleId, templateId), scope };
    case 'user':
    default:
      if (!userId) {
        return { scopeKey: WorkspaceMemoryStore.buildScopeKey('module', moduleId), scope: 'module' };
      }
      return { scopeKey: WorkspaceMemoryStore.buildScopeKey('user', moduleId, userId), scope };
  }
}

/**
 * Create the 4 memory MCP tools bound to a WorkspaceMemoryStore instance.
 */
export function createMemoryTools(store: WorkspaceMemoryStore): McpToolDefinition[] {
  return [
    // ─── memory_set ─────────────────────────────────
    {
      name: 'memory_set',
      description: `Store or update a persistent fact about the user or workspace.
Use this when the user tells you something worth remembering across sessions.
Examples: domain name, CMS version, industry, preferences, connected services.
- key: Short identifier (e.g. 'domain', 'cms_version', 'industry')
- value: The fact to store (e.g. 'example.com', 'wordpress 6.4', 'e-commerce')
- scope: Optional — 'user' (default, per-user), 'module' (shared), 'agent' (per-agent)`,
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Fact identifier (e.g. "domain", "cms_version")',
          },
          value: {
            type: 'string',
            description: 'The fact value to store',
          },
          scope: {
            type: 'string',
            enum: ['user', 'module', 'agent'],
            description: 'Memory scope — user (default), module (shared), or agent (per-template)',
          },
        },
        required: ['key', 'value'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const { scopeKey, scope } = resolveScopeKey(claims, input.scope as string | undefined);

        try {
          await store.set(scopeKey, input.key as string, input.value as string, {
            metadata: {
              source: 'agent',
              module: claims.module || 'default',
              setBy: claims.template_id || 'unknown',
            },
          });
          return {
            success: true,
            message: `Stored "${input.key}" = "${input.value}" (scope: ${scope})`,
            scopeKey,
          };
        } catch (err) {
          return { error: `Failed to store memory: ${(err as Error).message}` };
        }
      },
    },

    // ─── memory_get ─────────────────────────────────
    {
      name: 'memory_get',
      description: `Retrieve a stored fact by key.
Returns the value if found, or null if not stored.
- key: The fact identifier to look up
- scope: Optional — 'user' (default), 'module', 'agent'`,
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Fact identifier to retrieve',
          },
          scope: {
            type: 'string',
            enum: ['user', 'module', 'agent'],
            description: 'Memory scope to search in',
          },
        },
        required: ['key'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const { scopeKey } = resolveScopeKey(claims, input.scope as string | undefined);

        try {
          const entry = await store.get(scopeKey, input.key as string);
          if (!entry) {
            return { found: false, key: input.key, value: null };
          }
          return {
            found: true,
            key: entry.key,
            value: entry.value,
            scope: entry.scope,
            updatedAt: entry.updatedAt.toISOString(),
          };
        } catch (err) {
          return { error: `Failed to get memory: ${(err as Error).message}` };
        }
      },
    },

    // ─── memory_list ────────────────────────────────
    {
      name: 'memory_list',
      description: `List all stored facts for the current scope.
Returns an array of {key, value} pairs.
- scope: Optional — 'user' (default), 'module', 'agent'`,
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['user', 'module', 'agent'],
            description: 'Memory scope to list',
          },
        },
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const { scopeKey, scope } = resolveScopeKey(claims, input.scope as string | undefined);

        try {
          const entries = await store.list(scopeKey);
          return {
            scope,
            scopeKey,
            count: entries.length,
            facts: entries.map((e) => ({
              key: e.key,
              value: e.value,
              updatedAt: e.updatedAt.toISOString(),
            })),
          };
        } catch (err) {
          return { error: `Failed to list memories: ${(err as Error).message}` };
        }
      },
    },

    // ─── memory_delete ──────────────────────────────
    {
      name: 'memory_delete',
      description: `Remove a stored fact by key.
Use when the user says to forget something or when a fact is no longer valid.
- key: The fact identifier to remove
- scope: Optional — 'user' (default), 'module', 'agent'`,
      inputSchema: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Fact identifier to remove',
          },
          scope: {
            type: 'string',
            enum: ['user', 'module', 'agent'],
            description: 'Memory scope to delete from',
          },
        },
        required: ['key'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const { scopeKey } = resolveScopeKey(claims, input.scope as string | undefined);

        try {
          const deleted = await store.delete(scopeKey, input.key as string);
          return {
            success: true,
            deleted,
            message: deleted
              ? `Removed "${input.key}" from memory`
              : `"${input.key}" was not found in memory`,
          };
        } catch (err) {
          return { error: `Failed to delete memory: ${(err as Error).message}` };
        }
      },
    },
  ];
}

/**
 * Item Tools (EXAMPLE — replace with your domain)
 *
 * This file demonstrates the 4 common tool patterns:
 *   1. LIST   — paginated listing with filters
 *   2. GET    — single item by ID
 *   3. CREATE — create new item (requires auth)
 *   4. ACTION — perform an operation (requires auth)
 *
 * Copy this file, rename it, and adapt to your domain.
 * Each tool needs: name, description, inputSchema, execute.
 *
 * ┌────────────────────────────────────────────────────────┐
 * │  TIPS FOR WRITING GOOD TOOLS                          │
 * │                                                       │
 * │  • description is what the LLM reads to decide        │
 * │    when to use your tool — make it clear & specific   │
 * │  • inputSchema uses JSON Schema format                │
 * │  • Always handle errors gracefully (try/catch)        │
 * │  • Check user scope for write operations              │
 * │  • Return structured data, not raw HTML/binary        │
 * └────────────────────────────────────────────────────────┘
 */

import type { McpToolDefinition } from '@bheemverse/mcp-server-core';
import { apiClient } from '../utils/api-client.js';
import { getUserScope, authHeaders } from '../utils/scope.js';

export const itemTools: McpToolDefinition[] = [

  // ─── Pattern 1: LIST (paginated, filtered) ─────────────
  {
    name: 'list_items',
    description: 'List items with optional status filter and pagination',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status: active, archived, draft',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)',
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default: 0)',
        },
      },
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      if (scope.role === 'visitor') {
        return { error: 'Please log in to view items.' };
      }
      try {
        const params: Record<string, unknown> = {
          status: input.status,
          limit: input.limit ?? 20,
          offset: input.offset ?? 0,
        };
        // Scope to user's own items (unless admin)
        if (!scope.canAccessAll && scope.userId) {
          params.owner_id = scope.userId;
        }
        const { data } = await apiClient.get('/api/items', {
          params,
          headers: authHeaders(scope),
        });
        return data;
      } catch (error: any) {
        return { error: 'Failed to list items', details: error.message };
      }
    },
  },

  // ─── Pattern 2: GET (single item by ID) ────────────────
  {
    name: 'get_item',
    description: 'Get detailed information about a specific item by ID',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The item ID to look up',
        },
      },
      required: ['item_id'],
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      if (scope.role === 'visitor') {
        return { error: 'Please log in to view item details.' };
      }
      try {
        const { data } = await apiClient.get(`/api/items/${input.item_id}`, {
          headers: authHeaders(scope),
        });
        return data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return { error: `Item not found: ${input.item_id}` };
        }
        return { error: 'Failed to get item', details: error.message };
      }
    },
  },

  // ─── Pattern 3: CREATE (requires write permission) ─────
  {
    name: 'create_item',
    description: 'Create a new item with a name and optional description',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Item name',
        },
        description: {
          type: 'string',
          description: 'Item description',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['name'],
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      if (!scope.canWrite) {
        return { error: 'Please log in to create items.' };
      }
      try {
        const body: Record<string, unknown> = { ...input };
        if (!scope.canAccessAll && scope.userId) {
          body.owner_id = scope.userId;
        }
        const { data } = await apiClient.post('/api/items', body, {
          headers: authHeaders(scope),
        });
        return data;
      } catch (error: any) {
        return { error: 'Failed to create item', details: error.message };
      }
    },
  },

  // ─── Pattern 4: ACTION (perform operation on item) ─────
  {
    name: 'archive_item',
    description: 'Archive an item by ID. Archived items are hidden from default listings.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'The item ID to archive',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for archiving',
        },
      },
      required: ['item_id'],
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      if (!scope.canWrite) {
        return { error: 'Please log in to archive items.' };
      }
      try {
        const { data } = await apiClient.post(
          `/api/items/${input.item_id}/archive`,
          { reason: input.reason },
          { headers: authHeaders(scope) },
        );
        return data;
      } catch (error: any) {
        return { error: 'Failed to archive item', details: error.message };
      }
    },
  },
];

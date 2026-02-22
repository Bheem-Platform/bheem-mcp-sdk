/**
 * Items Domain Tool (EXAMPLE — replace with your domain)
 *
 * Claude Code Style: ONE tool per domain with action routing.
 * Instead of 5 separate tools (list_items, get_item, create_item, etc.),
 * you have ONE "items" tool with an `action` parameter.
 *
 * The LLM reads the description to know what actions are available.
 * This keeps the tool count low (3-5 per module) and context usage minimal.
 *
 * ┌────────────────────────────────────────────────────────┐
 * │  HOW CLAUDE CODE DOES IT                              │
 * │                                                       │
 * │  Claude Code has ~10 tools (Bash, Read, Write, etc.)  │
 * │  Bash alone handles: git, npm, docker, curl, python...│
 * │  The system prompt teaches WHEN to use each.          │
 * │                                                       │
 * │  YOUR AGENT: same pattern.                            │
 * │  One "items" tool handles: list, get, create, update  │
 * │  The system prompt teaches the workflow.              │
 * └────────────────────────────────────────────────────────┘
 */

import type { McpToolDefinition } from '@bheemverse/mcp-server-core';
import { apiClient } from '../utils/api-client.js';
import { getUserScope, authHeaders } from '../utils/scope.js';

export const itemTools: McpToolDefinition[] = [
  {
    name: 'items',
    description: `Item management operations. Available actions:
- list: List items with optional filters (params: status?, limit?, offset?)
- get: Get item details by ID (params: item_id)
- create: Create a new item (params: name, description?, tags?)
- update: Update item fields (params: item_id, name?, description?, tags?)
- delete: Delete an item (params: item_id)
- archive: Archive an item (params: item_id, reason?)`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'archive'],
          description: 'The operation to perform',
        },
        params: {
          type: 'object',
          description: 'Action-specific parameters (see action descriptions above)',
        },
      },
      required: ['action'],
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      const p = (input.params || {}) as Record<string, any>;
      const headers = authHeaders(scope);

      try {
        switch (input.action) {
          case 'list': {
            if (scope.role === 'visitor') return { error: 'Please log in.' };
            const params: Record<string, unknown> = {
              status: p.status,
              limit: p.limit ?? 20,
              offset: p.offset ?? 0,
            };
            if (!scope.canAccessAll && scope.userId) {
              params.owner_id = scope.userId;
            }
            return (await apiClient.get('/api/items', { params, headers })).data;
          }

          case 'get': {
            if (scope.role === 'visitor') return { error: 'Please log in.' };
            return (await apiClient.get(`/api/items/${p.item_id}`, { headers })).data;
          }

          case 'create': {
            if (!scope.canWrite) return { error: 'Write access required.' };
            const body: Record<string, unknown> = {
              name: p.name,
              description: p.description,
              tags: p.tags,
            };
            if (!scope.canAccessAll && scope.userId) {
              body.owner_id = scope.userId;
            }
            return (await apiClient.post('/api/items', body, { headers })).data;
          }

          case 'update': {
            if (!scope.canWrite) return { error: 'Write access required.' };
            const { item_id, ...updates } = p;
            return (await apiClient.patch(`/api/items/${item_id}`, updates, { headers })).data;
          }

          case 'delete': {
            if (!scope.canWrite) return { error: 'Write access required.' };
            return (await apiClient.delete(`/api/items/${p.item_id}`, { headers })).data;
          }

          case 'archive': {
            if (!scope.canWrite) return { error: 'Write access required.' };
            return (await apiClient.post(`/api/items/${p.item_id}/archive`, {
              reason: p.reason,
            }, { headers })).data;
          }

          default:
            return { error: `Unknown action: ${input.action}` };
        }
      } catch (error: any) {
        return { error: `Items ${input.action} failed`, details: error.message };
      }
    },
  },
];

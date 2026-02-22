/**
 * Analytics Domain Tool (EXAMPLE — replace with your domain)
 *
 * One tool, multiple actions. Same pattern as items.ts.
 */

import type { McpToolDefinition } from '@bheemverse/mcp-server-core';
import { apiClient } from '../utils/api-client.js';
import { getUserScope, authHeaders } from '../utils/scope.js';

export const analyticsTools: McpToolDefinition[] = [
  {
    name: 'analytics',
    description: `Analytics and reporting operations. Available actions:
- dashboard: Get dashboard stats — totals, trends (params: period?)
- public_stats: Get public platform stats — no login required`,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['dashboard', 'public_stats'],
          description: 'The analytics operation to perform',
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
          case 'dashboard': {
            if (scope.role === 'visitor') return { error: 'Please log in.' };
            const params: Record<string, unknown> = { period: p.period ?? '30d' };
            if (!scope.canAccessAll && scope.userId) {
              params.user_id = scope.userId;
            }
            return (await apiClient.get('/api/analytics/dashboard', { params, headers })).data;
          }

          case 'public_stats':
            return (await apiClient.get('/api/public/stats')).data;

          default:
            return { error: `Unknown action: ${input.action}` };
        }
      } catch (error: any) {
        return { error: `Analytics ${input.action} failed`, details: error.message };
      }
    },
  },
];

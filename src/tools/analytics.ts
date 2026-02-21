/**
 * Analytics Tools (EXAMPLE — replace with your domain)
 *
 * Demonstrates:
 *   - Public tools (no auth required)
 *   - Scoped tools (user sees own data, admin sees all)
 *   - Aggregation tools with time period filters
 */

import type { McpToolDefinition } from '@bheemverse/mcp-server-core';
import { apiClient } from '../utils/api-client.js';
import { getUserScope, authHeaders } from '../utils/scope.js';

export const analyticsTools: McpToolDefinition[] = [

  // ─── Scoped Analytics (user/admin) ─────────────────────
  {
    name: 'get_dashboard_stats',
    description: 'Get dashboard statistics — total items, active items, and trends over a time period',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'Time period: today, 7d, 30d, 90d, all (default: 30d)',
        },
      },
    },
    execute: async (input, context) => {
      const scope = getUserScope(context);
      if (scope.role === 'visitor') {
        return { error: 'Please log in to view dashboard stats.' };
      }
      try {
        const params: Record<string, unknown> = {
          period: input.period ?? '30d',
        };
        if (!scope.canAccessAll && scope.userId) {
          params.user_id = scope.userId;
        }
        const { data } = await apiClient.get('/api/analytics/dashboard', {
          params,
          headers: authHeaders(scope),
        });
        return data;
      } catch (error: any) {
        return { error: 'Failed to get dashboard stats', details: error.message };
      }
    },
  },

  // ─── Public Tool (no auth) ─────────────────────────────
  {
    name: 'get_public_stats',
    description: 'Get public platform statistics — total users, total items published. No login required.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      try {
        const { data } = await apiClient.get('/api/public/stats');
        return data;
      } catch (error: any) {
        return { error: 'Failed to get public stats', details: error.message };
      }
    },
  },
];

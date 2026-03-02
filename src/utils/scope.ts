/**
 * User Scope Helper
 *
 * Extracts role + permissions from MCP request context.
 * The orchestrator/bridge injects these headers automatically:
 *   x-user-role, x-user-id, x-workspace-id, x-user-jwt
 *
 * Usage in tools:
 *   const scope = getUserScope(context);
 *   if (scope.role === 'visitor') return { error: 'Please log in.' };
 *   if (!scope.canWrite) return { error: 'Read-only access.' };
 */

import type { McpRequestContext } from '@bheemverse/mcp-server-core';

export interface UserScope {
  role: 'visitor' | 'user' | 'admin';
  userId?: string;
  userJwt?: string;
  workspaceId?: string;
  /** Module ID (e.g. 'socialselling', 'trading', 'cloud') */
  module?: string;
  /** Agent template ID (e.g. 'seo-analysis-agent') */
  templateId?: string;
  /** true if role is 'user' or 'admin' */
  canWrite: boolean;
  /** true if role is 'admin' */
  canAccessAll: boolean;
}

export function getUserScope(context?: McpRequestContext): UserScope {
  const claims = (context?.claims || {}) as Record<string, unknown>;
  const role = (claims.user_role as string) || 'visitor';
  return {
    role: role as UserScope['role'],
    userId: claims.user_id as string | undefined,
    userJwt: claims.user_jwt as string | undefined,
    workspaceId: claims.workspace_id as string | undefined,
    module: claims.module as string | undefined,
    templateId: claims.template_id as string | undefined,
    canWrite: role !== 'visitor',
    canAccessAll: role === 'admin',
  };
}

/**
 * Build auth headers to forward to your backend.
 * If the user has a JWT, forward it so your backend can validate.
 */
export function authHeaders(scope: UserScope): Record<string, string> {
  if (scope.userJwt) {
    return { Authorization: `Bearer ${scope.userJwt}` };
  }
  return {};
}

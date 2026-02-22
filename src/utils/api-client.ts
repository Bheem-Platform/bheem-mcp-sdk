/**
 * API Client
 *
 * Axios instance pre-configured for your backend service.
 * All tools import from here — single place to change the base URL.
 *
 * Pattern: Each MCP server talks to ONE backend API.
 *   - socialselling-mcp → socialselling backend (Django)
 *   - cloud-mcp         → cloud backend API
 *   - your-mcp          → your backend service
 *
 * IMPORTANT: Set BACKEND_API_URL in your .env — no localhost defaults.
 * Your MCP server runs on a separate server/container from your backend.
 */

import axios from 'axios';

if (!process.env['BACKEND_API_URL']) {
  console.warn('[api-client] BACKEND_API_URL not set — API calls will fail');
}

const BACKEND_API_URL = process.env['BACKEND_API_URL'] ?? '';
const RAG_SERVICE_URL = process.env['RAG_SERVICE_URL'] ?? '';

/**
 * Main backend client.
 * Used by all tools to call your module's REST API.
 */
export const apiClient = axios.create({
  baseURL: BACKEND_API_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

/**
 * RAG client (optional).
 * Only needed if your module has a knowledge base.
 * Delete if not using RAG.
 */
export const ragClient = axios.create({
  baseURL: `${RAG_SERVICE_URL}/my-module`,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

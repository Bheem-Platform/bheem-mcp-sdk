/**
 * API Client
 *
 * Axios instance pre-configured for your backend service.
 * All tools import from here — single place to change the base URL.
 *
 * Pattern: Each MCP server talks to ONE backend API.
 *   - socialselling-mcp → localhost:8000 (Django)
 *   - cloud-mcp         → cloud orchestrator API
 *   - your-mcp          → your backend service
 */

import axios from 'axios';

const BACKEND_API_URL = process.env['BACKEND_API_URL'] ?? 'http://localhost:3000';
const RAG_SERVICE_URL = process.env['RAG_SERVICE_URL'] ?? 'http://localhost:9100';

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

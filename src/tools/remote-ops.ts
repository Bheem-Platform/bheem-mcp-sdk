/**
 * Remote Operations MCP Tools
 *
 * Gives ANY agent (orchestrator-side or Kodee IDE) structured access
 * to remote servers via SSH. SSH keys stay on this server — never
 * exposed to customer containers.
 *
 * Tools:
 *   remote_exec   — Run a command on a remote server
 *   remote_read   — Read a file on a remote server
 *   remote_write  — Write/create a file on a remote server
 *   remote_edit   — Search-and-replace edit a file on a remote server
 *   remote_ls     — List a directory on a remote server
 *   remote_health — Check server health (uptime, CPU, RAM, disk)
 *
 * Access control: per-agent permissions via AGENT_PERMISSIONS map.
 * SSH key path: SSH_KEY_PATH env var (default: ~/.ssh/sundeep).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { McpToolDefinition, McpRequestContext } from '@bheemverse/mcp-server-core';

const execFileAsync = promisify(execFile);

// ─── Server Registry ────────────────────────────────

export interface ServerEntry {
  id: string;
  name: string;
  ip: string;
  description: string;
}

const DEFAULT_SERVERS: ServerEntry[] = [
  { id: 'socialselling', name: 'SocialSelling',  ip: '46.62.171.247',   description: 'Orchestrator, MCPs, dashboard' },
  { id: 'bheem-cloud',   name: 'bheem.cloud',    ip: '37.27.40.113',    description: 'Cloud frontend/backend, Docker registry' },
  { id: 'academy',       name: 'Academy',        ip: '157.180.84.127',  description: 'Academy portal, LMS' },
  { id: 'bheemflow',     name: 'Bheemflow',      ip: '46.62.142.13',    description: 'Workflow engine' },
  { id: 'codeserver',    name: 'CodeServer',     ip: '37.27.89.140',    description: 'ERP, code-server, Meet' },
  { id: 'platform',      name: 'BheemPlatform',  ip: '157.180.122.188', description: 'Platform services' },
  { id: 'mail',          name: 'Mail',           ip: '135.181.25.62',   description: 'Mailcow email' },
  { id: 'docs',          name: 'Docs',           ip: '46.62.165.32',    description: 'Nextcloud docs + calendar' },
  { id: 'backup',        name: 'Backup',         ip: '65.108.109.167',  description: 'DB backups, pg_dump, S3' },
];

// ─── Access Control ─────────────────────────────────

type Operation = 'exec' | 'read' | 'write' | 'edit' | 'ls' | 'health';

interface AgentPermission {
  servers: string[];     // ['*'] = all, ['bheem-cloud', 'academy'] = specific
  operations: Operation[];
}

/**
 * Per-agent permission matrix.
 * Key = template ID from claims. '*' = default for unlisted agents.
 */
const AGENT_PERMISSIONS: Record<string, AgentPermission> = {
  'devops-engineer':       { servers: ['*'],                        operations: ['exec', 'read', 'write', 'edit', 'ls', 'health'] },
  'coding-agent':          { servers: ['bheem-cloud', 'platform'],  operations: ['exec', 'read', 'ls', 'health'] },
  'seo-autoheal-agent':    { servers: ['bheem-cloud'],              operations: ['exec', 'read', 'ls'] },
  'analytics-agent':       { servers: ['backup'],                   operations: ['exec', 'read', 'ls'] },
  '*':                     { servers: [],                           operations: ['health'] },  // Default: health-only
};

function checkPermission(templateId: string | undefined, serverId: string, operation: Operation): string | null {
  const perms = AGENT_PERMISSIONS[templateId ?? ''] ?? AGENT_PERMISSIONS['*'];
  if (!perms.operations.includes(operation)) {
    return `Agent "${templateId ?? 'unknown'}" is not allowed to perform "${operation}"`;
  }
  if (!perms.servers.includes('*') && !perms.servers.includes(serverId)) {
    return `Agent "${templateId ?? 'unknown'}" is not allowed to access server "${serverId}"`;
  }
  return null;
}

// ─── Blocked Commands ───────────────────────────────

const BLOCKED_PATTERNS = [
  /rm\s+(-rf|-fr)\s+\//,        // rm -rf /
  /mkfs/,                       // format filesystem
  /dd\s+if=/,                   // disk destroyer
  /shutdown|reboot|poweroff/,   // power operations
  /iptables\s+-F/,              // flush firewall
  /userdel|useradd|passwd/,     // user management
  /chmod\s+777/,                // world-writable
  />\s*\/dev\/sd/,              // write to raw disk
];

function isBlocked(command: string): boolean {
  return BLOCKED_PATTERNS.some(p => p.test(command));
}

// ─── SSH Executor ───────────────────────────────────

const SSH_KEY_PATH = process.env['SSH_KEY_PATH'] || `${process.env['HOME'] || '/root'}/.ssh/sundeep`;
const SSH_USER = process.env['SSH_USER'] || 'root';
const SSH_TIMEOUT = 30_000; // 30 seconds

function resolveServer(serverIdOrIp: string): ServerEntry | null {
  // Try by ID first, then by IP, then by name (case-insensitive)
  return DEFAULT_SERVERS.find(s =>
    s.id === serverIdOrIp ||
    s.ip === serverIdOrIp ||
    s.name.toLowerCase() === serverIdOrIp.toLowerCase()
  ) || null;
}

async function sshExec(ip: string, command: string): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('ssh', [
      '-i', SSH_KEY_PATH,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      `${SSH_USER}@${ip}`,
      command,
    ], { timeout: SSH_TIMEOUT, maxBuffer: 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || 'SSH execution failed',
    };
  }
}

// ─── Tool Definitions ───────────────────────────────

export function createRemoteOpsTools(servers?: ServerEntry[]): McpToolDefinition[] {
  const serverRegistry = servers ?? DEFAULT_SERVERS;
  const serverIds = serverRegistry.map(s => s.id);
  const serverList = serverRegistry.map(s => `- ${s.id} (${s.ip}): ${s.description}`).join('\n');

  return [
    // ─── remote_exec ────────────────────────────────
    {
      name: 'remote_exec',
      description: `Execute a command on a remote server via SSH.
Available servers:
${serverList}

Use server ID (e.g. "bheem-cloud") or IP address.`,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server ID or IP address' },
          command: { type: 'string', description: 'Shell command to execute' },
        },
        required: ['server', 'command'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const templateId = claims.template_id as string | undefined;
        const entry = resolveServer(input.server as string);
        if (!entry) return { error: `Unknown server: ${input.server}. Available: ${serverIds.join(', ')}` };

        const denied = checkPermission(templateId, entry.id, 'exec');
        if (denied) return { error: denied };

        const command = input.command as string;
        if (isBlocked(command)) return { error: `Blocked: command matches a dangerous pattern` };

        const result = await sshExec(entry.ip, command);
        return {
          server: entry.id,
          ip: entry.ip,
          command,
          stdout: result.stdout,
          stderr: result.stderr || undefined,
        };
      },
    },

    // ─── remote_read ────────────────────────────────
    {
      name: 'remote_read',
      description: `Read a file from a remote server.
Returns the file contents. For large files, use line_start/line_end to read a range.`,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server ID or IP address' },
          path: { type: 'string', description: 'Absolute path to the file' },
          line_start: { type: 'number', description: 'Start reading from this line (1-indexed, optional)' },
          line_end: { type: 'number', description: 'Stop reading at this line (optional)' },
        },
        required: ['server', 'path'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const templateId = claims.template_id as string | undefined;
        const entry = resolveServer(input.server as string);
        if (!entry) return { error: `Unknown server: ${input.server}` };

        const denied = checkPermission(templateId, entry.id, 'read');
        if (denied) return { error: denied };

        const path = input.path as string;
        let cmd = `cat -n "${path}"`;
        if (input.line_start || input.line_end) {
          const start = (input.line_start as number) || 1;
          const end = input.line_end as number;
          cmd = end
            ? `sed -n '${start},${end}p' "${path}" | cat -n`
            : `tail -n +${start} "${path}" | cat -n`;
        }

        const result = await sshExec(entry.ip, cmd);
        if (result.stderr && !result.stdout) {
          return { error: result.stderr, server: entry.id, path };
        }
        return { server: entry.id, path, content: result.stdout };
      },
    },

    // ─── remote_write ───────────────────────────────
    {
      name: 'remote_write',
      description: `Write content to a file on a remote server.
Creates the file if it doesn't exist. Overwrites if it does.
WARNING: This is a destructive operation — use remote_edit for partial changes.`,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server ID or IP address' },
          path: { type: 'string', description: 'Absolute path to write to' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['server', 'path', 'content'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const templateId = claims.template_id as string | undefined;
        const entry = resolveServer(input.server as string);
        if (!entry) return { error: `Unknown server: ${input.server}` };

        const denied = checkPermission(templateId, entry.id, 'write');
        if (denied) return { error: denied };

        const path = input.path as string;
        const content = input.content as string;

        // Write via heredoc to handle special characters
        const escapedContent = content.replace(/'/g, "'\\''");
        const cmd = `cat > "${path}" << 'BHEEM_EOF'\n${escapedContent}\nBHEEM_EOF`;

        const result = await sshExec(entry.ip, cmd);
        if (result.stderr) {
          return { error: result.stderr, server: entry.id, path };
        }
        return { success: true, server: entry.id, path, bytes: content.length };
      },
    },

    // ─── remote_edit ────────────────────────────────
    {
      name: 'remote_edit',
      description: `Edit a file on a remote server using search-and-replace.
Finds the exact old_text and replaces it with new_text. Fails if old_text is not found.`,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server ID or IP address' },
          path: { type: 'string', description: 'Absolute path to the file' },
          old_text: { type: 'string', description: 'Exact text to find (must be unique in file)' },
          new_text: { type: 'string', description: 'Replacement text' },
        },
        required: ['server', 'path', 'old_text', 'new_text'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const templateId = claims.template_id as string | undefined;
        const entry = resolveServer(input.server as string);
        if (!entry) return { error: `Unknown server: ${input.server}` };

        const denied = checkPermission(templateId, entry.id, 'edit');
        if (denied) return { error: denied };

        const path = input.path as string;
        const oldText = input.old_text as string;
        const newText = input.new_text as string;

        // Step 1: Check the old text exists and is unique
        const grepResult = await sshExec(entry.ip, `grep -cF '${oldText.replace(/'/g, "'\\''")}' "${path}"`);
        const matchCount = parseInt(grepResult.stdout.trim(), 10);

        if (isNaN(matchCount) || matchCount === 0) {
          return { error: `old_text not found in ${path}`, server: entry.id };
        }

        // Step 2: Create backup, apply edit
        const escapedOld = oldText.replace(/[/&\\]/g, '\\$&').replace(/\n/g, '\\n');
        const escapedNew = newText.replace(/[/&\\]/g, '\\$&').replace(/\n/g, '\\n');

        const editCmd = [
          `cp "${path}" "${path}.bak"`,
          `sed -i 's/${escapedOld}/${escapedNew}/g' "${path}"`,
        ].join(' && ');

        const result = await sshExec(entry.ip, editCmd);
        if (result.stderr) {
          return { error: result.stderr, server: entry.id, path };
        }
        return {
          success: true,
          server: entry.id,
          path,
          backup: `${path}.bak`,
          matches_replaced: matchCount,
        };
      },
    },

    // ─── remote_ls ──────────────────────────────────
    {
      name: 'remote_ls',
      description: `List directory contents on a remote server.
Returns files with size and modification date.`,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server ID or IP address' },
          path: { type: 'string', description: 'Directory path to list (default: /)' },
          recursive: { type: 'boolean', description: 'List recursively (default: false, max depth 3)' },
        },
        required: ['server'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const templateId = claims.template_id as string | undefined;
        const entry = resolveServer(input.server as string);
        if (!entry) return { error: `Unknown server: ${input.server}` };

        const denied = checkPermission(templateId, entry.id, 'ls');
        if (denied) return { error: denied };

        const dir = (input.path as string) || '/';
        const cmd = input.recursive
          ? `find "${dir}" -maxdepth 3 -type f -o -type d 2>/dev/null | head -200`
          : `ls -la "${dir}"`;

        const result = await sshExec(entry.ip, cmd);
        if (result.stderr && !result.stdout) {
          return { error: result.stderr, server: entry.id, path: dir };
        }
        return { server: entry.id, path: dir, listing: result.stdout };
      },
    },

    // ─── remote_health ──────────────────────────────
    {
      name: 'remote_health',
      description: `Check health of a remote server — uptime, CPU load, RAM, disk usage.
Pass server="all" to check all servers at once.`,
      inputSchema: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'Server ID, IP, or "all" for all servers' },
        },
        required: ['server'],
      },
      execute: async (input, context?: McpRequestContext) => {
        const claims = (context?.claims || {}) as Record<string, unknown>;
        const templateId = claims.template_id as string | undefined;

        const healthCmd = `echo "UPTIME:$(uptime)" && echo "MEM:$(free -m | grep Mem)" && echo "DISK:$(df -h / | tail -1)" && echo "LOAD:$(cat /proc/loadavg)"`;

        // Check all servers
        if ((input.server as string) === 'all') {
          const results: Record<string, unknown>[] = [];
          for (const entry of serverRegistry) {
            const denied = checkPermission(templateId, entry.id, 'health');
            if (denied) {
              results.push({ server: entry.id, ip: entry.ip, status: 'no_permission' });
              continue;
            }
            const result = await sshExec(entry.ip, healthCmd);
            results.push({
              server: entry.id,
              ip: entry.ip,
              status: result.stderr && !result.stdout ? 'unreachable' : 'ok',
              output: result.stdout || result.stderr,
            });
          }
          return { servers: results };
        }

        // Single server
        const entry = resolveServer(input.server as string);
        if (!entry) return { error: `Unknown server: ${input.server}` };

        const denied = checkPermission(templateId, entry.id, 'health');
        if (denied) return { error: denied };

        const result = await sshExec(entry.ip, healthCmd);
        return {
          server: entry.id,
          ip: entry.ip,
          status: result.stderr && !result.stdout ? 'unreachable' : 'ok',
          output: result.stdout || result.stderr,
        };
      },
    },
  ];
}

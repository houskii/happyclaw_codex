import { execFile, spawn } from 'child_process';
import { readFile } from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { promisify } from 'util';

import { Hono } from 'hono';
import type { Variables } from '../web-context.js';
import { authMiddleware, systemConfigMiddleware } from '../middleware/auth.js';
import type { AuthUser } from '../types.js';
import {
  isHostExecutionGroup,
  hasHostExecutionPermission,
  canAccessGroup,
  getWebDeps,
} from '../web-context.js';
import { getRegisteredGroup, getRouterState, hasContainerModeGroups } from '../db.js';
import { CONTAINER_IMAGE } from '../config.js';
import { getSystemSettings } from '../runtime-config.js';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

// --- Agent runtime version cache ---

interface VersionInfo {
  host: string | null;
  container: string | null;
  latest: string | null;
}

interface SystemVersionInfo {
  claudeCode: VersionInfo;
  claudeAgentSdk: VersionInfo;
  codexCli: VersionInfo;
  codexSdk: VersionInfo;
}

let cachedVersions: {
  info: SystemVersionInfo;
  fetchedAt: number;
  imageId: string | null;
} | null = null;
const VERSION_CACHE_TTL = 60 * 60 * 1000;

// Latest version cache (separate TTL, queried from npm registry)
const cachedLatestVersions = new Map<
  string,
  { version: string | null; fetchedAt: number }
>();
const LATEST_VERSION_CACHE_TTL = 30 * 60 * 1000; // 30min

/** Query latest package version from npm registry */
async function getLatestPackageVersion(packageName: string): Promise<string | null> {
  const now = Date.now();
  const cached = cachedLatestVersions.get(packageName);
  if (cached && now - cached.fetchedAt < LATEST_VERSION_CACHE_TTL) {
    return cached.version;
  }

  try {
    const { stdout } = await execFileAsync(
      'npm',
      ['view', packageName, 'version'],
      { timeout: 15000 },
    );
    const version = stdout.trim() || null;
    cachedLatestVersions.set(packageName, { version, fetchedAt: now });
    return version;
  } catch {
    // Fallback: keep stale cache if available
    if (cached) return cached.version;
    cachedLatestVersions.set(packageName, { version: null, fetchedAt: now });
    return null;
  }
}

async function getHostPackageVersion(packageJsonPath: string): Promise<string | null> {
  try {
    const raw = await readFile(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version?.trim() || null;
  } catch {
    return null;
  }
}

async function getContainerPackageVersion(
  packageJsonPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'run', '--rm', '--entrypoint', 'node',
        CONTAINER_IMAGE,
        '-e',
        `console.log(require('${packageJsonPath}').version)`,
      ],
      { timeout: 30000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Get host Claude Code runtime version by running SDK's built-in cli.js --version */
async function getHostAgentRuntimeVersion(): Promise<string | null> {
  try {
    const cliPath = path.resolve(
      process.cwd(),
      'container/agent-runner/node_modules/@anthropic-ai/claude-agent-sdk/cli.js',
    );
    const { stdout } = await execFileAsync(
      'node',
      ['-e', `process.argv = ['node', 'claude', '--version']; require('${cliPath}')`],
      { timeout: 10000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getHostCodexCliVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('codex', ['--version'], {
      timeout: 10000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getDockerImageId(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['images', CONTAINER_IMAGE, '--format', '{{.ID}}'],
      { timeout: 5000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Get container Claude Code runtime version from SDK's cli.js inside Docker image */
async function getContainerAgentRuntimeVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'run', '--rm', '--entrypoint', 'node',
        CONTAINER_IMAGE, '-e',
        `process.argv = ['node', 'claude', '--version']; require('/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js')`,
      ],
      { timeout: 30000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getContainerCodexCliVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'run', '--rm', '--entrypoint', 'node',
        CONTAINER_IMAGE,
        '-e',
        `console.log(require('/app/node_modules/@openai/codex/package.json').version)`,
      ],
      { timeout: 30000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getSystemVersionInfo(): Promise<SystemVersionInfo> {
  const now = Date.now();
  const imageId = await getDockerImageId();

  // Return cached if same image and within TTL
  if (
    cachedVersions &&
    cachedVersions.imageId === imageId &&
    now - cachedVersions.fetchedAt < VERSION_CACHE_TTL
  ) {
    return cachedVersions.info;
  }

  const [
    claudeCodeHost,
    claudeCodeContainer,
    claudeCodeLatest,
    claudeSdkHost,
    claudeSdkContainer,
    claudeSdkLatest,
    codexCliHost,
    codexCliContainer,
    codexCliLatest,
    codexSdkHost,
    codexSdkContainer,
    codexSdkLatest,
  ] = await Promise.all([
    getHostAgentRuntimeVersion(),
    imageId ? getContainerAgentRuntimeVersion() : Promise.resolve(null),
    getLatestPackageVersion('@anthropic-ai/claude-code'),
    getHostPackageVersion(
      path.resolve(
        process.cwd(),
        'container/agent-runner/node_modules/@anthropic-ai/claude-agent-sdk/package.json',
      ),
    ),
    imageId
      ? getContainerPackageVersion(
          '/app/node_modules/@anthropic-ai/claude-agent-sdk/package.json',
        )
      : Promise.resolve(null),
    getLatestPackageVersion('@anthropic-ai/claude-agent-sdk'),
    getHostCodexCliVersion(),
    imageId ? getContainerCodexCliVersion() : Promise.resolve(null),
    getLatestPackageVersion('@openai/codex'),
    getHostPackageVersion(
      path.resolve(
        process.cwd(),
        'container/agent-runner/node_modules/@openai/codex-sdk/package.json',
      ),
    ),
    imageId
      ? getContainerPackageVersion('/app/node_modules/@openai/codex-sdk/package.json')
      : Promise.resolve(null),
    getLatestPackageVersion('@openai/codex-sdk'),
  ]);
  const info: SystemVersionInfo = {
    claudeCode: {
      host: claudeCodeHost,
      container: claudeCodeContainer,
      latest: claudeCodeLatest,
    },
    claudeAgentSdk: {
      host: claudeSdkHost,
      container: claudeSdkContainer,
      latest: claudeSdkLatest,
    },
    codexCli: {
      host: codexCliHost,
      container: codexCliContainer,
      latest: codexCliLatest,
    },
    codexSdk: {
      host: codexSdkHost,
      container: codexSdkContainer,
      latest: codexSdkLatest,
    },
  };

  cachedVersions = { info, fetchedAt: now, imageId };
  return info;
}

// --- Docker build state ---

let buildState: {
  building: boolean;
  startedAt: number | null;
  startedBy: string | null;
  logs: string[];
  result: { success: boolean; error?: string } | null;
} = {
  building: false,
  startedAt: null,
  startedBy: null,
  logs: [],
  result: null,
};

// --- Dependency injection (avoid circular imports) ---

let broadcastLog: ((line: string) => void) | null = null;
let broadcastComplete: ((success: boolean, error?: string) => void) | null =
  null;

export function injectMonitorDeps(deps: {
  broadcastDockerBuildLog: (line: string) => void;
  broadcastDockerBuildComplete: (success: boolean, error?: string) => void;
}) {
  broadcastLog = deps.broadcastDockerBuildLog;
  broadcastComplete = deps.broadcastDockerBuildComplete;
}

const monitorRoutes = new Hono<{ Variables: Variables }>();

// GET /api/health - 健康检查（无认证）
monitorRoutes.get('/health', async (c) => {
  const checks = {
    database: false,
    queue: false,
    uptime: 0,
  };

  let healthy = true;

  // 检查数据库连通性
  try {
    getRouterState('last_timestamp');
    checks.database = true;
  } catch (err) {
    healthy = false;
    logger.warn({ err }, '健康检查：数据库连接失败');
  }

  // 检查队列状态
  try {
    const deps = getWebDeps();
    if (deps && deps.queue) {
      checks.queue = true;
    } else {
      healthy = false;
    }
  } catch (err) {
    healthy = false;
    logger.warn({ err }, '健康检查：队列不可用');
  }

  // 进程运行时间
  checks.uptime = Math.floor(process.uptime());

  const status = healthy ? 'healthy' : 'unhealthy';
  const statusCode = healthy ? 200 : 503;

  return c.json({ status, checks }, statusCode);
});

async function checkDockerImageExists(): Promise<boolean> {
  // Skip Docker check entirely when no groups use container mode
  if (!hasContainerModeGroups()) return false;
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['images', CONTAINER_IMAGE, '--format', '{{.ID}}'],
      { timeout: 10000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// GET /api/status - 获取系统状态
monitorRoutes.get('/status', authMiddleware, async (c) => {
  const deps = getWebDeps();
  if (!deps) return c.json({ error: 'Server not initialized' }, 500);

  const authUser = c.get('user') as AuthUser;
  const isAdmin = hasHostExecutionPermission(authUser);
  const queueStatus = deps.queue.getStatus();

  // 监控页面属于系统管理功能，admin 可见所有群组状态（不受工作区隔离约束）
  const filteredGroups = isAdmin
    ? queueStatus.groups
    : queueStatus.groups.filter((g) => {
        const group = getRegisteredGroup(g.jid);
        if (!group) return false;
        if (isHostExecutionGroup(group)) return false;
        return canAccessGroup({ id: authUser.id, role: authUser.role }, group);
      });

  const dockerImageExists = await checkDockerImageExists();

  // For non-admin users, derive aggregate metrics from their own filtered groups only
  // to prevent leaking global system load information across users
  let activeContainers: number;
  let queueLength: number;
  if (isAdmin) {
    activeContainers = queueStatus.activeContainerCount;
    queueLength = queueStatus.waitingCount;
  } else {
    activeContainers = filteredGroups.filter((g) => g.active).length;
    // Filter waiting groups by user ownership
    queueLength = queueStatus.waitingGroupJids.filter((jid) => {
      const group = getRegisteredGroup(jid);
      if (!group) return false;
      if (isHostExecutionGroup(group)) return false;
      return canAccessGroup({ id: authUser.id, role: authUser.role }, group);
    }).length;
  }

  const runtimeVersions = isAdmin ? await getSystemVersionInfo() : undefined;

  return c.json({
    activeContainers,
    activeHostProcesses: isAdmin
      ? queueStatus.activeHostProcessCount
      : undefined,
    activeTotal: isAdmin ? queueStatus.activeCount : activeContainers,
    maxConcurrentContainers: getSystemSettings().maxConcurrentContainers,
    maxConcurrentHostProcesses: isAdmin
      ? getSystemSettings().maxConcurrentHostProcesses
      : undefined,
    queueLength,
    uptime: Math.floor(process.uptime()),
    groups: filteredGroups,
    dockerImageExists,
    dockerBuildInProgress: buildState.building,
    systemVersions: runtimeVersions,
    agentRuntimeVersions: runtimeVersions?.claudeCode,
    claudeCodeVersions: runtimeVersions?.claudeCode,
    dockerBuildLogs:
      isAdmin && buildState.building ? buildState.logs.slice(-50) : undefined,
    dockerBuildResult: isAdmin ? buildState.result : undefined,
  });
});

// POST /api/docker/build - 构建 Docker 镜像（仅 admin，异步启动 + WS 推送进度）
monitorRoutes.post(
  '/docker/build',
  authMiddleware,
  systemConfigMiddleware,
  async (c) => {
    if (buildState.building) {
      return c.json(
        {
          error: 'Docker image build already in progress',
          startedAt: buildState.startedAt,
          startedBy: buildState.startedBy,
        },
        409,
      );
    }

    const authUser = c.get('user') as AuthUser;
    const buildScript = path.resolve(process.cwd(), 'container', 'build.sh');

    buildState = {
      building: true,
      startedAt: Date.now(),
      startedBy: authUser.username,
      logs: [],
      result: null,
    };
    logger.info(
      { startedBy: authUser.username },
      'Docker image build requested via API',
    );

    // Spawn build process asynchronously
    const proc = spawn('bash', [buildScript], {
      cwd: path.resolve(process.cwd(), 'container'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 10-minute timeout
    const timeout = setTimeout(
      () => {
        proc.kill('SIGKILL');
        const errMsg = 'Docker build timed out after 10 minutes';
        logger.error(errMsg);
        buildState.building = false;
        buildState.result = { success: false, error: errMsg };
        broadcastLog?.(errMsg);
        broadcastComplete?.(false, errMsg);
      },
      10 * 60 * 1000,
    );

    const pushLine = (line: string) => {
      buildState.logs.push(line);
      // Keep last 200 lines in memory
      if (buildState.logs.length > 200) {
        buildState.logs = buildState.logs.slice(-200);
      }
      broadcastLog?.(line);
    };

    // Read stdout and stderr line by line
    if (proc.stdout) {
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', pushLine);
    }
    if (proc.stderr) {
      const rl = readline.createInterface({ input: proc.stderr });
      rl.on('line', pushLine);
    }

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const success = code === 0;
      const error = success
        ? undefined
        : `Build process exited with code ${code}`;
      if (success) {
        logger.info('Docker image build completed');
        // Invalidate version cache so next query fetches from new image
        cachedVersions = null;
      } else {
        logger.error({ code }, 'Docker image build failed');
      }
      buildState.building = false;
      buildState.result = { success, error };
      broadcastComplete?.(success, error);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      const errorMsg = err.message;
      logger.error({ err }, 'Docker image build process error');
      buildState.building = false;
      buildState.result = { success: false, error: errorMsg };
      broadcastComplete?.(false, errorMsg);
    });

    // Return immediately with 202 Accepted
    return c.json(
      {
        accepted: true,
        message:
          'Docker image build started. Progress will be streamed via WebSocket.',
      },
      202,
    );
  },
);

export default monitorRoutes;

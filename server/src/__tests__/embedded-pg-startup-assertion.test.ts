import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";

const {
  createAppMock,
  createBetterAuthInstanceMock,
  createDbMock,
  detectPortMock,
  deriveAuthTrustedOriginsMock,
  feedbackExportServiceMock,
  feedbackServiceFactoryMock,
  fakeServer,
  loadConfigMock,
  embeddedPostgresMock,
  assertPgNotReachableOnInterfacesMock,
  networkInterfacesMock,
} = vi.hoisted(() => {
  const embeddedPostgresInstanceMock = {
    initialise: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  const embeddedPostgresMock = vi.fn(() => embeddedPostgresInstanceMock);
  const assertPgNotReachableOnInterfacesMock = vi.fn(async () => {});
  const networkInterfacesMock = vi.fn(() => ({}));

  const createAppMock = vi.fn(async () => ((_: unknown, __: unknown) => {}) as never);
  const createBetterAuthInstanceMock = vi.fn(() => ({}));
  const createDbMock = vi.fn(() => ({}) as never);
  const detectPortMock = vi.fn(async (port: number) => port);
  const deriveAuthTrustedOriginsMock = vi.fn(() => []);
  const feedbackExportServiceMock = {
    flushPendingFeedbackTraces: vi.fn(async () => ({ attempted: 0, sent: 0, failed: 0 })),
  };
  const feedbackServiceFactoryMock = vi.fn(() => feedbackExportServiceMock);
  const fakeServer = {
    once: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
      callback?.();
      return fakeServer;
    }),
    close: vi.fn(),
  };
  const loadConfigMock = vi.fn();

  return {
    createAppMock,
    createBetterAuthInstanceMock,
    createDbMock,
    detectPortMock,
    deriveAuthTrustedOriginsMock,
    feedbackExportServiceMock,
    feedbackServiceFactoryMock,
    fakeServer,
    loadConfigMock,
    embeddedPostgresMock,
    assertPgNotReachableOnInterfacesMock,
    networkInterfacesMock,
  };
});

function buildEmbeddedTestConfig(overrides: Record<string, unknown> = {}) {
  return {
    deploymentMode: "authenticated",
    deploymentExposure: "private",
    bind: "loopback",
    customBindHost: undefined,
    host: "127.0.0.1",
    port: 3210,
    allowedHostnames: [],
    authBaseUrlMode: "auto",
    authPublicBaseUrl: undefined,
    authDisableSignUp: false,
    databaseMode: "embedded-postgres",
    databaseUrl: undefined,
    databaseMigrationUrl: undefined,
    embeddedPostgresDataDir: "/tmp/paperclip-test-pg-data",
    embeddedPostgresPort: 54329,
    databaseBackupEnabled: false,
    databaseBackupIntervalMinutes: 60,
    databaseBackupRetentionDays: 30,
    databaseBackupDir: "/tmp/paperclip-test-backups",
    serveUi: false,
    uiDevMiddleware: false,
    secretsProvider: "local_encrypted",
    secretsStrictMode: false,
    secretsMasterKeyFilePath: "/tmp/paperclip-master.key",
    storageProvider: "local_disk",
    storageLocalDiskBaseDir: "/tmp/paperclip-storage",
    storageS3Bucket: "paperclip-test",
    storageS3Region: "us-east-1",
    storageS3Endpoint: undefined,
    storageS3Prefix: "",
    storageS3ForcePathStyle: false,
    feedbackExportBackendUrl: undefined,
    feedbackExportBackendToken: undefined,
    heartbeatSchedulerEnabled: false,
    heartbeatSchedulerIntervalMs: 30000,
    companyDeletionEnabled: false,
    telemetryEnabled: false,
    ...overrides,
  };
}

vi.mock("node:http", () => ({
  createServer: vi.fn(() => fakeServer),
}));

vi.mock("detect-port", () => ({
  default: detectPortMock,
}));

vi.mock("embedded-postgres", () => ({
  default: embeddedPostgresMock,
}));

vi.mock("@paperclipai/db", () => ({
  createDb: createDbMock,
  // Throw so the code takes the "new EmbeddedPostgres constructor" path (not the reuse path)
  ensurePostgresDatabase: vi.fn(async () => "existing"),
  getPostgresDataDirectory: vi.fn(async () => { throw new Error("pg not reachable"); }),
  inspectMigrations: vi.fn(async () => ({ status: "upToDate" })),
  applyPendingMigrations: vi.fn(),
  reconcilePendingMigrationHistory: vi.fn(async () => ({ repairedMigrations: [] })),
  formatDatabaseBackupResult: vi.fn(() => "ok"),
  runDatabaseBackup: vi.fn(),
  createEmbeddedPostgresLogBuffer: vi.fn(() => ({
    append: vi.fn(),
    getRecentLogs: vi.fn(() => []),
  })),
  formatEmbeddedPostgresError: vi.fn((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
  authUsers: {},
  companies: {},
  companyMemberships: {},
  heartbeatRuns: {},
  instanceUserRoles: {},
  buildEmbeddedPostgresFlags: () => ["-c", "listen_addresses=127.0.0.1"],
  assertPgNotReachableOnInterfaces: assertPgNotReachableOnInterfacesMock,
}));

vi.mock("../app.js", () => ({
  createApp: createAppMock,
}));

vi.mock("../config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(function child() { return this; }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../realtime/live-events-ws.js", () => ({
  setupLiveEventsWebSocketServer: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  feedbackService: feedbackServiceFactoryMock,
  heartbeatService: vi.fn(() => ({
    reapOrphanedRuns: vi.fn(async () => undefined),
    promoteDueScheduledRetries: vi.fn(async () => ({ promoted: 0, runIds: [] })),
    resumeQueuedRuns: vi.fn(async () => undefined),
    reconcileStrandedAssignedIssues: vi.fn(async () => ({
      dispatchRequeued: 0, continuationRequeued: 0, escalated: 0, skipped: 0, issueIds: [],
    })),
    tickTimers: vi.fn(async () => ({ enqueued: 0 })),
  })),
  instanceSettingsService: vi.fn(() => ({
    getGeneral: vi.fn(async () => ({
      backupRetention: { dailyDays: 7, weeklyWeeks: 4, monthlyMonths: 1 },
    })),
  })),
  reconcilePersistedRuntimeServicesOnStartup: vi.fn(async () => ({ reconciled: 0 })),
  routineService: vi.fn(() => ({
    tickScheduledTriggers: vi.fn(async () => ({ triggered: 0 })),
  })),
}));

vi.mock("../storage/index.js", () => ({
  createStorageServiceFromConfig: vi.fn(() => ({ id: "storage-service" })),
}));

vi.mock("../services/feedback-share-client.js", () => ({
  createFeedbackTraceShareClientFromConfig: vi.fn(() => ({ id: "feedback-share-client" })),
}));

vi.mock("../startup-banner.js", () => ({
  printStartupBanner: vi.fn(),
}));

vi.mock("../board-claim.js", () => ({
  getBoardClaimWarningUrl: vi.fn(() => null),
  initializeBoardClaimChallenge: vi.fn(async () => undefined),
}));

vi.mock("../auth/better-auth.js", () => ({
  createBetterAuthHandler: vi.fn(() => undefined),
  createBetterAuthInstance: createBetterAuthInstanceMock,
  deriveAuthTrustedOrigins: deriveAuthTrustedOriginsMock,
  resolveBetterAuthSession: vi.fn(async () => null),
  resolveBetterAuthSessionFromHeaders: vi.fn(async () => null),
}));

vi.mock("../services/plugin-worker-manager.js", () => ({
  createPluginWorkerManager: vi.fn(() => ({
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getWorker: vi.fn(() => null),
    listWorkers: vi.fn(() => []),
  })),
}));

vi.mock("../telemetry.js", () => ({
  initTelemetry: vi.fn(async () => {}),
  getTelemetryClient: vi.fn(() => ({ flush: vi.fn(async () => {}), stop: vi.fn(async () => {}) })),
}));

vi.mock("../runtime-api.js", () => ({
  buildRuntimeApiCandidateUrls: vi.fn(() => []),
  choosePrimaryRuntimeApiUrl: vi.fn(async () => "http://127.0.0.1:3210"),
}));

vi.mock("../worktree-config.js", () => ({
  maybePersistWorktreeRuntimePorts: vi.fn(async () => {}),
}));

vi.mock("../errors.js", () => ({
  conflict: vi.fn((msg: string) => new Error(msg)),
}));

vi.mock("../adapters/registry.js", () => ({
  ADAPTER_REGISTRY: [],
  getAdapterById: vi.fn(() => null),
  waitForExternalAdapters: vi.fn(async () => {}),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn((path: string) => {
      if (String(path).endsWith("PG_VERSION")) return true;
      if (String(path).endsWith("postmaster.pid")) return false;
      return actual.existsSync(path);
    }),
    readFileSync: vi.fn((path: unknown, ...args: unknown[]) => {
      return actual.readFileSync(path as string, ...(args as [BufferEncoding]));
    }),
    rmSync: vi.fn(),
  };
});

import { startServer } from "../index.ts";

describe("startServer embedded-pg lockdown: postgresFlags applied at constructor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigMock.mockReturnValue(buildEmbeddedTestConfig());
    createBetterAuthInstanceMock.mockReturnValue({});
    deriveAuthTrustedOriginsMock.mockReturnValue([]);
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes postgresFlags containing listen_addresses=127.0.0.1 to EmbeddedPostgres constructor", async () => {
    await startServer();

    expect(embeddedPostgresMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
      }),
    );
  });
});

describe("startServer embedded-pg lockdown: startup assertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBetterAuthInstanceMock.mockReturnValue({});
    deriveAuthTrustedOriginsMock.mockReturnValue([]);
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does NOT run probe when bind=loopback (127.0.0.1 only)", async () => {
    loadConfigMock.mockReturnValue(buildEmbeddedTestConfig({ bind: "loopback", host: "127.0.0.1" }));
    assertPgNotReachableOnInterfacesMock.mockResolvedValue(undefined);

    await startServer();

    expect(assertPgNotReachableOnInterfacesMock).not.toHaveBeenCalled();
  });

  it("runs probe on non-loopback interfaces when bind=lan (0.0.0.0)", async () => {
    loadConfigMock.mockReturnValue(buildEmbeddedTestConfig({
      bind: "lan",
      host: "0.0.0.0",
      deploymentMode: "authenticated",
    }));
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      eth0: [
        { address: "192.168.1.100", family: "IPv4", internal: false, netmask: "255.255.255.0", cidr: null, mac: "00:00:00:00:00:00" },
      ],
    });
    assertPgNotReachableOnInterfacesMock.mockResolvedValue(undefined);

    await startServer();

    expect(assertPgNotReachableOnInterfacesMock).toHaveBeenCalledWith(
      expect.arrayContaining(["192.168.1.100"]),
      expect.any(Number),
    );
  });

  it("throws and stops embedded postgres when probe detects pg reachable on LAN", async () => {
    loadConfigMock.mockReturnValue(buildEmbeddedTestConfig({
      bind: "lan",
      host: "0.0.0.0",
      deploymentMode: "authenticated",
    }));
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      eth0: [
        { address: "192.168.1.100", family: "IPv4", internal: false, netmask: "255.255.255.0", cidr: null, mac: "00:00:00:00:00:00" },
      ],
    });
    assertPgNotReachableOnInterfacesMock.mockRejectedValue(
      new Error("Embedded PostgreSQL binding lockdown assertion failed: PostgreSQL is reachable on 192.168.1.100:54329"),
    );

    await expect(startServer()).rejects.toThrow(/binding lockdown assertion failed/);

    // Verify the started pg process was stopped to avoid a leak
    const instance = embeddedPostgresMock.mock.results[0]?.value;
    expect(instance?.stop).toHaveBeenCalled();
  });
});

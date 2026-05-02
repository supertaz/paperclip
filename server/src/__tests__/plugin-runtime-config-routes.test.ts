import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRegistry = vi.hoisted(() => ({
  getById: vi.fn(),
  getConfig: vi.fn(),
}));

const mockRuntimeConfig = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  setRuntime: vi.fn(),
  unsetRuntime: vi.fn(),
  clearRuntime: vi.fn(),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => mockRegistry,
}));

vi.mock("../services/plugin-runtime-config.js", () => ({
  createPluginRuntimeConfigService: () => mockRuntimeConfig,
}));

vi.mock("../services/plugin-lifecycle.js", () => ({
  pluginLifecycleManager: () => ({ load: vi.fn(), unload: vi.fn() }),
}));

vi.mock("../services/plugin-loader.js", () => ({
  pluginLoader: () => ({}),
  getPluginUiContributionMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishGlobalLiveEvent: vi.fn(),
}));

const pluginId = "11111111-1111-4111-8111-111111111111";

function boardActor(overrides: Record<string, unknown> = {}) {
  return {
    type: "board",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: false,
    companyIds: ["company-1"],
    ...overrides,
  };
}

function readyPlugin() {
  mockRegistry.getById.mockResolvedValue({
    id: pluginId,
    pluginKey: "paperclip.example",
    version: "1.0.0",
    status: "ready",
    manifestJson: {},
  });
}

async function createApp(actor: Record<string, unknown>) {
  const [{ pluginRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/plugins.js"),
    import("../middleware/index.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as typeof req.actor;
    next();
  });
  app.use("/api", pluginRoutes({} as never, {} as never, {} as never, undefined, {} as never, {} as never));
  app.use(errorHandler);
  return app;
}

describe.sequential("GET /api/plugins/:pluginId/runtime-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when plugin not found", async () => {
    mockRegistry.getById.mockResolvedValue(null);
    const app = await createApp(boardActor());

    const res = await request(app).get(`/api/plugins/${pluginId}/runtime-config`);
    expect(res.status).toBe(404);
  });

  it("returns runtime config for board members", async () => {
    readyPlugin();
    mockRuntimeConfig.getRuntime.mockResolvedValue({ values: { host: "https://example.com" }, revision: "3" });

    const app = await createApp(boardActor());
    const res = await request(app).get(`/api/plugins/${pluginId}/runtime-config`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ values: { host: "https://example.com" }, revision: "3" });
  });

  it("returns empty runtime config when no row exists", async () => {
    readyPlugin();
    mockRuntimeConfig.getRuntime.mockResolvedValue({ values: {}, revision: "0" });

    const app = await createApp(boardActor());
    const res = await request(app).get(`/api/plugins/${pluginId}/runtime-config`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ values: {}, revision: "0" });
  });

  it("rejects non-board actors with 403", async () => {
    const app = await createApp({ type: "none" });
    const res = await request(app).get(`/api/plugins/${pluginId}/runtime-config`);
    expect(res.status).toBe(403);
  });
});

describe.sequential("DELETE /api/plugins/:pluginId/runtime-config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-admin board users with 403", async () => {
    const app = await createApp(boardActor({ isInstanceAdmin: false }));
    const res = await request(app).delete(`/api/plugins/${pluginId}/runtime-config`);
    expect(res.status).toBe(403);
    expect(mockRuntimeConfig.clearRuntime).not.toHaveBeenCalled();
  });

  it("returns 404 when plugin not found (instance admin)", async () => {
    mockRegistry.getById.mockResolvedValue(null);
    const app = await createApp(boardActor({ isInstanceAdmin: true }));
    const res = await request(app).delete(`/api/plugins/${pluginId}/runtime-config`);
    expect(res.status).toBe(404);
  });

  it("clears runtime config and returns 204 for instance admins", async () => {
    readyPlugin();
    mockRuntimeConfig.clearRuntime.mockResolvedValue(undefined);
    const app = await createApp(boardActor({ isInstanceAdmin: true }));

    const res = await request(app).delete(`/api/plugins/${pluginId}/runtime-config`);
    expect(res.status).toBe(204);
    expect(mockRuntimeConfig.clearRuntime).toHaveBeenCalledWith(pluginId);
  });

  it("rejects non-board actors with 403", async () => {
    const app = await createApp({ type: "none" });
    const res = await request(app).delete(`/api/plugins/${pluginId}/runtime-config`);
    expect(res.status).toBe(403);
  });
});

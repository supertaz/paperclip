/**
 * Tests for the plugin secrets write path (CC-G4).
 *
 * Covers:
 * - `secrets.write` capability gating in host-client-factory
 * - `createPluginSecretsHandler.write()` — create and rotate paths
 * - `createPluginSecretsHandler.delete()` — ownership-gated delete path
 * - Attribution: actorType: "plugin" on all audit log calls
 * - Validation: name format, value size, reserved prefixes, ownership
 * - RBAC: only plugins with `secrets.write` capability may call write/delete
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPluginSecretsHandler } from "../services/plugin-secrets-handler.js";
import type { PluginSecretsService } from "../services/plugin-secrets-handler.js";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const mockLogActivity = vi.fn().mockResolvedValue(undefined);
const mockGetByName = vi.fn();
const mockCreate = vi.fn();
const mockRotate = vi.fn();
const mockRemove = vi.fn();

vi.mock("../services/activity-log.js", () => ({
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
}));

vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => ({
    getById: vi.fn().mockResolvedValue({ id: "test-plugin", companyId: "co-1", manifestJson: {} }),
  }),
}));

vi.mock("../secrets/provider-registry.js", () => ({
  getSecretProvider: () => ({
    createVersion: vi.fn().mockResolvedValue({
      material: { encrypted: "base64data" },
      valueSha256: "sha256abc",
      externalRef: null,
    }),
    resolveVersion: vi.fn().mockResolvedValue("plaintext-value"),
  }),
}));

vi.mock("../services/secrets.js", () => ({
  secretService: () => ({
    getByName: (...args: unknown[]) => mockGetByName(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    rotate: (...args: unknown[]) => mockRotate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_ID = "test-plugin";
const COMPANY_ID = "co-1";
const SECRET_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PLUGIN_ACTOR_ID = `plugin:${PLUGIN_ID}`;

const BASE_SECRET = {
  id: SECRET_ID,
  companyId: COMPANY_ID,
  name: "MY_SECRET",
  provider: "local_encrypted",
  latestVersion: 1,
  externalRef: null,
  createdByUserId: PLUGIN_ACTOR_ID,
};

const ALIEN_SECRET = {
  ...BASE_SECRET,
  createdByUserId: "user-board",
};

function makeFakeDb() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) => Promise.resolve(cb([]))),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((cb: (rows: unknown[]) => unknown) => Promise.resolve(cb([BASE_SECRET]))),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
    })),
  } as unknown as import("@paperclipai/db").Db;
}

// ---------------------------------------------------------------------------
// Capability gating (via host-client-factory)
// ---------------------------------------------------------------------------

describe("secrets.write capability gating", () => {
  it("is mapped to the secrets.write capability in METHOD_CAPABILITY_MAP", async () => {
    const { getRequiredCapability } = await import(
      "../../../packages/plugins/sdk/src/host-client-factory.js"
    );
    expect(getRequiredCapability("secrets.write")).toBe("secrets.write");
  });

  it("is mapped to the secrets.delete capability in METHOD_CAPABILITY_MAP", async () => {
    const { getRequiredCapability } = await import(
      "../../../packages/plugins/sdk/src/host-client-factory.js"
    );
    expect(getRequiredCapability("secrets.delete")).toBe("secrets.write");
  });

  it("throws CapabilityDeniedError when secrets.write is missing from manifest", async () => {
    const { createHostClientHandlers } = await import(
      "../../../packages/plugins/sdk/src/host-client-factory.js"
    );
    const handlers = createHostClientHandlers({
      pluginId: "test",
      capabilities: [],
      services: {
        secrets: {
          resolve: vi.fn(),
          write: vi.fn(),
          delete: vi.fn(),
        },
      } as never,
    });
    await expect(
      handlers["secrets.write"]({ companyId: COMPANY_ID, name: "X", value: "y" }),
    ).rejects.toThrow(/missing required capability.*secrets.write/i);
  });

  it("allows secrets.write when capability is declared", async () => {
    const { createHostClientHandlers } = await import(
      "../../../packages/plugins/sdk/src/host-client-factory.js"
    );
    const mockWrite = vi.fn().mockResolvedValue("secret-id");
    const handlers = createHostClientHandlers({
      pluginId: "test",
      capabilities: ["secrets.write"],
      services: {
        secrets: {
          resolve: vi.fn(),
          write: mockWrite,
          delete: vi.fn(),
        },
      } as never,
    });
    await handlers["secrets.write"]({ companyId: COMPANY_ID, name: "X", value: "y" });
    expect(mockWrite).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// secrets.write in PLUGIN_CAPABILITIES constant
// ---------------------------------------------------------------------------

describe("secrets.write in PLUGIN_CAPABILITIES", () => {
  it("includes secrets.write in the capabilities array", async () => {
    const { PLUGIN_CAPABILITIES } = await import("@paperclipai/shared");
    expect(PLUGIN_CAPABILITIES).toContain("secrets.write");
  });
});

// ---------------------------------------------------------------------------
// PluginSecretsService.write()
// ---------------------------------------------------------------------------

describe("createPluginSecretsHandler.write()", () => {
  let handler: PluginSecretsService;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = createPluginSecretsHandler({
      db: makeFakeDb(),
      pluginId: PLUGIN_ID,
    });
    // Default: no existing secret
    mockGetByName.mockResolvedValue(null);
    mockCreate.mockResolvedValue(BASE_SECRET);
    mockRotate.mockResolvedValue({ ...BASE_SECRET, latestVersion: 2 });
  });

  describe("validation", () => {
    it("rejects empty name", async () => {
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "", value: "val" }),
      ).rejects.toThrow(/name.*empty|empty.*name/i);
    });

    it("rejects name longer than 255 chars", async () => {
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "A".repeat(256), value: "val" }),
      ).rejects.toThrow(/255/);
    });

    it("rejects name with invalid characters (dot)", async () => {
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "MY.SECRET", value: "val" }),
      ).rejects.toThrow(/alphanumeric|invalid.*name/i);
    });

    it("rejects empty value", async () => {
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "" }),
      ).rejects.toThrow(/value.*empty|empty.*value/i);
    });

    it("rejects value over 64 KiB", async () => {
      const bigValue = "x".repeat(65537);
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: bigValue }),
      ).rejects.toThrow(/64 KiB|65.536/i);
    });

    it("rejects PAPERCLIP_ reserved prefix", async () => {
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "PAPERCLIP_SECRET_KEY", value: "val" }),
      ).rejects.toThrow(/reserved/i);
    });

    it("rejects BETTER_AUTH_ reserved prefix", async () => {
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "BETTER_AUTH_TOKEN", value: "val" }),
      ).rejects.toThrow(/reserved/i);
    });
  });

  describe("create path (no existing secret)", () => {
    it("returns the secret UUID on success", async () => {
      const result = await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "s3cr3t" });
      expect(result).toBe(SECRET_ID);
    });

    it("calls secretService.create with correct actor", async () => {
      await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "s3cr3t" });
      expect(mockCreate).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ name: "MY_SECRET", value: "s3cr3t" }),
        expect.objectContaining({ userId: PLUGIN_ACTOR_ID }),
      );
    });

    it("logs audit event with actorType: plugin", async () => {
      await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "s3cr3t" });
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorType: "plugin",
          actorId: PLUGIN_ACTOR_ID,
          action: "secret.created",
          companyId: COMPANY_ID,
        }),
      );
    });

    it("never logs the plaintext secret value", async () => {
      await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "s3cr3t-do-not-log" });
      const calls = JSON.stringify(mockLogActivity.mock.calls);
      expect(calls).not.toContain("s3cr3t-do-not-log");
    });
  });

  describe("rotate path (existing plugin-owned secret)", () => {
    beforeEach(() => {
      mockGetByName.mockResolvedValue(BASE_SECRET);
    });

    it("returns the secret UUID after rotation", async () => {
      const result = await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "new-val" });
      expect(result).toBe(SECRET_ID);
    });

    it("calls secretService.rotate (not create)", async () => {
      await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "new-val" });
      expect(mockRotate).toHaveBeenCalledWith(
        SECRET_ID,
        expect.objectContaining({ value: "new-val" }),
        expect.objectContaining({ userId: PLUGIN_ACTOR_ID }),
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("logs audit event with actorType: plugin on rotate", async () => {
      await handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "new-val" });
      expect(mockLogActivity).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorType: "plugin",
          actorId: PLUGIN_ACTOR_ID,
          action: "secret.rotated",
        }),
      );
    });
  });

  describe("ownership collision", () => {
    it("rejects write on secret owned by a different actor", async () => {
      mockGetByName.mockResolvedValue(ALIEN_SECRET);
      await expect(
        handler.write({ companyId: COMPANY_ID, name: "MY_SECRET", value: "hijack" }),
      ).rejects.toThrow(/collision|not created by this plugin/i);
    });
  });
});

// ---------------------------------------------------------------------------
// PluginSecretsService.delete()
// ---------------------------------------------------------------------------

describe("createPluginSecretsHandler.delete()", () => {
  let handler: PluginSecretsService;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = createPluginSecretsHandler({ db: makeFakeDb(), pluginId: PLUGIN_ID });
    mockGetByName.mockResolvedValue(null);
    mockRemove.mockResolvedValue(BASE_SECRET);
  });

  it("is exposed as a method on the returned service", () => {
    expect(typeof handler.delete).toBe("function");
  });

  it("rejects deleting a secret not owned by this plugin", async () => {
    mockGetByName.mockResolvedValue(ALIEN_SECRET);
    await expect(
      handler.delete({ companyId: COMPANY_ID, name: "ALIEN_SECRET" }),
    ).rejects.toThrow(/not owned|ownership|not created by this plugin/i);
  });

  it("succeeds and logs audit event with actorType: plugin on delete", async () => {
    mockGetByName.mockResolvedValue(BASE_SECRET);
    await handler.delete({ companyId: COMPANY_ID, name: "MY_SECRET" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "plugin",
        actorId: PLUGIN_ACTOR_ID,
        action: "secret.deleted",
      }),
    );
  });

  it("no-ops silently when the secret does not exist", async () => {
    mockGetByName.mockResolvedValue(null);
    await expect(handler.delete({ companyId: COMPANY_ID, name: "NONEXISTENT" })).resolves.toBeUndefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SDK types: PluginSecretsClient has write and delete
// ---------------------------------------------------------------------------

describe("PluginSecretsClient SDK types", () => {
  it("PluginSecretsClient has write method in the type definition", async () => {
    const { createTestHarness } = await import("../../../packages/plugins/sdk/src/testing.js");
    const harness = createTestHarness({
      manifest: {
        id: "test", name: "Test", version: "0.0.1", description: "Test",
        capabilities: ["secrets.write"],
      } as never,
    });
    expect(typeof harness.ctx.secrets.write).toBe("function");
  });

  it("PluginSecretsClient has delete method in the type definition", async () => {
    const { createTestHarness } = await import("../../../packages/plugins/sdk/src/testing.js");
    const harness = createTestHarness({
      manifest: {
        id: "test", name: "Test", version: "0.0.1", description: "Test",
        capabilities: ["secrets.write"],
      } as never,
    });
    expect(typeof harness.ctx.secrets.delete).toBe("function");
  });

  it("write in test harness requires secrets.write capability", async () => {
    const { createTestHarness } = await import("../../../packages/plugins/sdk/src/testing.js");
    const harness = createTestHarness({
      manifest: {
        id: "test", name: "Test", version: "0.0.1", description: "Test",
        capabilities: [],
      } as never,
    });
    await expect(
      harness.ctx.secrets.write({ companyId: COMPANY_ID, name: "X", value: "y" }),
    ).rejects.toThrow(/capability/i);
  });

  it("delete in test harness requires secrets.write capability", async () => {
    const { createTestHarness } = await import("../../../packages/plugins/sdk/src/testing.js");
    const harness = createTestHarness({
      manifest: {
        id: "test", name: "Test", version: "0.0.1", description: "Test",
        capabilities: [],
      } as never,
    });
    await expect(
      harness.ctx.secrets.delete({ companyId: COMPANY_ID, name: "X" }),
    ).rejects.toThrow(/capability/i);
  });
});

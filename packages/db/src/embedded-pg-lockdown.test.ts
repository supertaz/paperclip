import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import net from "node:net";
import os from "node:os";

// --- Tier 1: unit tests for assertPgNotReachableOnInterfaces ---

// We import the module under test; it doesn't exist yet (RED)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { assertPgNotReachableOnInterfaces } from "./embedded-pg-lockdown.js";

describe("assertPgNotReachableOnInterfaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves when connection is refused (ECONNREFUSED = pg not reachable)", async () => {
    vi.spyOn(net, "createConnection").mockImplementation((_port: unknown, _host: unknown, callback?: () => void) => {
      const socket = {
        on: vi.fn().mockImplementation((event: string, handler: (err?: Error) => void) => {
          if (event === "error") {
            const err = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
            setTimeout(() => handler(err), 0);
          }
          return socket;
        }),
        destroy: vi.fn(),
      };
      callback?.();
      return socket as unknown as net.Socket;
    });

    await expect(assertPgNotReachableOnInterfaces(["192.168.1.10"], 5432)).resolves.toBeUndefined();
  });

  it("throws when pg connection succeeds (pg is reachable = lockdown failed)", async () => {
    vi.spyOn(net, "createConnection").mockImplementation((_port: unknown, _host: unknown, callback?: () => void) => {
      const socket = {
        on: vi.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === "connect") {
            setTimeout(() => handler(), 0);
          }
          return socket;
        }),
        destroy: vi.fn(),
      };
      callback?.();
      return socket as unknown as net.Socket;
    });

    await expect(
      assertPgNotReachableOnInterfaces(["192.168.1.10"], 5432),
    ).rejects.toThrow(/reachable on 192\.168\.1\.10:5432/);
  });

  it("throws when connection errors with ETIMEDOUT (fail closed on ambiguous)", async () => {
    vi.spyOn(net, "createConnection").mockImplementation((_port: unknown, _host: unknown, callback?: () => void) => {
      const socket = {
        on: vi.fn().mockImplementation((event: string, handler: (err?: Error) => void) => {
          if (event === "error") {
            const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
            setTimeout(() => handler(err), 0);
          }
          return socket;
        }),
        destroy: vi.fn(),
      };
      callback?.();
      return socket as unknown as net.Socket;
    });

    await expect(
      assertPgNotReachableOnInterfaces(["192.168.1.10"], 5432),
    ).rejects.toThrow(/ETIMEDOUT/);
  });

  it("throws when connection errors with ENETUNREACH (fail closed on ambiguous)", async () => {
    vi.spyOn(net, "createConnection").mockImplementation((_port: unknown, _host: unknown, callback?: () => void) => {
      const socket = {
        on: vi.fn().mockImplementation((event: string, handler: (err?: Error) => void) => {
          if (event === "error") {
            const err = Object.assign(new Error("net unreachable"), { code: "ENETUNREACH" });
            setTimeout(() => handler(err), 0);
          }
          return socket;
        }),
        destroy: vi.fn(),
      };
      callback?.();
      return socket as unknown as net.Socket;
    });

    await expect(
      assertPgNotReachableOnInterfaces(["192.168.1.10"], 5432),
    ).rejects.toThrow(/ENETUNREACH/);
  });

  it("resolves immediately for empty address list (no probe needed)", async () => {
    const spy = vi.spyOn(net, "createConnection");
    await expect(assertPgNotReachableOnInterfaces([], 5432)).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops at first reachable address (fails fast)", async () => {
    let callCount = 0;
    vi.spyOn(net, "createConnection").mockImplementation((_port: unknown, _host: unknown, callback?: () => void) => {
      callCount++;
      const socket = {
        on: vi.fn().mockImplementation((event: string, handler: () => void) => {
          if (event === "connect") setTimeout(() => handler(), 0);
          return socket;
        }),
        destroy: vi.fn(),
      };
      callback?.();
      return socket as unknown as net.Socket;
    });

    await expect(
      assertPgNotReachableOnInterfaces(["192.168.1.10", "192.168.1.11"], 5432),
    ).rejects.toThrow(/reachable/);
    // Only the first address is probed before the rejection
    expect(callCount).toBe(1);
  });
});

// --- Tier 4: static regression guard — all three constructor sites must pass postgresFlags ---

const REPO_ROOT = resolve("/home/taz/Development/paperclip-plugins/cc-g2-pg-lockdown-impl");

function readSrc(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

describe("postgresFlags static regression guard", () => {
  const constructorSites = [
    { file: "server/src/index.ts", label: "main server startup" },
    { file: "packages/db/src/migration-runtime.ts", label: "migration runtime" },
    { file: "packages/db/src/test-embedded-postgres.ts", label: "integration test helper" },
  ];

  for (const { file, label } of constructorSites) {
    it(`${label} (${file}) passes postgresFlags to EmbeddedPostgres constructor`, () => {
      const src = readSrc(file);
      expect(src).toMatch(/postgresFlags/);
    });
  }

  it("buildEmbeddedPostgresFlags snapshot — value must be the listen_addresses lockdown flag", async () => {
    const { buildEmbeddedPostgresFlags } = await import("./embedded-postgres-flags.js");
    const flags = buildEmbeddedPostgresFlags();
    expect(flags).toEqual(["-c", "listen_addresses=127.0.0.1"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHostClientHandlers } from "../../../packages/plugins/sdk/src/host-client-factory.js";
import { PLUGIN_RPC_ERROR_CODES } from "../../../packages/plugins/sdk/src/protocol.js";
import { buildHostServices } from "../services/plugin-host-services.js";

function createEventBusStub() {
  return {
    forPlugin() {
      return { emit: vi.fn(), subscribe: vi.fn() };
    },
  } as any;
}

function createHostStub(result: { url: string } | { url: null; reason: string }) {
  return {
    getReachableUrl: vi.fn().mockResolvedValue(result),
  };
}

describe("host.getReachableUrl capability gating", () => {
  const reachableResult = { url: "https://example.com/api/webhooks/gitea" };
  const unreachableResult = { url: null as null, reason: "loopback_bind" };

  it("allows call when plugin has host.urls.discover capability", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-record-id",
      "my-plugin",
      createEventBusStub(),
    );
    const hostStub = createHostStub(reachableResult);
    const handlers = createHostClientHandlers({
      pluginId: "my-plugin",
      capabilities: ["host.urls.discover"],
      services: { ...services, host: hostStub },
    });

    const result = await handlers["host.getReachableUrl"]({ pathname: "/api/webhooks/gitea" });
    expect(result).toEqual(reachableResult);
    expect(hostStub.getReachableUrl).toHaveBeenCalledWith({ pathname: "/api/webhooks/gitea" });
  });

  it("denies call when plugin lacks host.urls.discover capability", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-record-id",
      "my-plugin",
      createEventBusStub(),
    );
    const hostStub = createHostStub(reachableResult);
    const handlers = createHostClientHandlers({
      pluginId: "my-plugin",
      capabilities: [],
      services: { ...services, host: hostStub },
    });

    await expect(
      handlers["host.getReachableUrl"]({ pathname: "/api/webhooks/gitea" }),
    ).rejects.toMatchObject({ code: PLUGIN_RPC_ERROR_CODES.CAPABILITY_DENIED });

    expect(hostStub.getReachableUrl).not.toHaveBeenCalled();
  });

  it("forwards pathname to host service and returns unreachable result", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-record-id",
      "my-plugin",
      createEventBusStub(),
    );
    const hostStub = createHostStub(unreachableResult);
    const handlers = createHostClientHandlers({
      pluginId: "my-plugin",
      capabilities: ["host.urls.discover"],
      services: { ...services, host: hostStub },
    });

    const result = await handlers["host.getReachableUrl"]({ pathname: "/webhook" });
    expect(result).toEqual(unreachableResult);
    expect(hostStub.getReachableUrl).toHaveBeenCalledWith({ pathname: "/webhook" });
  });
});

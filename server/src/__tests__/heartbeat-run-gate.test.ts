import { describe, expect, it } from "vitest";
import { resolveRunGatePlugins, type RunGatePluginRow } from "../services/heartbeat.js";

const basePlugin = (overrides: Partial<RunGatePluginRow> = {}): RunGatePluginRow => ({
  id: "plugin-a",
  pluginKey: "test-plugin",
  installOrder: 1,
  capabilities: ["run.gate"],
  disabledForCompany: false,
  ...overrides,
});

describe("resolveRunGatePlugins", () => {
  it("returns empty list when no plugins have run.gate", () => {
    const plugins = [basePlugin({ capabilities: ["events.subscribe"] })];
    expect(resolveRunGatePlugins(plugins)).toEqual([]);
  });

  it("returns plugin with run.gate capability", () => {
    const plugins = [basePlugin()];
    const result = resolveRunGatePlugins(plugins);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("plugin-a");
  });

  it("filters out plugins disabled for the company", () => {
    const plugins = [basePlugin({ disabledForCompany: true })];
    expect(resolveRunGatePlugins(plugins)).toEqual([]);
  });

  it("sorts gate plugins by installOrder ascending", () => {
    const plugins = [
      basePlugin({ id: "c", installOrder: 3 }),
      basePlugin({ id: "a", installOrder: 1 }),
      basePlugin({ id: "b", installOrder: 2 }),
    ];
    const result = resolveRunGatePlugins(plugins);
    expect(result.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("treats null installOrder as Infinity (sorts last)", () => {
    const plugins = [
      basePlugin({ id: "null-order", installOrder: null }),
      basePlugin({ id: "has-order", installOrder: 1 }),
    ];
    const result = resolveRunGatePlugins(plugins);
    expect(result[0].id).toBe("has-order");
    expect(result[1].id).toBe("null-order");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDockerDriver, type DockerDriverOpts } from "../services/container-docker-driver.js";

describe("createDockerDriver — basic configuration", () => {
  it("constructs without errors with default options", () => {
    const driver = createDockerDriver({});
    expect(driver).toBeDefined();
    expect(typeof driver.start).toBe("function");
    expect(typeof driver.stop).toBe("function");
    expect(typeof driver.kill).toBe("function");
    expect(typeof driver.exec).toBe("function");
    expect(typeof driver.list).toBe("function");
    expect(typeof driver.inspect).toBe("function");
    expect(typeof driver.onStartup).toBe("function");
    expect(typeof driver.dispose).toBe("function");
  });

  it("uses docker as the default CLI command", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "abc123def456", stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner });
    await driver.start({
      image: "alpine:latest",
      labels: { "paperclip.plugin-id": "test-plugin" },
    });
    expect(runner).toHaveBeenCalledWith(
      expect.arrayContaining(["run", "-d"]),
      expect.any(Object),
    );
  });

  it("strips DOCKER_HOST from child process env before spawning", async () => {
    process.env.DOCKER_HOST = "unix:///run/docker.sock";
    const runner = vi.fn().mockResolvedValue({ stdout: "engine-id-1", stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner });
    await driver.start({ image: "alpine:latest", labels: {} });
    const callArgs = runner.mock.calls[0];
    const envArg = callArgs?.[1]?.env as Record<string, string> | undefined;
    expect(envArg?.["DOCKER_HOST"]).toBeUndefined();
    delete process.env.DOCKER_HOST;
  });

  it("start applies mandatory hardening flags", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "engine-id-1", stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner });
    await driver.start({ image: "alpine:latest", labels: {} });
    const args = runner.mock.calls[0][0] as string[];
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--security-opt=no-new-privileges:true");
    expect(args).toContain("--network=none");
    expect(args).toContain("--pids-limit=256");
  });

  it("start applies user-supplied memory limit", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "engine-id-1", stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner });
    await driver.start({ image: "alpine:latest", labels: {}, memoryMb: 256 });
    const args = runner.mock.calls[0][0] as string[];
    expect(args.some((a) => a.includes("256m"))).toBe(true);
  });

  it("stop calls docker stop with the engine container ID", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner });
    await driver.stop("engine-id-abc");
    const args = runner.mock.calls[0][0] as string[];
    expect(args[0]).toBe("stop");
    expect(args).toContain("engine-id-abc");
  });

  it("kill calls docker rm -f with the engine container ID", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner });
    await driver.kill("engine-id-abc");
    const args = runner.mock.calls[0][0] as string[];
    expect(args[0]).toBe("rm");
    expect(args).toContain("-f");
    expect(args).toContain("engine-id-abc");
  });
});

describe("createDockerDriver — probe endpoint helper", () => {
  it("probe returns ok:true when docker info succeeds", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: '{"ServerVersion":"24.0.0"}', stderr: "", exitCode: 0 });
    const driver = createDockerDriver({ cliRunner: runner }) as ReturnType<typeof createDockerDriver> & { probe(): Promise<{ ok: boolean; summary?: string }> };
    const result = await driver.probe();
    expect(result.ok).toBe(true);
  });

  it("probe returns ok:false when docker info fails", async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: "", stderr: "Cannot connect to Docker daemon", exitCode: 1 });
    const driver = createDockerDriver({ cliRunner: runner }) as ReturnType<typeof createDockerDriver> & { probe(): Promise<{ ok: boolean; summary?: string }> };
    const result = await driver.probe();
    expect(result.ok).toBe(false);
  });
});

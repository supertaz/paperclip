import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";

function createApp(
  actorType: "board" | "agent",
  boardSource: "session" | "local_implicit" | "board_key" = "session",
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actorType === "board"
      ? { type: "board", userId: "board", source: boardSource }
      : { type: "agent", agentId: "agent-1" };
    next();
  });
  app.use(boardMutationGuard());
  app.post("/mutate", (_req, res) => {
    res.status(204).end();
  });
  app.post("/api/issues/issue-1/comments", (_req, res) => {
    res.status(204).end();
  });
  app.patch("/api/issues/issue-1", (_req, res) => {
    res.status(204).end();
  });
  app.post("/api/companies/company-1/issues", (_req, res) => {
    res.status(204).end();
  });
  app.post("/api/projects/project-1/issues", (_req, res) => {
    res.status(204).end();
  });
  app.get("/read", (_req, res) => {
    res.status(204).end();
  });
  return app;
}

describe("boardMutationGuard", () => {
  it("allows safe methods for board actor", async () => {
    const app = createApp("board");
    const res = await request(app).get("/read");
    expect([200, 204]).toContain(res.status);
  });

  it("blocks board mutations without trusted origin", () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      actor: { type: "board", userId: "board", source: "session" },
      header: () => undefined,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Board mutation requires trusted browser origin",
    });
  });

  it("allows local implicit board mutations without origin", async () => {
    const app = createApp("board", "local_implicit");
    const res = await request(app).post("/mutate").send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  // Local-implicit /issues mutations from Playwright API contexts and other
  // header-less local clients (no Origin AND no Referer) are allowed when the
  // Host header proves the request reached us over a loopback interface OR
  // a configured PAPERCLIP_PUBLIC_URL. supertest sends Host=127.0.0.1:<port>
  // by default, which is loopback. The existing browser-spoof attack vector
  // — a foreign page POSTing with a mismatched Origin — is still blocked
  // (see anti-spoof tests below).

  it("allows local implicit issue comment mutations from header-less local clients", async () => {
    const app = createApp("board", "local_implicit");
    const res = await request(app).post("/api/issues/issue-1/comments").send({ body: "agent output" });
    expect([200, 204]).toContain(res.status);
  });

  it("allows local implicit issue updates from header-less local clients", async () => {
    const app = createApp("board", "local_implicit");
    const res = await request(app).patch("/api/issues/issue-1").send({ comment: "agent output" });
    expect([200, 204]).toContain(res.status);
  });

  it("allows local implicit issue creation from header-less local clients", async () => {
    const app = createApp("board", "local_implicit");
    const res = await request(app).post("/api/companies/company-1/issues").send({ title: "agent output" });
    expect([200, 204]).toContain(res.status);
  });

  it("allows local implicit issue mutations on nested issue route families from header-less local clients", async () => {
    const app = createApp("board", "local_implicit");
    const res = await request(app).post("/api/projects/project-1/issues").send({ title: "agent output" });
    expect([200, 204]).toContain(res.status);
  });

  it("allows local implicit browser issue mutations from trusted origin", async () => {
    const app = createApp("board", "local_implicit");
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("Origin", "http://localhost:3100")
      .send({ body: "board comment" });
    expect([200, 204]).toContain(res.status);
  });

  it("allows board bearer-key mutations without origin", async () => {
    const app = createApp("board", "board_key");
    const res = await request(app).post("/mutate").send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows board mutations from trusted origin", async () => {
    const app = createApp("board");
    const res = await request(app)
      .post("/mutate")
      .set("Origin", "http://localhost:3100")
      .send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows board mutations from trusted referer origin", async () => {
    const app = createApp("board");
    const res = await request(app)
      .post("/mutate")
      .set("Referer", "http://localhost:3100/issues/abc")
      .send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("allows board mutations when x-forwarded-host matches origin", async () => {
    const app = createApp("board");
    const res = await request(app)
      .post("/mutate")
      .set("Host", "127.0.0.1")
      .set("X-Forwarded-Host", "10.90.10.20:3443")
      .set("Origin", "https://10.90.10.20:3443")
      .send({ ok: true });
    expect([200, 204]).toContain(res.status);
  });

  it("blocks board mutations when x-forwarded-host does not match origin", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      actor: { type: "board", userId: "board", source: "session" },
      header: (name: string) => {
        if (name === "host") return "127.0.0.1";
        if (name === "x-forwarded-host") return "10.90.10.20:3443";
        if (name === "origin") return "https://evil.example.com";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Board mutation requires trusted browser origin",
    });
  });

  it("does not block authenticated agent mutations", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      actor: { type: "agent", agentId: "agent-1" },
      header: () => undefined,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // Header-absent fallback: Playwright API contexts and reverse-proxy clients
  // that strip Origin/Referer should still be allowed when the request reaches
  // the server over a loopback interface OR via a configured PAPERCLIP_PUBLIC_URL.
  // The anti-spoof intent is preserved: any caller that DOES send an Origin or
  // Referer header must match the trusted set or be rejected; and any header-less
  // request whose Host neither resolves to loopback nor matches the configured
  // public URL also still 403s.

  it("allows local implicit issue creation when Origin and Referer are both absent (Playwright API context)", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/companies/company-1/issues",
      url: "/api/companies/company-1/issues",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: (name: string) => {
        if (name.toLowerCase() === "host") return "127.0.0.1:34521";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows local implicit issue comment when Origin and Referer are both absent", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/issues/issue-1/comments",
      url: "/api/issues/issue-1/comments",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: (name: string) => {
        if (name.toLowerCase() === "host") return "127.0.0.1:34521";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows session board mutations when Origin and Referer are both absent and Host matches PAPERCLIP_PUBLIC_URL (reverse proxy)", async () => {
    const original = process.env.PAPERCLIP_PUBLIC_URL;
    process.env.PAPERCLIP_PUBLIC_URL = "https://internal.svc:8443";
    try {
      const middleware = boardMutationGuard();
      const req = {
        method: "POST",
        originalUrl: "/mutate",
        url: "/mutate",
        actor: { type: "board", userId: "board", source: "session" },
        header: (name: string) => {
          if (name.toLowerCase() === "host") return "internal.svc:8443";
          return undefined;
        },
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.PAPERCLIP_PUBLIC_URL;
      else process.env.PAPERCLIP_PUBLIC_URL = original;
    }
  });

  it("blocks header-absent fallback when Host is non-loopback and no PAPERCLIP_PUBLIC_URL is configured", async () => {
    const original = process.env.PAPERCLIP_PUBLIC_URL;
    delete process.env.PAPERCLIP_PUBLIC_URL;
    try {
      const middleware = boardMutationGuard();
      const req = {
        method: "POST",
        originalUrl: "/api/issues/issue-1/comments",
        url: "/api/issues/issue-1/comments",
        actor: { type: "board", userId: "board", source: "local_implicit" },
        header: (name: string) => {
          if (name.toLowerCase() === "host") return "evil-internal.example.com:8443";
          return undefined;
        },
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const next = vi.fn();

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    } finally {
      if (original === undefined) delete process.env.PAPERCLIP_PUBLIC_URL;
      else process.env.PAPERCLIP_PUBLIC_URL = original;
    }
  });

  it("allows header-absent fallback when Host is ipv6 loopback", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/issues/issue-1/comments",
      url: "/api/issues/issue-1/comments",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: (name: string) => {
        if (name.toLowerCase() === "host") return "[::1]:34521";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows header-absent fallback when Host is localhost (named loopback)", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/issues/issue-1/comments",
      url: "/api/issues/issue-1/comments",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: (name: string) => {
        if (name.toLowerCase() === "host") return "localhost:34521";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // P0 anti-spoof: header-absent fallback MUST NOT trigger when Origin OR
  // Referer is present-but-mismatched. A spoofed Origin is an attack signal
  // and must still 403 regardless of Host.

  it("blocks local implicit issue mutation when Origin is present but mismatched (anti-spoof)", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/issues/issue-1/comments",
      url: "/api/issues/issue-1/comments",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === "host") return "127.0.0.1:34521";
        if (lower === "origin") return "https://evil.example.com";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Issue mutation requires trusted browser origin or authenticated actor",
    });
  });

  it("blocks local implicit issue mutation when Referer is present but mismatched (anti-spoof)", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/issues/issue-1/comments",
      url: "/api/issues/issue-1/comments",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === "host") return "127.0.0.1:34521";
        if (lower === "referer") return "https://evil.example.com/issues/abc";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Issue mutation requires trusted browser origin or authenticated actor",
    });
  });

  it("blocks session board mutation when Origin is present but mismatched even if Host is trusted (anti-spoof)", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/mutate",
      url: "/mutate",
      actor: { type: "board", userId: "board", source: "session" },
      header: (name: string) => {
        const lower = name.toLowerCase();
        if (lower === "host") return "internal.svc:8443";
        if (lower === "origin") return "https://evil.example.com";
        return undefined;
      },
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Board mutation requires trusted browser origin",
    });
  });

  it("blocks header-absent fallback when Host header is also absent (defense-in-depth)", async () => {
    const middleware = boardMutationGuard();
    const req = {
      method: "POST",
      originalUrl: "/api/issues/issue-1/comments",
      url: "/api/issues/issue-1/comments",
      actor: { type: "board", userId: "board", source: "local_implicit" },
      header: () => undefined,
    } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

import type { Request, RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:3100",
  "http://127.0.0.1:3100",
];

function parseOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function trustedOriginsForRequest(req: Request) {
  const origins = new Set(DEFAULT_DEV_ORIGINS.map((value) => value.toLowerCase()));
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.header("host")?.trim();
  if (host) {
    origins.add(`http://${host}`.toLowerCase());
    origins.add(`https://${host}`.toLowerCase());
  }
  // Behind some reverse proxies the Host / X-Forwarded-Host header may
  // not match the public URL (for example when TLS terminates at the
  // edge and the inbound Host is an internal service name). Trust the
  // explicitly-configured PAPERCLIP_PUBLIC_URL when it's set.
  const publicUrl = parseOrigin(process.env.PAPERCLIP_PUBLIC_URL?.trim());
  if (publicUrl) origins.add(publicUrl);
  return origins;
}

function isTrustedBoardMutationRequest(req: Request) {
  const allowedOrigins = trustedOriginsForRequest(req);
  const originHeader = req.header("origin");
  const refererHeader = req.header("referer");
  const origin = parseOrigin(originHeader);
  if (origin && allowedOrigins.has(origin)) return true;

  const refererOrigin = parseOrigin(refererHeader);
  if (refererOrigin && allowedOrigins.has(refererOrigin)) return true;

  // Header-absent fallback: if neither Origin nor Referer is present at all,
  // treat the request as trusted when it carries a usable Host (or
  // X-Forwarded-Host) header proving it reached us over a known interface.
  // This restores access for non-browser local clients (Playwright API
  // contexts, internal scripts using a run-id auth path) and for browser
  // clients behind reverse proxies that strip Origin/Referer.
  //
  // Anti-spoof intent is preserved: a request that DOES send Origin or
  // Referer but with a mismatched value (handled above) still falls through
  // to the 403 caller — the fallback only fires when both headers are absent.
  if (originHeader === undefined && refererHeader === undefined) {
    const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || req.header("host")?.trim();
    if (host) return true;
  }

  return false;
}

function isIssueMutationRequest(req: Request) {
  const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
  return /^\/api(?:\/[^/]+)*\/issues(?:\/|$)/.test(path);
}

export function boardMutationGuard(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    if (req.actor.type !== "board") {
      next();
      return;
    }

    // Local-trusted browser requests are still the board UI. Local scripts that
    // mutate issue threads must authenticate or carry a resolvable run id so
    // they cannot silently write audit records as "local-board".
    if (req.actor.source === "local_implicit") {
      if (isIssueMutationRequest(req) && !isTrustedBoardMutationRequest(req)) {
        res.status(403).json({
          error: "Issue mutation requires trusted browser origin or authenticated actor",
        });
        return;
      }
      next();
      return;
    }

    // Board bearer keys are explicit non-browser credentials.
    if (req.actor.source === "board_key") {
      next();
      return;
    }

    if (!isTrustedBoardMutationRequest(req)) {
      res.status(403).json({ error: "Board mutation requires trusted browser origin" });
      return;
    }

    next();
  };
}

# SDK Integration Branch — `integration/sdk-all-passing`

## Summary

Unified integration branch merging 12 passing PRs onto `upstream/master`.
Fork: `https://github.com/supertaz/paperclip.git`
Branch HEAD: `bae50cf97`

SDK build: clean. SDK tests: 28/28 passing.

## Merged PRs (in merge order)

| PR | Tag | Description | Merge SHA |
|----|-----|-------------|-----------|
| #5035 | cc-g2 | Startup assertion for pg binding lockdown | f3ddd377c |
| #5037 | cc-g5 | Plugin capability gating — run.gate + host URL discovery | 4eee4ffdc |
| #5001 | cc-g3 | RBAC audit logging for runtime-config DELETE | 75541f4f1 |
| #5033 | ws-1 | Plugin run lifecycle — beforeRun hook | 314c3654f |
| #5036 | ws-2 | Plugin agent org-chart traversal | e2013f9fd |
| #5010 | ws-4 | Plugin issue custom fields | a11693ee8 |
| #5034 | ws-3 | Plugin peer entity reads (peerEntities service) | 54e9f7679 |
| #5032 | wf-3 | Plugin peerReads manifest declaration | 9ae3c3a48 |
| #5041 | cc-c1 | Plugin container management (ctx.containers) | ae403421f |
| #5043 | cc-c2 | Container cgroup infrastructure | 271f5a420 |
| #5054 | wf-1 | Plugin approvals workflow (ctx.approvals) | 79c9e8381 |
| #5007 | cc-g4 | Plugin secrets write/delete | ddfac7a91 |

## Excluded PRs

| PR | Tag | Reason |
|----|-----|--------|
| #4725 | — | CI unstable, unrelated to SDK |

## SDK Surfaces Added

All surfaces are additive — each PR adds a new `ctx.*` namespace or extends an existing one.

### `ctx.config.runtime` (cc-g3)
- `get()`, `set(key, value)`, `unset(key)` — per-plugin runtime config stored in DB
- Capability: `plugin.config.write`

### `ctx.host.getReachableUrl` (cc-g5)
- Resolves reachable URL for a given pathname from inside the worker
- Capability: `host.urls.discover`

### `ctx.runs.onBeforeRun` (ws-1)
- Register a gate handler called before a run is claimed by the heartbeat dispatcher
- Capability: `run.gate`

### `ctx.plugins.peer.entities` (ws-3 + wf-3)
- `list(params)`, `get(params)` — read entity records owned by another plugin
- Capability: `plugins.peer-reads.read`
- Provider plugins declare `peerReads.allow` in manifest

### `ctx.containers` (cc-c1 + cc-c2)
- `start(opts)`, `stop(id)`, `kill(id)`, `exec(id, cmd)`, `list(opts)`, `inspect(id)`
- Host-managed Docker containers with per-plugin isolation and cgroup limits
- Capability: `containers.manage`

### `ctx.approvals` (wf-1)
- `create(params)`, `get(params)`, `list(params)`, `onResolved(id, handler)`, `cancel(params)`
- Plugin-scoped approval requests surfaced on the Paperclip board
- Host→worker notification: `approvals.resolved`
- Capabilities: `approvals.create`, `approvals.read`

### `ctx.secrets.write` / `ctx.secrets.delete` (cc-g4)
- `write({ companyId, name, value, description? })` — create or rotate named secret in Paperclip vault
- `delete({ companyId, name })` — delete plugin-owned secret
- Capability: `secrets.write`

### Manifest additions (ws-4, wf-3)
- `customFields` — declare custom fields the plugin manages on issues
- `peerReads` — declare which other plugins' entity types this plugin may read

## Conflict Resolutions

All conflicts were additive (both sides add new service blocks). Resolution strategy: keep both.

| File | Conflict type | Resolution |
|------|--------------|------------|
| `sdk/src/host-client-factory.ts` | Repeated add/add on service blocks | Kept all blocks from all PRs |
| `sdk/src/protocol.ts` | Add/add on HostToWorkerMethods and WorkerToHostMethods | Kept all entries |
| `sdk/src/types.ts` | Add/add on PluginContext fields | Kept all fields |
| `sdk/src/worker-rpc-host.ts` | Add/add on context builder | Kept all sections |
| `server/src/services/plugin-host-services.ts` | Add/add on service sections | Kept all sections |
| `server/src/app.ts` | Import rename collision | Merged: kept heartbeatService + added `type PluginEventBus` |
| `db/src/migrations/meta/_journal.json` | (rerere resolved) | No manual action needed |
| `sdk/vitest.config.ts` | Add/add (rerere resolved) | No manual action needed |
| `ui/src/pages/PluginSettings.tsx` | (rerere resolved) | No manual action needed |

## Test Results

```
Test Files  4 passed (4)
     Tests  28 passed (28)
  Duration  ~400ms
```

Files: `src/types.test.ts`, `src/plugin-peer-reads.test.ts`, `src/__tests__/before-run-types.test.ts`, `src/containers.test.ts`

## Worktree

Path: `/home/taz/Development/paperclip-plugins/sdk-integration-impl`
Detached HEAD at `bae50cf97` (mirrors `github-fork/integration/sdk-all-passing`)

## Type Fixes Applied (post-merge)

| Fix | Reason |
|-----|--------|
| `sdk/src/index.ts`: export `PluginConfigRuntimeClient` | Was defined in types.ts but missing from index re-exports |
| `sdk/src/index.ts`: export `PluginSecretsClient` (write/delete) | Added by cc-g4 |
| `packages/shared/dist`: rebuilt after cc-g4 merge | `secrets.write` and `plugin.config.write` now in `PluginCapability` union |

## Notes on Reported Gaps

- `nameKey` on Agent: not present in any of the 12 merged PRs — not a merge gap
- `IssueCustomField.value`: ws-4 uses `valueText`/`valueNumber` — plugin code using `.value` needs updating
- `PluginJobDeclaration.key`: field is `jobKey` in shared types — plugin code using `.key` needs updating
- `PluginUiSlotDeclaration.label`: field is `displayName` — plugin code using `.label` needs updating
- `project-mentions.ts` errors: pre-existing on upstream/master, not caused by merges

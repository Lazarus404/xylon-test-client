# Xylon Test Client

Browser lab for [Xylon](https://github.com/Lazarus404/xylon), built with
[strike-fw](https://github.com/Lazarus404/strike.js) + `strike-fw-ui` and
[xylon-client-sdk](https://github.com/Lazarus404/xylon-client-sdk).

Tabs:

- **Control WS** -- `XylonRoom` (mint via SDK `AdminClient`, paste token, or lab
  tenant/session); `backend_opts` on the WS `join` frame (datachannel: mode/label;
  conference: `subscribe_mode: manual`). Dest checkboxes from presence;
  `room.send(..., { dest })`; groups snapshot/diff + Control REST create/add +
  `resolveDest` send (Bearer / Mint-Paste).
- **Admin** -- Control admin REST via `AdminClient` -> demo admin -> platform
  interface -> Xylon (never Xylon `/v1/tenants/...` from the browser)
- **HTTP Lab** -- classic POST create/offer; Auth Mint (HMAC via demo admin) or
  Off (`x-tenant-id` for `--control lab`); MFU
  RPC unicast / `*` / id-list buttons
- **SIP Echo** -- SIP.js REGISTER + INVITE

## Setup

```bash
cd ../xylon-client-sdk && npm install && npm run build
cd ../xylon-test-client
npm install
npm test
npm run build
```

## Dev

```bash
# From workspace root: secret store, interface, admin, Xylon HMAC+Local, Vite
../start.sh   # or: ./start.sh from workspace root

# Or Vite only (other services already running):
npm run dev
```

Vite proxies `/sip` and `/v1` (including WS) to `http://127.0.0.1:8080`.
Admin and mint calls go directly to demo admin (default `http://127.0.0.1:8092`;
CORS). The **Admin** tab also needs platform interface `:8093` and secret store
`:8091` (same as multi-tenant `start.sh`).

## Admin tab

Exercises SDK `AdminClient` against demo admin:

- Presence, history, inject, moderate on `/v1/sessions/:sid/...`
- Demo admin forwards to platform interface; interface gates and calls Xylon Control

Optional **Authorization header** field demonstrates `prepareRequest` for real
SaaS backends (lab leaves it empty).

Smoke: join a session on **Control WS**, then **Admin** -> Presence should list
participants.

## Control WS -- HMAC mint (recommended)

### Single-secret lab (Config adapter)

Shared lab secret: `lab-hmac-secret` (admin `config.example.json` and Mix
`--control hmac` default / `XYLON_CONTROL_HMAC_SECRET`). No `secrets:` adapter;
Xylon verifies every tenant with that one secret.

```bash
# 1) Demo admin
cd ../xylon-demo-customer-admin-app
go run ./cmd/admin -config config.example.json

# 2) Xylon with Control HMAC
cd ../xylon-datachannel-backend
XTURN_LOCAL_DEPS=1 mix xylon.datachannel --http-port 8080 --control hmac

# 3) Client
cd ../xylon-test-client
npm run dev
```

### Multi-tenant lab (Local secrets store)

From the workspace root, start everything:

```bash
./start.sh
```

That boots store `:8091`, interface `:8093` (seeds `acme`, writes `.lab/admin.json`),
admin `:8092`, Xylon `:8080` via `mix xylon.conference --control hmac` (echo +
datachannel + conference, `XYLON_CONTROL_SECRETS_URL`), and Vite `:5173`.
See [XYLON_ADMIN_ARCHITECTURE.md](../XYLON_ADMIN_ARCHITECTURE.md) section 11 for the
manual topology.

1. Prefer Vite client `http://127.0.0.1:5173/client/` (live); `:8080/` serves a static
   copy and may lag until `npm run build` in `xylon-test-client`
2. Tab **HTTP Lab** or **Control WS**: Auth **Mint**, tenant `acme`, session `room-1`
3. Connect (`AdminClient.mintToken` -> demo admin `POST /v1/token` on `:8092`)
4. Second browser tab, participant `b`, same session; send chat / A/V
5. Tab **Admin** -> Presence to verify roster via the admin path

HTTP Lab Auth **Off** is only for `--control lab` / control disabled (no Bearer).
With `./start.sh` (`--control hmac`), Mint is required on both HTTP Lab and Control WS.

### Phase 14 checklist (dest / groups / RPC)

**Dest (three tabs, Control WS, same session):**

1. Connect participants `a`, `b`, `c` (Mint or Lab with `--control lab` / hmac)
2. On `a`, check only `b` under Dest; send a chat JSON message
3. `b` log shows recv; `c` does not

**Groups (Lab under `--control lab`; Mint/Paste Bearer for `--control hmac`):**

1. Create group id (e.g. `breakout`); Add member `b`
2. Confirm groups snapshot/diff in the log / list
3. Send to group from `a` -- only members receive (never put group name on envelope)

**RPC broadcast (HTTP Lab, mode `mfu`, two tabs):**

1. Connect `a` and `b` with `rpc_router`
2. **RPC unicast** to peer id; **RPC \***; **RPC list** with `b,c` (or `b`)
3. Confirm first-responder / inbound log lines

Playwright checklist coverage: `./scripts/e2e-phase14.sh` (builds client, boots
`mix xylon.datachannel --control lab`, runs `@phase14` on Chrome). Specs under
`e2e/specs/datachannel_phase14_*.spec.mjs` (dest UI, groups, HTTP Lab RPC).

Auth modes:

| Mode | Behaviour |
| --- | --- |
| Mint | `AdminClient.mintToken` against admin URL (default `:8092`) |
| Paste | Bearer from the Token field |
| Lab | `tenant_id` / `session_id` only (`--control lab`) |

## Control WS -- lab (no crypto)

```bash
XTURN_LOCAL_DEPS=1 mix xylon.datachannel --http-port 8080 --control lab
```

Auth mode **Lab**, tenant `lab`, unique participant ids.

## HTTP Lab

With `./start.sh` (`--control hmac`): Auth **Mint**, tenant `acme`, admin `:8092`.

Standalone control disabled / `auth: :lab`: Auth **Off**, tenant `lab`. Prefer the
multi-library boot:

```bash
cd ../xylon-test-client && npm run build
cd ../xylon-conference-backend
XYLON_ADVERTISED_IP=127.0.0.1 XTURN_LOCAL_DEPS=1 mix xylon.conference --http-port 8080
```

For conference **feeds** / talking discovery (manual subscribe path), Control +
Presence are required:

```bash
XYLON_ADVERTISED_IP=127.0.0.1 XTURN_LOCAL_DEPS=1 mix xylon.conference --http-port 8080 --control hmac
```

Then use **HTTP Lab** or **Control WS** with Auth **Mint** (tenant `acme` when
using the secrets-store lab). Frame shapes and subscribe curl:
[xylon-conference-backend README](https://github.com/Lazarus404/xylon_conference_backend)
"App path (manual)".

Open http://127.0.0.1:5173/client/ (or a rebuilt `:8080/client/`) **HTTP Lab**:

| Library | Two tabs (same session, unique participant ids) |
| --- | --- |
| `datachannel` + mode `mfu` | Opens `chat` / `rpc` / `state` with `rpc_router` + `state_coalesce`. Chat Send; **RPC unicast / \* / list**; 10 Hz transform ticks (state ok/drop counters). |
| `datachannel` + opaque mode | Single DC label fanout |
| `conference` | A/V SFU; create/join sends `subscribe_mode: manual`. Lab does **not** auto-subscribe on feeds -- call WS/HTTP subscribe yourself until a future UI wires it. Mesh only if the session was created without those opts. |
| `echo` | A/V loopback |

Disconnect calls `DELETE /v1/sessions/:id/participants/:participant_id` so the
same participant id can reconnect. Re-offer with the same id also replaces the
stale peer if leave was skipped.

Datachannel-only boot remains:

```bash
cd ../xylon-datachannel-backend
XTURN_LOCAL_DEPS=1 mix xylon.datachannel --http-port 8080
```

## SIP Echo

```bash
cd ../xylon
XTURN_LOCAL_DEPS=1 mix xylon.echo --http-port 8080
```

Use the **SIP Echo** tab (`ws://host/sip`, subprotocol `sip`).

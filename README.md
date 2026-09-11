# Xylon Test Client

Browser lab for [Xylon](https://github.com/Lazarus404/xylon), built with
[strike-fw](https://github.com/Lazarus404/strike.js) + `strike-fw-ui` and
[xylon-client-sdk](https://github.com/Lazarus404/xylon-client-sdk).

Tabs:

- **Control WS** -- `XylonRoom` (mint via SDK `AdminClient`, paste token, or lab
  tenant/session); `backend_opts` on the WS `join` frame (datachannel: mode/label;
  conference: `subscribe_mode: manual`)
- **Admin** -- Control admin REST via `AdminClient` -> demo admin -> platform
  interface -> Xylon (never Xylon `/v1/tenants/...` from the browser)
- **HTTP Lab** -- classic POST create/offer (control off / `x-tenant-id`)
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
admin `:8092`, Xylon `:8080` with `XYLON_CONTROL_SECRETS_URL`, and Vite `:5173`.
See [XYLON_ADMIN_ARCHITECTURE.md](../XYLON_ADMIN_ARCHITECTURE.md) section 11 for the
manual topology.

1. Tab **Control WS**, auth mode **Mint**, tenant `acme`, session `room-1`
2. Connect (`AdminClient.mintToken` -> demo admin `POST /v1/token`)
3. Second browser tab, participant `b`, same session; send chat
4. Tab **Admin** -> Presence to verify roster via the admin path

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

Control disabled / `auth: :lab`. Prefer the multi-library boot:

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

Then use the **Control WS** tab (or HTTP create + Control join). Frame shapes and
subscribe curl: [xylon-conference-backend README](https://github.com/Lazarus404/xylon_conference_backend)
"App path (manual)".

Open http://127.0.0.1:8080/client/ **HTTP Lab**:

| Library | Two tabs (same session, unique participant ids) |
| --- | --- |
| `datachannel` + mode `mfu` | Opens `chat` / `rpc` / `state` with `rpc_router` + `state_coalesce`. Chat Send; **RPC ping**; 10 Hz transform ticks (state ok/drop counters). |
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

import { useRef, useState } from "strike-fw/hooks";
import { Btn, Field, Select, Stack, Text } from "strike-fw/ui";
import { Card } from "strike-fw-ui/surfaces/card.js";
import {
  XylonRoom,
  resolveDest,
  sendResolvedJson,
  waitDataChannelOpen
} from "xylon-client-sdk";
import {
  createAdminClient,
  DEFAULT_ADMIN_URL,
  mintToken
} from "../admin_client.js";
import { formatLogLine } from "../dc_room.js";

/** @param {string} wsUrl */
function httpBaseFromWs(wsUrl) {
  return String(wsUrl || "")
    .trim()
    .replace(/^ws/i, "http")
    .replace(/\/v1\/ws\/?$/i, "")
    .replace(/\/+$/, "");
}

/**
 * Control WS room via xylon-client-sdk (mint / paste / lab).
 * @param {{ defaultWsUrl: string, onStatus: (msg: string, tone?: string) => void }} props
 */
export function ControlRoomPanel({ defaultWsUrl, onStatus }) {
  const [wsUrl, setWsUrl] = useState(defaultWsUrl);
  const [authMode, setAuthMode] = useState("mint");
  const [adminUrl, setAdminUrl] = useState(DEFAULT_ADMIN_URL);
  const [token, setToken] = useState("");
  const [tenantId, setTenantId] = useState("acme");
  const [sessionId, setSessionId] = useState("room-1");
  const [participantId, setParticipantId] = useState("a");
  const [library, setLibrary] = useState("datachannel");
  const [label, setLabel] = useState("chat");
  const [mode, setMode] = useState("fanout_except_sender");
  const [msg, setMsg] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dcReady, setDcReady] = useState(false);
  const [peerIds, setPeerIds] = useState([]);
  const [selectedDest, setSelectedDest] = useState({});
  const [groupsMap, setGroupsMap] = useState({});
  const [groupId, setGroupId] = useState("breakout");
  const [groupMemberId, setGroupMemberId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");

  const roomRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const authTokenRef = useRef("");
  const selfIdRef = useRef("");

  function appendLog(kind, text) {
    setLog((prev) => prev + formatLogLine(kind, text) + "\n");
  }

  function onAuthModeChange(next) {
    setAuthMode(next);
    if (next === "lab") {
      setTenantId((t) => (t === "acme" ? "lab" : t));
    } else if (next === "mint") {
      setTenantId((t) => (t === "lab" ? "acme" : t));
    }
  }

  function clearE2eHook() {
    try {
      if (typeof window !== "undefined" && window.__xylonRoom === roomRef.current) {
        window.__xylonRoom = null;
      }
    } catch (_) {}
  }

  function exposeE2eHook(room) {
    try {
      if (typeof window !== "undefined") {
        window.__xylonRoom = room;
      }
    } catch (_) {}
  }

  function applyPresenceIds(ids) {
    const self = selfIdRef.current;
    const others = ids.filter((id) => id && id !== self).sort();
    setPeerIds(others);
    setSelectedDest((prev) => {
      const next = {};
      for (const id of others) {
        if (prev[id]) next[id] = true;
      }
      return next;
    });
  }

  function wirePresenceAndGroups(room) {
    room.onPresenceSnapshot = (frame) => {
      const ids = Object.keys((frame && frame.participants) || {});
      applyPresenceIds(ids);
      appendLog("info", `presence.snapshot n=${ids.length}`);
    };
    room.onPresenceDiff = (frame) => {
      const pid = frame && frame.participant_id;
      const action = frame && frame.action;
      appendLog("info", `presence.diff ${action} ${pid}`);
      setPeerIds((prev) => {
        let next = prev.slice();
        if (action === "join" && pid && pid !== selfIdRef.current && !next.includes(pid)) {
          next = [...next, pid].sort();
        } else if (action === "leave" && pid) {
          next = next.filter((id) => id !== pid);
        }
        return next;
      });
      if (action === "leave" && pid) {
        setSelectedDest((prev) => {
          const next = { ...prev };
          delete next[pid];
          return next;
        });
      }
    };
    room.onGroupsSnapshot = (frame) => {
      const groups = (frame && frame.groups) || {};
      setGroupsMap(groups);
      appendLog("info", `groups.snapshot n=${Object.keys(groups).length}`);
    };
    room.onGroupsDiff = (frame) => {
      appendLog(
        "info",
        `groups.diff ${frame.action} ${frame.group_id} ${frame.participant_id || ""}`
      );
      setGroupsMap((prev) => {
        const next = { ...prev };
        const gid = frame.group_id;
        if (frame.action === "create") {
          next[gid] = next[gid] || [];
        } else if (frame.action === "delete") {
          delete next[gid];
        } else if (frame.action === "add_member" && frame.participant_id) {
          const members = new Set(next[gid] || []);
          members.add(frame.participant_id);
          next[gid] = [...members];
        } else if (frame.action === "remove_member" && frame.participant_id) {
          next[gid] = (next[gid] || []).filter((id) => id !== frame.participant_id);
        }
        return next;
      });
    };
  }

  function wireConferenceSignals(room) {
    room.__e2eFeedsDiffs = [];
    room.__e2eLastFeedsSnapshot = null;
    room.onFeedsSnapshot = (frame) => {
      room.__e2eLastFeedsSnapshot = frame;
      const pubs = (frame && frame.publishers) || [];
      appendLog("info", `feeds.snapshot n=${pubs.length} ${JSON.stringify(pubs)}`);
    };
    room.onFeedsDiff = (frame) => {
      room.__e2eFeedsDiffs.push(frame);
      appendLog(
        "info",
        `feeds.diff ${frame.action} ${frame.participant_id} ${JSON.stringify(frame.streams || frame.kinds || [])}`
      );
    };
    wirePresenceAndGroups(room);
  }

  async function onConnect() {
    setBusy(true);
    setDcReady(false);
    setPeerIds([]);
    setSelectedDest({});
    setGroupsMap({});
    try {
      if (!participantId.trim()) throw new Error("participant id required");
      if (!sessionId.trim()) throw new Error("session id required");

      const lbl = label.trim() || "chat";
      const self = participantId.trim();
      selfIdRef.current = self;
      const room = new XylonRoom();
      roomRef.current = room;
      room.onconnectionstatechange = (s) => onStatus(`PC ${s}`, "info");
      room.onerror = (err) => onStatus(String(err.message || err), "danger");

      onStatus("Control WS joining...", "info");

      const lib = library.trim() || "datachannel";
      const conference = lib === "conference";
      const backendOpts =
        lib === "datachannel"
          ? { mode, default_label: lbl }
          : conference
            ? { subscribe_mode: "manual" }
            : undefined;

      /** @type {import("xylon-client-sdk").ConnectOptions} */
      const connectOpts = {
        wsUrl: wsUrl.trim(),
        library: lib,
        participantId: self,
        dataChannelLabels: lib === "datachannel" ? [lbl] : [],
        ...(backendOpts ? { backendOpts } : {})
      };

      authTokenRef.current = "";
      if (authMode === "mint") {
        const tid = tenantId.trim() || "acme";
        connectOpts.tenantId = tid;
        connectOpts.sessionId = sessionId.trim();
        const admin = createAdminClient(adminUrl.trim() || DEFAULT_ADMIN_URL);
        connectOpts.getToken = async () => {
          const tok = await mintToken(admin, {
            sessionId: sessionId.trim(),
            participantId: self
          });
          authTokenRef.current = tok;
          return tok;
        };
      } else if (authMode === "paste") {
        const tok = token.trim();
        if (!tok) throw new Error("token required for paste mode");
        connectOpts.token = tok;
        authTokenRef.current = tok;
        if (tenantId.trim()) connectOpts.tenantId = tenantId.trim();
        if (sessionId.trim()) connectOpts.sessionId = sessionId.trim();
      } else {
        connectOpts.tenantId = tenantId.trim() || "lab";
        connectOpts.sessionId = sessionId.trim();
      }

      if (conference) {
        wireConferenceSignals(room);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true
        });
        localStreamRef.current = stream;
        connectOpts.mediaStream = stream;
        try {
          if (typeof window !== "undefined" && window.__xylonVideoPublish) {
            connectOpts.videoPublish = window.__xylonVideoPublish;
          }
        } catch (_) {}
      } else {
        wirePresenceAndGroups(room);
      }

      await room.connect(connectOpts);
      exposeE2eHook(room);

      if (conference) {
        setConnected(true);
        appendLog(
          "info",
          `joined ${sessionId.trim()} as ${self} (${authMode}) conference`
        );
        onStatus("Control WS conference connected", "ok");
        return;
      }

      const channel = room.dataChannel(lbl) || room.createDataChannel(lbl);
      dcRef.current = channel;
      wireDc(room, channel, lbl);
      await waitDataChannelOpen(channel);
      setDcReady(true);
      appendLog("info", `dc open label=${lbl}`);

      setConnected(true);
      appendLog("info", `joined ${sessionId.trim()} as ${self} (${authMode})`);
      onStatus("Control WS connected", "ok");
    } catch (err) {
      console.error("[xylon-client]", err);
      const msgText = String(err && err.message ? err.message : err);
      onStatus(msgText, "danger");
      appendLog("info", msgText);
      teardown();
    } finally {
      setBusy(false);
    }
  }

  function wireDc(room, channel, lbl) {
    room.__e2eDcRecv = [];
    channel.onopen = () => {
      setDcReady(true);
      appendLog("info", `dc open label=${lbl}`);
      onStatus("datachannel open", "ok");
    };
    channel.onmessage = (ev) => {
      const data = String(ev.data);
      room.__e2eDcRecv.push(data);
      appendLog("recv", data);
      onStatus(`recv: ${data}`, "ok");
    };
    channel.onclose = () => {
      setDcReady(false);
      appendLog("info", "dc closed");
    };
    if (channel.readyState === "open") {
      setDcReady(true);
    }
  }

  function teardown() {
    clearE2eHook();
    try {
      if (dcRef.current) dcRef.current.close();
    } catch (_) {}
    try {
      if (roomRef.current) roomRef.current.close();
    } catch (_) {}
    try {
      const stream = localStreamRef.current;
      if (stream) {
        for (const t of stream.getTracks()) t.stop();
      }
    } catch (_) {}
    roomRef.current = null;
    dcRef.current = null;
    localStreamRef.current = null;
    authTokenRef.current = "";
    selfIdRef.current = "";
    setConnected(false);
    setDcReady(false);
    setPeerIds([]);
    setSelectedDest({});
    setGroupsMap({});
  }

  function onDisconnect() {
    teardown();
    appendLog("info", "disconnected");
    onStatus("Control WS disconnected", "muted");
  }

  function selectedDestIds() {
    return peerIds.filter((id) => selectedDest[id]);
  }

  function onSend() {
    const room = roomRef.current;
    const lbl = label.trim() || "chat";
    if (!room || !dcReady) {
      onStatus("room dc not open", "warn");
      return;
    }
    const text = msg.trim() || msg;
    const payload = { type: "chat", text };
    const dest = selectedDestIds();
    try {
      if (dest.length > 0) {
        room.send(lbl, payload, { dest });
        appendLog("sent", JSON.stringify({ ...payload, to: dest }));
      } else {
        room.send(lbl, payload);
        appendLog("sent", JSON.stringify(payload));
      }
      setMsg("");
    } catch (err) {
      onStatus(String(err.message || err), "danger");
    }
  }

  function toggleDest(id) {
    setSelectedDest((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function controlPost(path, body) {
    const base = httpBaseFromWs(wsUrl);
    const tid = tenantId.trim();
    const sid = sessionId.trim();
    const url = `${base}/v1/tenants/${encodeURIComponent(tid)}/sessions/${encodeURIComponent(sid)}${path}`;
    /** @type {Record<string, string>} */
    const headers = {
      accept: "application/json",
      "content-type": "application/json"
    };
    if (authMode === "lab") {
      headers["x-tenant-id"] = tid || "lab";
    } else {
      const tok = authTokenRef.current || token.trim();
      if (!tok) {
        throw new Error("Bearer token required (use Mint or Paste auth for groups REST)");
      }
      headers.authorization = `Bearer ${tok}`;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  /**
   * Lab auth: POST dest/resolve with x-tenant-id (no Bearer).
   * @param {string} gid
   * @returns {Promise<"all" | string[]>}
   */
  async function resolveDestLab(gid) {
    const base = httpBaseFromWs(wsUrl);
    const tid = tenantId.trim() || "lab";
    const sid = sessionId.trim();
    const url =
      `${base}/v1/tenants/${encodeURIComponent(tid)}/sessions/${encodeURIComponent(sid)}` +
      `/dest/resolve`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-tenant-id": tid
      },
      body: JSON.stringify({
        dest: { group: gid },
        participant_id: participantId.trim()
      })
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    if (!data || data.ok !== true || data.dest === undefined) {
      throw new Error("dest/resolve: unexpected response");
    }
    return data.dest;
  }

  async function onCreateGroup() {
    try {
      const gid = groupId.trim();
      if (!gid) throw new Error("group id required");
      await controlPost("/groups", { group_id: gid });
      appendLog("info", `group created ${gid}`);
      onStatus(`group ${gid} created`, "ok");
      setSelectedGroup(gid);
    } catch (err) {
      onStatus(String(err.message || err), "danger");
      appendLog("info", String(err.message || err));
    }
  }

  async function onAddGroupMember() {
    try {
      const gid = (selectedGroup || groupId).trim();
      const mid = (groupMemberId.trim() || peerIds[0] || "").trim();
      if (!gid) throw new Error("group id required");
      if (!mid) throw new Error("member participant id required");
      await controlPost(`/groups/${encodeURIComponent(gid)}/members`, {
        participant_id: mid
      });
      appendLog("info", `group ${gid} + ${mid}`);
      onStatus(`added ${mid} to ${gid}`, "ok");
    } catch (err) {
      onStatus(String(err.message || err), "danger");
      appendLog("info", String(err.message || err));
    }
  }

  async function onSendToGroup() {
    const room = roomRef.current;
    const channel = dcRef.current;
    const gid = (selectedGroup || groupId).trim();
    if (!room || !channel || !dcReady) {
      onStatus("room dc not open", "warn");
      return;
    }
    if (!gid) {
      onStatus("select a group", "warn");
      return;
    }
    try {
      let dest;
      if (authMode === "lab") {
        dest = await resolveDestLab(gid);
      } else {
        const tok = authTokenRef.current || token.trim();
        if (!tok) {
          onStatus("Bearer token required for dest/resolve", "warn");
          return;
        }
        ({ dest } = await resolveDest(
          httpBaseFromWs(wsUrl),
          {
            token: tok,
            tenantId: tenantId.trim(),
            sessionId: sessionId.trim(),
            participantId: participantId.trim()
          },
          { group: gid }
        ));
      }
      const payload = { type: "chat", text: msg.trim() || msg || `hi ${gid}` };
      await sendResolvedJson(channel, payload, dest);
      appendLog("sent", JSON.stringify({ ...payload, resolved: dest, group: gid }));
      setMsg("");
      onStatus(`sent to group ${gid}`, "ok");
    } catch (err) {
      onStatus(String(err.message || err), "danger");
      appendLog("info", String(err.message || err));
    }
  }

  const groupOptions = Object.keys(groupsMap)
    .sort()
    .map((gid) => ({ value: gid, label: `${gid} (${(groupsMap[gid] || []).length})` }));

  return (
    <Card
      outlined
      title="Control WebSocket"
      subtitle="xylon-client-sdk · AdminClient mint, paste token, or lab tenant/session."
    >
      <Stack gap={12}>
        <Text as="p" class="xylon-hint">
          Mint uses SDK AdminClient against demo admin (default :8092); platform
          interface is server-side. Use Lab with <code>--control lab</code>; Mint/Paste
          with <code>--control hmac</code>. Dest picker uses presence. Groups mutate /
          resolve: Lab uses <code>x-tenant-id</code>; Mint/Paste need Bearer.
          Conference join sends <code>subscribe_mode: manual</code>; call subscribe on
          feeds yourself.
        </Text>
        <Field
          label="Control WS URL"
          value={wsUrl}
          onInput={(e) => setWsUrl(e.target.value)}
        />
        <Select
          label="Auth mode"
          value={authMode}
          onChange={(e) => onAuthModeChange(e.target.value)}
          options={[
            { value: "mint", label: "Mint (AdminClient -> demo admin)" },
            { value: "paste", label: "Paste token" },
            { value: "lab", label: "Lab (tenant/session, no crypto)" }
          ]}
        />
        {authMode === "mint" ? (
          <Field
            label="Admin URL"
            value={adminUrl}
            onInput={(e) => setAdminUrl(e.target.value)}
            placeholder={DEFAULT_ADMIN_URL}
          />
        ) : null}
        {authMode === "paste" ? (
          <Field
            label="Token"
            value={token}
            onInput={(e) => setToken(e.target.value)}
            placeholder="host-minted HMAC/JWT"
          />
        ) : null}
        <div class="xylon-panel-grid xylon-panel-grid--2">
          <Field
            label="Tenant"
            value={tenantId}
            onInput={(e) => setTenantId(e.target.value)}
          />
          <Field
            label="Session / room"
            value={sessionId}
            onInput={(e) => setSessionId(e.target.value)}
          />
          <Field
            label="Participant id"
            value={participantId}
            onInput={(e) => setParticipantId(e.target.value)}
          />
          <Field
            label="Library"
            value={library}
            onInput={(e) => setLibrary(e.target.value)}
          />
          <Field
            label="DC label"
            value={label}
            onInput={(e) => setLabel(e.target.value)}
          />
          <Select
            label="Mode (on join create)"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            options={[
              { value: "fanout_except_sender", label: "fanout_except_sender" },
              { value: "fanout_all", label: "fanout_all" }
            ]}
          />
        </div>
        <Stack row gap={8}>
          <Btn
            variant="primary"
            type="button"
            state={busy ? "busy" : "rest"}
            disabled={busy || connected}
            onClick={onConnect}
          >
            Connect
          </Btn>
          <Btn type="button" disabled={!connected} onClick={onDisconnect}>
            Disconnect
          </Btn>
        </Stack>
        <div>
          <Text as="p" class="xylon-hint">
            Dest (empty = Session default). Presence peers:
          </Text>
          {peerIds.length === 0 ? (
            <Text as="p" class="xylon-hint">
              (none yet)
            </Text>
          ) : (
            <Stack gap={4}>
              {peerIds.map((id) => (
                <label key={id} class="xylon-hint">
                  <input
                    type="checkbox"
                    checked={!!selectedDest[id]}
                    disabled={!dcReady}
                    onChange={() => toggleDest(id)}
                  />{" "}
                  {id}
                </label>
              ))}
            </Stack>
          )}
        </div>
        <Stack row gap={8}>
          <Field
            label="Message"
            value={msg}
            onInput={(e) => setMsg(e.target.value)}
            disabled={!dcReady}
          />
          <Btn type="button" disabled={!dcReady} onClick={onSend}>
            Send
          </Btn>
        </Stack>
        <div>
          <Text as="p" class="xylon-hint">
            Groups (Lab: x-tenant-id; Mint/Paste: Bearer; snapshot/diff via WS):
          </Text>
          <div class="xylon-panel-grid xylon-panel-grid--2">
            <Field
              label="Group id"
              value={groupId}
              onInput={(e) => setGroupId(e.target.value)}
              disabled={!connected}
            />
            <Field
              label="Add member id"
              value={groupMemberId}
              onInput={(e) => setGroupMemberId(e.target.value)}
              placeholder={peerIds[0] || "participant id"}
              disabled={!connected}
            />
          </div>
          <Stack row gap={8}>
            <Btn type="button" disabled={!connected} onClick={onCreateGroup}>
              Create group
            </Btn>
            <Btn type="button" disabled={!connected} onClick={onAddGroupMember}>
              Add member
            </Btn>
            <Btn type="button" disabled={!dcReady} onClick={onSendToGroup}>
              Send to group
            </Btn>
          </Stack>
          {groupOptions.length > 0 ? (
            <Select
              label="Active group"
              value={selectedGroup || groupOptions[0].value}
              onChange={(e) => setSelectedGroup(e.target.value)}
              options={groupOptions}
            />
          ) : (
            <Text as="p" class="xylon-hint">
              (no groups yet)
            </Text>
          )}
          {Object.keys(groupsMap).length > 0 ? (
            <pre class="xylon-log">
              {Object.entries(groupsMap)
                .map(([gid, members]) => `${gid}: ${(members || []).join(", ")}`)
                .join("\n")}
            </pre>
          ) : null}
        </div>
        <pre class="xylon-log">{log || " "}</pre>
      </Stack>
    </Card>
  );
}

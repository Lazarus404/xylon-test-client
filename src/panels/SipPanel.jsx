import { useRef, useState } from "strike-fw/hooks";
import { Btn, Check, Field, Stack, Text } from "strike-fw/ui";
import { Card } from "strike-fw-ui/surfaces/card.js";
import { resolveMediaPlan } from "../media_constraints.js";
import {
  hangupSip,
  sendDcPing,
  startSipEcho
} from "../sip_lab.js";

/**
 * SIP.js REGISTER + INVITE lab against Xylon Echo.
 * @param {{ defaultWsUrl: string, onStatus: (msg: string, tone?: string) => void }} props
 */
export function SipPanel({ defaultWsUrl, onStatus }) {
  const [wsUrl, setWsUrl] = useState(defaultWsUrl);
  const [fromAor, setFromAor] = useState("sip:client@127.0.0.1");
  const [targetAor, setTargetAor] = useState("sip:echo@127.0.0.1");
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(false);
  const [datachannel, setDatachannel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [dcOpen, setDcOpen] = useState(false);

  const sessionRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);

  async function onStart() {
    setBusy(true);
    setDcOpen(false);
    try {
      const plan = resolveMediaPlan({ audio, video, datachannel });
      sessionRef.current = await startSipEcho({
        wsUrl: wsUrl.trim(),
        fromAor: fromAor.trim(),
        targetAor: targetAor.trim(),
        plan,
        localVideoEl: localVideoRef.current,
        remoteVideoEl: remoteVideoRef.current,
        remoteAudioEl: remoteAudioRef.current,
        onStatus,
        onDcOpen: () => setDcOpen(true),
        onTerminated: () => {
          setLive(false);
          setDcOpen(false);
          setBusy(false);
        }
      });
      setLive(true);
    } catch (err) {
      console.error("[xylon-client]", err);
      onStatus(String(err && err.message ? err.message : err), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function onHangup() {
    await hangupSip(sessionRef.current);
    sessionRef.current = null;
    setLive(false);
    setDcOpen(false);
    onStatus("hung up", "muted");
  }

  function onPing() {
    const ok = sendDcPing(sessionRef.current);
    onStatus(ok ? "DC ping sent" : "datachannel not open", ok ? "ok" : "warn");
  }

  return (
    <Card
      outlined
      title="SIP Echo"
      subtitle="SIP.js over /sip into Xylon Echo (tenant lab)."
    >
      <Stack gap={12}>
        <div class="xylon-panel-grid xylon-panel-grid--2">
          <Check
            label="Audio"
            checked={audio}
            onChange={(e) => setAudio(e.target.checked)}
          />
          <Check
            label="Video"
            checked={video}
            onChange={(e) => setVideo(e.target.checked)}
          />
          <Check
            label="Datachannel"
            checked={datachannel}
            onChange={(e) => setDatachannel(e.target.checked)}
          />
        </div>
        <Field
          label="WS URL"
          value={wsUrl}
          onInput={(e) => setWsUrl(e.target.value)}
        />
        <Field
          label="From AOR"
          value={fromAor}
          onInput={(e) => setFromAor(e.target.value)}
        />
        <Field
          label="Echo target"
          value={targetAor}
          onInput={(e) => setTargetAor(e.target.value)}
        />
        <Stack row gap={8}>
          <Btn
            variant="primary"
            type="button"
            state={busy ? "busy" : "rest"}
            disabled={busy || live}
            onClick={onStart}
          >
            Register + Invite
          </Btn>
          <Btn type="button" disabled={!live} onClick={onHangup}>
            Hang up
          </Btn>
          <Btn type="button" disabled={!dcOpen} onClick={onPing}>
            Send DC ping
          </Btn>
        </Stack>
        <div class="xylon-media">
          <video ref={localVideoRef} autoplay playsinline muted />
          <video ref={remoteVideoRef} autoplay playsinline />
          <audio ref={remoteAudioRef} autoplay />
        </div>
        <Text as="p" class="xylon-hint">
          Local preview left; remote right. Audio plays through the hidden element.
        </Text>
      </Stack>
    </Card>
  );
}

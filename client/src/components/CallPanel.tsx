import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api } from '../lib/api';
import type { User } from '../types/social';
import Modal from './Modal';
type Call = { callId: string; peer: User; video: boolean; incoming: boolean; status: string };
type Signal = {
  callId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
export default function CallPanel({
  socket,
  onError,
}: {
  socket: Socket | null;
  onError: (s: string) => void;
}) {
  const [call, setCall] = useState<Call | null>(null);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camera, setCamera] = useState(true);
  const state = useRef<Call | null>(null);
  const connection = useRef<RTCPeerConnection | null>(null);
  const ready = useRef<Promise<RTCPeerConnection> | null>(null);
  const local = useRef<MediaStream | null>(null);
  const remote = useRef<MediaStream | null>(null);
  const candidates = useRef<RTCIceCandidateInit[]>([]);
  const selfVideo = useRef<HTMLVideoElement>(null);
  const peerVideo = useRef<HTMLVideoElement>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  function update(value: Call | null) {
    state.current = value;
    setCall(value);
  }
  function cleanup() {
    connection.current?.close();
    connection.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    remote.current = null;
    candidates.current = [];
    if (mounted.current) {
      update(null);
      setBusy(false);
      setMuted(false);
      setCamera(true);
    } else state.current = null;
    working.current = false;
  }
  function end() {
    if (state.current) socket?.emit('call:end', { callId: state.current.callId });
    cleanup();
  }
  async function media(video: boolean) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw Error('Gọi thoại/video cần HTTPS hoặc localhost và quyền micro/camera.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    if (!mounted.current) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error('Đã đóng cuộc gọi.');
    }
    local.current = stream;
    if (selfVideo.current) selfVideo.current.srcObject = stream;
  }
  async function connect() {
    const config = await api<RTCConfiguration>('/calls/config');
    if (!state.current) throw Error('Cuộc gọi đã kết thúc.');
    const pc = new RTCPeerConnection(config);
    connection.current = pc;
    local.current?.getTracks().forEach((track) => pc.addTrack(track, local.current!));
    pc.onicecandidate = (event) => {
      if (event.candidate && state.current)
        socket?.emit('call:signal', {
          callId: state.current.callId,
          candidate: event.candidate.toJSON(),
        });
    };
    pc.ontrack = (event) => {
      remote.current = event.streams[0] || new MediaStream([event.track]);
      if (peerVideo.current) {
        peerVideo.current.srcObject = remote.current;
        void peerVideo.current.play().catch(() => {});
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && state.current)
        update({ ...state.current, status: 'Đang gọi' });
      if (['failed', 'closed'].includes(pc.connectionState) && connection.current === pc) {
        onError('Kết nối cuộc gọi bị gián đoạn.');
        end();
      }
    };
    return pc;
  }
  useEffect(() => {
    mounted.current = true;
    const incoming = (data: { callId: string; caller: User; video: boolean }) => {
      if (state.current?.callId === data.callId) return;
      if (state.current || working.current) {
        socket?.emit('call:end', { callId: data.callId });
        return;
      }
      update({
        callId: data.callId,
        peer: data.caller,
        video: data.video,
        incoming: true,
        status: 'Cuộc gọi đến',
      });
    };
    const start = async (event: Event) => {
      if (!socket?.connected) {
        onError('Chưa kết nối máy chủ cuộc gọi.');
        return;
      }
      if (state.current || working.current) {
        onError('Bạn đang có một cuộc gọi.');
        return;
      }
      working.current = true;
      setBusy(true);
      const { peer, video } = (event as CustomEvent<{ peer: User; video: boolean }>).detail;
      try {
        await media(video);
        const result = await socket
          .timeout(10000)
          .emitWithAck('call:start', { recipientId: peer.id, video });
        if (result.error) throw Error(result.error);
        if (!mounted.current) {
          socket.emit('call:end', { callId: result.callId });
          cleanup();
          return;
        }
        update({ callId: result.callId, peer, video, incoming: false, status: 'Đang đổ chuông…' });
        ready.current = connect();
        await ready.current;
      } catch (e) {
        onError((e as Error).message);
        end();
      } finally {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    };
    const accepted = async ({ callId }: { callId: string }) => {
      if (state.current?.callId !== callId) return;
      try {
        const pc = await ready.current;
        if (!pc || state.current?.callId !== callId) return;
        update({ ...state.current, incoming: false, status: 'Đang kết nối…' });
        await pc.setLocalDescription(await pc.createOffer());
        socket?.emit('call:signal', { callId, description: pc.localDescription?.toJSON() });
      } catch (e) {
        onError((e as Error).message);
        end();
      }
    };
    let chain = Promise.resolve();
    const signal = (data: Signal) => {
      chain = chain
        .then(async () => {
          if (state.current?.callId !== data.callId) return;
          const pc = connection.current;
          if (!pc) return;
          if (data.description) {
            await pc.setRemoteDescription(data.description);
            for (const candidate of candidates.current) await pc.addIceCandidate(candidate);
            candidates.current = [];
            if (data.description.type === 'offer') {
              await pc.setLocalDescription(await pc.createAnswer());
              socket?.emit('call:signal', {
                callId: data.callId,
                description: pc.localDescription?.toJSON(),
              });
            }
          }
          if (data.candidate) {
            if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
            else candidates.current.push(data.candidate);
          }
        })
        .catch((e) => {
          onError(e.message);
          end();
        });
    };
    const ended = ({ callId, reason }: { callId: string; reason: string }) => {
      if (state.current?.callId === callId) {
        cleanup();
        onError(reason);
      }
    };
    const disconnected = () => {
      if (state.current) {
        cleanup();
        onError('Mất kết nối cuộc gọi.');
      }
    };
    socket?.on('call:incoming', incoming);
    socket?.emit('call:ready');
    socket?.on('call:accepted', accepted);
    socket?.on('call:signal', signal);
    socket?.on('call:ended', ended);
    socket?.on('disconnect', disconnected);
    window.addEventListener('po:call', start);
    return () => {
      mounted.current = false;
      if (state.current) socket?.emit('call:end', { callId: state.current.callId });
      cleanup();
      socket?.off('call:incoming', incoming);
      socket?.off('call:accepted', accepted);
      socket?.off('call:signal', signal);
      socket?.off('call:ended', ended);
      socket?.off('disconnect', disconnected);
      window.removeEventListener('po:call', start);
    };
    // Socket identity owns the call lifecycle; UI updates use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, onError]);
  useEffect(() => {
    if (selfVideo.current) selfVideo.current.srcObject = local.current;
    if (peerVideo.current) peerVideo.current.srcObject = remote.current;
  }, [call?.callId]);
  if (!call)
    return busy ? (
      <div role="status" className="call-preparing">
        Đang chuẩn bị micro/camera…
      </div>
    ) : null;
  return (
    <Modal title={`${call.video ? 'Gọi video' : 'Gọi thoại'} · ${call.peer.name}`} onClose={end}>
      <div className="call-panel">
        <p role="status">{call.status}</p>
        <video
          ref={peerVideo}
          autoPlay
          playsInline
          controls={false}
          className={call.video ? 'call-remote' : 'call-audio'}
        />
        <video
          ref={selfVideo}
          autoPlay
          playsInline
          muted
          className={call.video ? 'call-self' : 'call-audio'}
        />
        {call.incoming ? (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              if (working.current) return;
              working.current = true;
              setBusy(true);
              try {
                await media(call.video);
                if (state.current?.callId !== call.callId) {
                  cleanup();
                  return;
                }
                await connect();
                const result = await socket
                  ?.timeout(10000)
                  .emitWithAck('call:accept', { callId: call.callId });
                if (result?.error) throw Error(result.error);
                if (state.current)
                  update({ ...state.current, incoming: false, status: 'Đang kết nối…' });
              } catch (e) {
                onError((e as Error).message);
                end();
              } finally {
                working.current = false;
                setBusy(false);
              }
            }}
          >
            Trả lời
          </button>
        ) : (
          <>
            <button
              className="secondary"
              onClick={() => {
                local.current?.getAudioTracks().forEach((t) => (t.enabled = muted));
                setMuted(!muted);
              }}
            >
              {muted ? 'Bật micro' : 'Tắt micro'}
            </button>
            {call.video && (
              <button
                className="secondary"
                onClick={() => {
                  local.current?.getVideoTracks().forEach((t) => (t.enabled = !camera));
                  setCamera(!camera);
                }}
              >
                {camera ? 'Tắt camera' : 'Bật camera'}
              </button>
            )}
          </>
        )}
        <button className="primary danger" onClick={end}>
          {call.incoming ? 'Từ chối' : 'Kết thúc'}
        </button>
      </div>
    </Modal>
  );
}

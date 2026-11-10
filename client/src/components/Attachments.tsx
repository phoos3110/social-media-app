import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Attachment } from '../types/social';
export function AttachmentView({ attachment }: { attachment: Attachment }) {
  return attachment.kind === 'audio' ? (
    <audio className="voice-message" controls preload="metadata" src={attachment.url} />
  ) : (
    <a
      className="file-message"
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download
    >
      {attachment.name || 'Tải tệp'}
    </a>
  );
}
export function AttachmentPicker({
  disabled,
  onUploaded,
  onError,
}: {
  disabled: boolean;
  onUploaded: (a: Attachment) => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function upload(value: File, kind = 'file') {
    setBusy(true);
    try {
      if (value.size > 25 * 1024 * 1024) throw Error('Tệp tối đa 25 MB.');
      const body = new FormData();
      body.append('file', value);
      body.append('kind', kind);
      const attachment = await api<Attachment>('/attachments', 'POST', body);
      if (mounted.current) onUploaded(attachment);
    } catch (e) {
      if (mounted.current) onError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function record() {
    if (recorder.current?.state === 'recording') {
      recorder.current.stop();
      return;
    }
    setBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw Error('Trình duyệt chưa hỗ trợ ghi âm. Hãy dùng HTTPS hoặc localhost.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        const type = rec.mimeType;
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        void upload(new File(chunks, `voice-${Date.now()}.${ext}`, { type }), 'audio');
      };
      rec.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (rec.state === 'recording') rec.stop();
      }, 120000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      onError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="attachment-picker">
      <input
        hidden
        type="file"
        ref={file}
        accept=".pdf,.txt,.zip,.mp3,.wav,.webm,.ogg,.m4a"
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected) void upload(selected);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={disabled || busy || recording}
        onClick={() => file.current?.click()}
      >
        Gửi tệp
      </button>
      <button
        type="button"
        className={recording ? 'primary' : 'secondary'}
        disabled={disabled || busy}
        onClick={() => void record()}
      >
        {recording ? 'Dừng ghi âm (tối đa 2 phút)' : busy ? 'Đang tải…' : 'Ghi âm'}
      </button>
    </div>
  );
}

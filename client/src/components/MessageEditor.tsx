import { useState } from 'react';
import { api } from '../lib/api';
import type { Message } from '../types/social';
import Modal from './Modal';
export default function MessageEditor({
  message,
  onSaved,
  onClose,
  onError,
}: {
  message: Message;
  onSaved: (m: Message) => void;
  onClose: () => void;
  onError: (s: string) => void;
}) {
  const [content, setContent] = useState(message.content);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Sửa tin nhắn"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            const data = await api<{ message: Message }>(`/messages/${message.id}`, 'PATCH', {
              content,
            });
            onSaved(data.message);
            onClose();
          } catch (e) {
            onError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          aria-label="Sửa tin nhắn"
          maxLength={2000}
          value={content}
          disabled={busy}
          onChange={(e) => setContent(e.target.value)}
        />
        <button className="primary" disabled={busy || !content.trim()}>
          Lưu tin nhắn
        </button>
      </form>
    </Modal>
  );
}

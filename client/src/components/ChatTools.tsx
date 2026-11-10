import { useState } from 'react';
import { api, timeAgo } from '../lib/api';
import type { Attachment, Message, User } from '../types/social';
import { AttachmentPicker, AttachmentView } from './Attachments';
import Modal from './Modal';
export default function ChatTools({
  peer,
  onMessage,
  onError,
}: {
  peer: User;
  onMessage: (m: Message) => void;
  onError: (s: string) => void;
}) {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState('');
  async function search(next = 1) {
    setBusy(true);
    try {
      const data = await api<{ messages: Message[]; hasMore: boolean }>(
        `/messages/${peer.id}?search=${encodeURIComponent(query)}&page=${next}`,
      );
      setResults((old) => (next === 1 ? data.messages : [...data.messages, ...old]));
      setPage(next);
      setMore(data.hasMore);
      setSearched(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-tools">
      <button className="text-button" onClick={() => setSearching(true)}>
        Tìm tin nhắn
      </button>
      <AttachmentPicker disabled={busy} onUploaded={setAttachment} onError={onError} />
      <button
        className="text-button"
        onClick={() =>
          window.dispatchEvent(new CustomEvent('po:call', { detail: { peer, video: false } }))
        }
      >
        Gọi thoại
      </button>
      <button
        className="text-button"
        onClick={() =>
          window.dispatchEvent(new CustomEvent('po:call', { detail: { peer, video: true } }))
        }
      >
        Gọi video
      </button>
      {attachment && (
        <Modal
          title="Gửi tệp đính kèm"
          onClose={() => {
            if (!busy) setAttachment(null);
          }}
        >
          <AttachmentView attachment={attachment} />
          <input
            aria-label="Lời nhắn kèm tệp"
            placeholder="Lời nhắn…"
            maxLength={2000}
            value={caption}
            disabled={busy}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const data = await api<{ message: Message }>(`/messages/${peer.id}`, 'POST', {
                  content: caption,
                  attachmentId: attachment.id,
                  clientId: crypto.randomUUID(),
                });
                onMessage(data.message);
                setAttachment(null);
                setCaption('');
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Gửi
          </button>
        </Modal>
      )}
      {searching && (
        <Modal title="Tìm trong cuộc trò chuyện" onClose={() => setSearching(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input
              aria-label="Tìm nội dung tin nhắn"
              value={query}
              maxLength={100}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearched(false);
              }}
            />
            <button className="primary" disabled={busy || !query.trim()}>
              Tìm
            </button>
          </form>
          {results.map((m) => (
            <blockquote key={m.id}>
              {m.content}
              <small>{timeAgo(m.createdAt)}</small>
            </blockquote>
          ))}
          {searched && !results.length && <p>Không tìm thấy tin nhắn.</p>}
          {more && (
            <button className="secondary" disabled={busy} onClick={() => void search(page + 1)}>
              Xem trước đó
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}

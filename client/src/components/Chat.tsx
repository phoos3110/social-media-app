import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Send } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { Conversation, Message, User } from '../types/social';
import { api, timeAgo } from '../lib/api';
import { Avatar, Loading } from './ui';
import { useConfirm } from '../lib/confirmation';

function mergeMessages(incoming: Message[], previous: Message[]) {
  const byId = new Map([...incoming, ...previous].map((message) => [message.id, message]));
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export default function Chat({
  me,
  socket,
  initialPeer,
  onError,
  onRead,
}: {
  me: User;
  socket: Socket | null;
  initialPeer: User | null;
  onError: (message: string) => void;
  onRead: () => void;
}) {
  const confirm = useConfirm();
  const sendLock = useRef(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [peer, setPeer] = useState<User | null>(initialPeer);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialPeer));
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<User[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const peerRef = useRef(peer);
  useEffect(() => {
    peerRef.current = peer;
  }, [peer]);
  async function selectPeer(next: User | null) {
    if (next?.id === peer?.id || busy) return;
    if (
      draft.trim() &&
      !(await confirm({
        title: 'Bỏ tin nhắn đang soạn?',
        message: 'Tin nhắn này chưa được gửi.',
        confirmLabel: 'Bỏ bản nháp',
      }))
    )
      return;
    setDraft('');
    setMessages([]);
    setPage(1);
    setHasMore(false);
    setLoading(Boolean(next));
    setPeer(next);
  }
  const refreshConversations = useCallback(async () => {
    const data = await api<{ conversations: Conversation[] }>('/conversations');
    setConversations(data.conversations);
  }, []);
  const read = useCallback(
    async (userId: string) => {
      await api(`/messages/${userId}/read`, 'PATCH');
      onRead();
    },
    [onRead],
  );
  useEffect(() => {
    let active = true;
    api<{ conversations: Conversation[] }>('/conversations')
      .then((data) => {
        if (active) setConversations(data.conversations);
      })
      .catch((error) => {
        if (active) onError(error.message);
      });
    const onMessage = (message: Message) => {
      void refreshConversations().catch((e) => onError(e.message));
      const current = peerRef.current;
      if (current && (message.senderId === current.id || message.recipientId === current.id)) {
        setMessages((previous) =>
          previous.some((m) => m.id === message.id) ? previous : [...previous, message],
        );
        if (message.senderId === current.id) void read(current.id).catch((e) => onError(e.message));
      }
    };
    const reconnect = () => {
      void refreshConversations().catch((e) => onError(e.message));
      const current = peerRef.current;
      if (current)
        void api<{ messages: Message[]; hasMore: boolean }>(`/messages/${current.id}`)
          .then((data) => {
            if (peerRef.current?.id !== current.id) return;
            setMessages((previous) => mergeMessages(data.messages, previous));
            setHasMore(data.hasMore);
            setPage(1);
            return read(current.id);
          })
          .catch((e) => onError(e.message));
    };
    socket?.on('message:new', onMessage);
    socket?.on('connect', reconnect);
    return () => {
      active = false;
      socket?.off('message:new', onMessage);
      socket?.off('connect', reconnect);
    };
  }, [socket, read, onError, refreshConversations]);
  const peerId = peer?.id;
  useEffect(() => {
    if (!peerId) return;
    const controller = new AbortController();
    api<{ messages: Message[]; hasMore: boolean }>(
      `/messages/${peerId}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then(async (data) => {
        if (controller.signal.aborted) return;
        setMessages((previous) => mergeMessages(data.messages, previous));
        setHasMore(data.hasMore);
        await read(peerId);
        await refreshConversations();
      })
      .catch((e) => {
        if (e.name !== 'AbortError') onError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [peerId, read, onError, refreshConversations]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        api<{ users: User[] }>(
          `/users?search=${encodeURIComponent(search)}`,
          'GET',
          undefined,
          controller.signal,
        )
          .then((data) => setPeople(data.users))
          .catch((e) => {
            if (e.name !== 'AbortError') onError(e.message);
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, onError]);
  const choices = search ? people : conversations.map((c) => c.user);
  return (
    <section className={`card chat-layout ${peer ? 'has-peer' : ''}`}>
      <aside className="chat-list">
        <h2>
          Tin nhắn <MessageCircle size={20} />
        </h2>
        <input
          type="search"
          placeholder="Tìm người để trò chuyện…"
          aria-label="Tìm người nhắn tin"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {choices.map((user) => {
          const conversation = conversations.find((c) => c.user.id === user.id);
          return (
            <button
              key={user.id}
              className={`conversation ${peer?.id === user.id ? 'selected' : ''}`}
              disabled={busy}
              onClick={() => void selectPeer(user)}
            >
              <Avatar user={user} />
              <span className="conversation-content">
                <strong>{user.name}</strong>
                <small>{conversation?.lastMessage || `@${user.username}`}</small>
              </span>
              {!!conversation?.unread && <b className="badge">{conversation.unread}</b>}
            </button>
          );
        })}
        {!choices.length && (
          <p className="chat-hint">
            {search
              ? 'Không tìm thấy người dùng.'
              : 'Chưa có cuộc trò chuyện. Tìm tên người dùng ở trên để bắt đầu.'}
          </p>
        )}
      </aside>
      <div className="chat-main">
        {peer ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button chat-back"
                aria-label="Quay lại danh sách"
                disabled={busy}
                onClick={() => void selectPeer(null)}
              >
                <ArrowLeft size={20} />
              </button>
              <Avatar user={peer} size="sm" />
              <span>
                <strong>{peer.name}</strong>
                <small>@{peer.username}</small>
              </span>
            </header>
            <div className="message-list" aria-live="polite">
              {hasMore && (
                <button
                  className="text-button"
                  disabled={loading}
                  onClick={async () => {
                    const currentId = peer.id;
                    setLoading(true);
                    try {
                      const data = await api<{ messages: Message[]; hasMore: boolean }>(
                        `/messages/${currentId}?page=${page + 1}`,
                      );
                      if (peerRef.current?.id !== currentId) return;
                      setMessages((previous) => [
                        ...data.messages,
                        ...previous.filter((m) => !data.messages.some((x) => x.id === m.id)),
                      ]);
                      setHasMore(data.hasMore);
                      setPage(page + 1);
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      if (peerRef.current?.id === currentId) setLoading(false);
                    }
                  }}
                >
                  Xem tin nhắn trước
                </button>
              )}
              {loading && <Loading />}
              {!loading && !messages.length && (
                <div className="chat-greeting">
                  <Avatar user={peer} size="lg" />
                  <h3>Bắt đầu bằng một lời chào</h3>
                  <p>Đây là cuộc trò chuyện giữa bạn và {peer.name}.</p>
                </div>
              )}
              {messages.map((message) => (
                <div
                  className={`message ${message.senderId === me.id ? 'outgoing' : 'incoming'}`}
                  key={message.id}
                >
                  <p>{message.content}</p>
                  <small>{timeAgo(message.createdAt)}</small>
                </div>
              ))}
              <div ref={end} />
            </div>
            <form
              className="message-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!draft.trim() || busy || sendLock.current) return;
                sendLock.current = true;
                setBusy(true);
                const target = peer.id;
                const content = draft;
                try {
                  const data = await api<{ message: Message }>(`/messages/${target}`, 'POST', {
                    content,
                  });
                  if (peerRef.current?.id === target) {
                    setMessages((previous) =>
                      previous.some((m) => m.id === data.message.id)
                        ? previous
                        : [...previous, data.message],
                    );
                    setDraft('');
                  }
                  await refreshConversations();
                } catch (error) {
                  onError((error as Error).message);
                } finally {
                  sendLock.current = false;
                  setBusy(false);
                }
              }}
            >
              <input
                disabled={busy || loading}
                aria-label="Nội dung tin nhắn"
                placeholder="Nhắn một điều gì đó…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
              />
              <button
                className="primary"
                aria-label="Gửi tin nhắn"
                disabled={busy || loading || !draft.trim()}
              >
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div className="chat-greeting">
            <span className="empty-icon">
              <MessageCircle size={30} />
            </span>
            <h3>Một lời chào, một kết nối mới</h3>
            <p>Chọn cuộc trò chuyện hoặc tìm một người bạn.</p>
          </div>
        )}
      </div>
    </section>
  );
}

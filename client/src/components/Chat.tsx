import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Send, ImagePlus, Reply, X, Undo2 } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import type { Conversation, Message, User } from '../types/social';
import { api, timeAgo, uploadImage } from '../lib/api';
import { useDraft } from '../lib/drafts';
import { usePresence } from '../lib/usePresence';
import { Avatar, Loading } from './ui';
import { useConfirm } from '../lib/confirmation';
import ChatTools from './ChatTools';
import MessageEditor from './MessageEditor';
import { AttachmentView } from './Attachments';
import GroupChat from './GroupChat';

function mergeMessages(incoming: Message[], previous: Message[]) {
  const byId = new Map([...previous, ...incoming].map((message) => [message.id, message]));
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
  const draftKey = `po:draft:${me.id}:chat:${peer?.id || 'inbox'}`;
  const [draft, setDraft] = useDraft(draftKey);
  const [assetJson, setAssetJson] = useDraft(draftKey + ':image');
  const [replyJson, setReplyJson] = useDraft(draftKey + ':reply');
  let asset: { id: string; url: string } | null = null,
    reply: Message | null = null;
  try {
    const value = JSON.parse(assetJson);
    if (value && typeof value.id === 'string' && typeof value.url === 'string') asset = value;
  } catch {}
  try {
    const value = JSON.parse(replyJson);
    if (value && typeof value.id === 'string' && typeof value.content === 'string') reply = value;
  } catch {}
  const online = usePresence(peer ? [peer.id] : [], socket);
  const [typing, setTyping] = useState(false),
    [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialPeer));
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [groupMode, setGroupMode] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [people, setPeople] = useState<User[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const peerRef = useRef(peer);
  useEffect(() => {
    peerRef.current = peer;
  }, [peer]);
  async function selectPeer(next: User | null) {
    if (next?.id === peer?.id || busy) return;
    if (
      (draft.trim() || asset || reply) &&
      !(await confirm({
        title: 'Bỏ tin nhắn đang soạn?',
        message: 'Tin nhắn này chưa được gửi.',
        confirmLabel: 'Bỏ bản nháp',
      }))
    )
      return;
    setDraft('');
    setAssetJson('');
    setReplyJson('');
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
        setMessages((previous) => {
          const withoutPending = previous.filter(
            (m) =>
              !(
                m.id.startsWith('pending-') &&
                m.senderId === message.senderId &&
                m.recipientId === message.recipientId &&
                m.content === message.content &&
                (m.image || '') === (message.image || '')
              ),
          );
          return withoutPending.some((m) => m.id === message.id)
            ? withoutPending
            : [...withoutPending, message];
        });
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
    const onEdited = (message: Message) =>
      setMessages((old) =>
        old.map((m) =>
          m.id === message.id
            ? message
            : m.replyTo?.id === message.id
              ? { ...m, replyTo: { ...m.replyTo, content: message.content } }
              : m,
        ),
      );
    socket?.on('message:edited', onEdited);
    socket?.on('message:new', onMessage);
    const onReadMessage = ({ readerId, readAt }: { readerId: string; readAt: string }) =>
      setMessages((old) =>
        old.map((m) =>
          m.recipientId === readerId &&
          m.senderId === me.id &&
          !m.id.startsWith('pending-') &&
          m.createdAt <= readAt
            ? { ...m, readAt }
            : m,
        ),
      );
    const onRecall = (message: Message) => {
      setReplyJson((old) => {
        try {
          if (JSON.parse(old)?.id === message.id) return '';
        } catch {}
        return old;
      });
      setMessages((old) =>
        old.map((m) =>
          m.id === message.id
            ? message
            : m.replyTo?.id === message.id
              ? {
                  ...m,
                  replyTo: {
                    ...m.replyTo,
                    content: '',
                    image: '',
                    recalledAt: message.recalledAt || new Date().toISOString(),
                  },
                }
              : m,
        ),
      );
    };
    socket?.on('message:read', onReadMessage);
    socket?.on('message:recalled', onRecall);
    socket?.on('connect', reconnect);
    return () => {
      active = false;
      socket?.off('message:new', onMessage);
      socket?.off('message:edited', onEdited);
      socket?.off('message:read', onReadMessage);
      socket?.off('message:recalled', onRecall);
      socket?.off('connect', reconnect);
    };
  }, [socket, read, onError, refreshConversations, me.id, setReplyJson]);
  const peerId = peer?.id;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const change = ({ userId, typing: active }: { userId: string; typing: boolean }) => {
      if (userId !== peerId) return;
      setTyping(active);
      clearTimeout(timer);
      if (active) timer = setTimeout(() => setTyping(false), 3000);
    };
    socket?.on('typing', change);
    return () => {
      clearTimeout(timer);
      socket?.off('typing', change);
    };
  }, [peerId, socket]);
  useEffect(() => {
    if (!peerId) return;
    const timer = setTimeout(
      () => socket?.emit('typing', { recipientId: peerId, typing: Boolean(draft.trim()) }),
      400,
    );
    return () => clearTimeout(timer);
  }, [draft, peerId, socket]);
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
  if (groupMode)
    return (
      <>
        <button className="secondary" onClick={() => setGroupMode(false)}>
          Quay lại chat cá nhân
        </button>
        <GroupChat me={me} socket={socket} onError={onError} />
      </>
    );
  return (
    <section className={`card chat-layout ${peer ? 'has-peer' : ''}`}>
      <aside className="chat-list">
        <button className="secondary" onClick={() => setGroupMode(true)}>
          Chat nhóm
        </button>
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
                <small>
                  @{peer.username} · {online.includes(peer.id) ? 'Đang hoạt động' : 'Ngoại tuyến'}
                </small>
              </span>
            </header>
            <ChatTools
              key={peer.id}
              peer={peer}
              onError={onError}
              onMessage={(message) => {
                setMessages((old) => mergeMessages([message], old));
                void refreshConversations().catch((e) => onError(e.message));
              }}
            />
            {editingMessage && (
              <MessageEditor
                message={editingMessage}
                onError={onError}
                onClose={() => setEditingMessage(null)}
                onSaved={(message) => setMessages((old) => mergeMessages([message], old))}
              />
            )}
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
                  {message.replyTo && (
                    <blockquote className="message-quote">
                      {message.replyTo.recalledAt
                        ? 'Tin nhắn đã thu hồi'
                        : message.replyTo.content || 'Ảnh'}
                    </blockquote>
                  )}
                  {message.recalledAt ? (
                    <p className="recalled-message">Tin nhắn đã được thu hồi</p>
                  ) : (
                    <>
                      {message.content && <p>{message.content}</p>}
                      {message.attachment && <AttachmentView attachment={message.attachment} />}
                      {message.editedAt && <small>Đã chỉnh sửa</small>}
                      {message.image && (
                        <a href={message.image} target="_blank" rel="noreferrer">
                          <img
                            className="chat-image"
                            src={message.image}
                            alt="Ảnh trong cuộc trò chuyện"
                            loading="lazy"
                          />
                        </a>
                      )}
                    </>
                  )}
                  <small>
                    {message.id.startsWith('pending-')
                      ? 'Đang gửi…'
                      : `${timeAgo(message.createdAt)}${message.senderId === me.id && message.readAt ? ' · Đã xem' : ''}`}
                  </small>
                  {!message.recalledAt && !message.id.startsWith('pending-') && (
                    <div className="message-tools">
                      <button
                        className="icon-button"
                        aria-label="Trả lời tin nhắn"
                        onClick={() => setReplyJson(JSON.stringify(message))}
                      >
                        <Reply size={15} />
                      </button>
                      {message.senderId === me.id && (
                        <button
                          className="icon-button"
                          aria-label="Sửa tin nhắn"
                          onClick={() => setEditingMessage(message)}
                        >
                          Sửa
                        </button>
                      )}
                      {message.senderId === me.id && (
                        <button
                          className="icon-button"
                          aria-label="Thu hồi tin nhắn"
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: 'Thu hồi tin nhắn?',
                                message: 'Nội dung sẽ bị gỡ với cả hai người.',
                                confirmLabel: 'Thu hồi',
                              }))
                            )
                              return;
                            try {
                              const data = await api<{ message: Message }>(
                                `/messages/${message.id}`,
                                'DELETE',
                              );
                              setMessages((old) =>
                                old.map((m) =>
                                  m.id === message.id
                                    ? data.message
                                    : m.replyTo?.id === message.id
                                      ? {
                                          ...m,
                                          replyTo: {
                                            ...m.replyTo,
                                            content: '',
                                            image: '',
                                            recalledAt:
                                              data.message.recalledAt || new Date().toISOString(),
                                          },
                                        }
                                      : m,
                                ),
                              );
                            } catch (e) {
                              onError((e as Error).message);
                            }
                          }}
                        >
                          <Undo2 size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={end} />
              {typing && <p className="typing-indicator">{peer.name} đang nhập…</p>}
            </div>
            {(asset || reply) && (
              <div className="message-compose-preview">
                {reply && (
                  <div>
                    <strong>Trả lời {reply.senderId === me.id ? 'chính bạn' : peer.name}</strong>
                    <p>{reply.content || 'Ảnh'}</p>
                    <button
                      className="icon-button"
                      aria-label="Hủy trả lời tin nhắn"
                      onClick={() => setReplyJson('')}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {asset && (
                  <div>
                    <img src={asset.url} alt="Ảnh chuẩn bị gửi" />
                    <button
                      className="icon-button"
                      aria-label="Bỏ ảnh tin nhắn"
                      onClick={() => setAssetJson('')}
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
              </div>
            )}
            <form
              className="message-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if ((!draft.trim() && !asset) || busy || uploading || sendLock.current) return;
                sendLock.current = true;
                setBusy(true);
                const target = peer.id;
                const content = draft;
                const clientId = crypto.randomUUID();
                const tempId = `pending-${clientId}`;
                const sentAsset = asset,
                  sentReply = reply;
                setMessages((previous) => [
                  ...previous,
                  {
                    id: tempId,
                    senderId: me.id,
                    recipientId: target,
                    content,
                    createdAt: new Date().toISOString(),
                    readAt: null,
                    image: sentAsset?.url,
                    replyToId: sentReply?.id,
                    replyTo: sentReply
                      ? {
                          id: sentReply.id,
                          senderId: sentReply.senderId,
                          content: sentReply.content,
                          image: sentReply.image || '',
                          recalledAt: sentReply.recalledAt || null,
                        }
                      : null,
                  },
                ]);
                setDraft('');
                setAssetJson('');
                setReplyJson('');
                socket?.emit('typing', { recipientId: target, typing: false });
                try {
                  const data = await api<{ message: Message }>(`/messages/${target}`, 'POST', {
                    content,
                    uploadId: sentAsset?.id,
                    replyToId: sentReply?.id,
                    clientId,
                  });
                  if (peerRef.current?.id === target) {
                    setMessages((previous) => {
                      const confirmed = previous.filter((m) => m.id !== tempId);
                      return confirmed.some((m) => m.id === data.message.id)
                        ? confirmed
                        : [...confirmed, data.message];
                    });
                  }
                  void refreshConversations().catch((error) => onError(error.message));
                } catch (error) {
                  setMessages((previous) => previous.filter((m) => m.id !== tempId));
                  setDraft((previous) => previous || content);
                  if (sentAsset) setAssetJson((old) => old || JSON.stringify(sentAsset));
                  if (sentReply) setReplyJson((old) => old || JSON.stringify(sentReply));
                  onError((error as Error).message);
                } finally {
                  sendLock.current = false;
                  setBusy(false);
                }
              }}
            >
              <input
                ref={fileInput}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={busy || uploading || loading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  try {
                    setAssetJson(JSON.stringify(await uploadImage(file)));
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    setUploading(false);
                    e.target.value = '';
                  }
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Gửi ảnh"
                disabled={busy || uploading || loading}
                onClick={() => fileInput.current?.click()}
              >
                <ImagePlus size={20} />
              </button>
              <input
                disabled={loading}
                aria-label="Nội dung tin nhắn"
                placeholder="Nhắn một điều gì đó…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
              />
              <button
                className="primary"
                aria-label="Gửi tin nhắn"
                disabled={busy || loading || uploading || (!draft.trim() && !asset)}
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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api, timeAgo } from '../lib/api';
import type { Attachment, User } from '../types/social';
import { useConfirm } from '../lib/confirmation';
import { AttachmentPicker, AttachmentView } from './Attachments';
import Modal from './Modal';
type Group = { id: string; name: string; owner_id: string; members: number; unread: number };
type GroupMessage = {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: string;
  recalledAt: string | null;
  attachment: Attachment | null;
  author?: User;
};
export default function GroupChat({
  me,
  socket,
  onError,
}: {
  me: User;
  socket: Socket | null;
  onError: (s: string) => void;
}) {
  const confirm = useConfirm();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);
  const current = useRef(selected);
  useEffect(() => {
    current.current = selected;
  }, [selected]);
  function selectGroup(id: string) {
    if (current.current === id) return;
    current.current = id;
    setSelected(id);
    setLoading(true);
    setMessages([]);
    setMembers([]);
    setMore(false);
    setAttachment(null);
    setDraft('');
    setPage(1);
  }
  const group = groups.find((g) => g.id === selected);
  const refresh = useCallback(async () => {
    const data = await api<{ groups: Group[] }>('/groups');
    setGroups(data.groups);
    if (current.current && !data.groups.some((g) => g.id === current.current)) {
      setSelected(null);
      setMessages([]);
    }
  }, []);
  useEffect(() => {
    void api<{ groups: Group[] }>('/groups')
      .then((data) => setGroups(data.groups))
      .catch((e) => onError(e.message));
    const change = () => {
      void refresh().catch((e) => onError(e.message));
      const target = current.current;
      if (target)
        void api<{ users: User[] }>(`/groups/${target}/members`)
          .then((data) => {
            if (current.current === target) setMembers(data.users);
          })
          .catch(() => {});
    };
    const reconnect = () => {
      change();
      const target = current.current;
      if (target)
        void api<{ messages: GroupMessage[]; hasMore: boolean }>(`/groups/${target}/messages`)
          .then((data) => {
            if (current.current !== target) return;
            setMessages((old) =>
              [
                ...old.filter((m) => !data.messages.some((x) => x.id === m.id)),
                ...data.messages,
              ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
            );
          })
          .catch((e) => onError(e.message));
    };
    const message = (m: GroupMessage) => {
      change();
      if (current.current === m.groupId) {
        setMessages((old) =>
          old.some((x) => x.id === m.id) ? old.map((x) => (x.id === m.id ? m : x)) : [...old, m],
        );
        void api(`/groups/${m.groupId}/read`, 'PATCH').catch(() => {});
      }
    };
    const recall = (m: GroupMessage) =>
      setMessages((old) => old.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
    socket?.on('group:changed', change);
    socket?.on('group:message', message);
    socket?.on('group:recalled', recall);
    socket?.on('connect', reconnect);
    return () => {
      socket?.off('group:changed', change);
      socket?.off('group:message', message);
      socket?.off('group:recalled', recall);
      socket?.off('connect', reconnect);
    };
  }, [socket, refresh, onError]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    Promise.all([
      api<{ messages: GroupMessage[]; hasMore: boolean }>(
        `/groups/${selected}/messages`,
        'GET',
        undefined,
        controller.signal,
      ),
      api<{ users: User[] }>(`/groups/${selected}/members`, 'GET', undefined, controller.signal),
    ])
      .then(([data, users]) => {
        if (controller.signal.aborted) return;
        setMessages((old) => [
          ...data.messages,
          ...old.filter((m) => !data.messages.some((x) => x.id === m.id)),
        ]);
        setMore(data.hasMore);
        setMembers(users.users);
        return api(`/groups/${selected}/read`, 'PATCH');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') onError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, onError]);
  useEffect(() => {
    if (!creating && !managing) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ users: User[] }>(
        `/users?search=${encodeURIComponent(query)}`,
        'GET',
        undefined,
        controller.signal,
      )
        .then((data) => setPeople(data.users))
        .catch((e) => {
          if (e.name !== 'AbortError') onError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, creating, managing, onError]);
  return (
    <section className="card group-chat">
      <div className="hub-tabs">
        <h2>Chat nhóm</h2>
        <button
          className="primary"
          onClick={() => {
            setCreating(true);
            setIds([]);
            setName('');
          }}
        >
          Tạo nhóm
        </button>
      </div>
      <div className="group-choices">
        {groups.map((g) => (
          <button
            className={g.id === selected ? 'primary' : 'secondary'}
            disabled={busy}
            key={g.id}
            onClick={() => selectGroup(g.id)}
          >
            {g.name} · {g.members}
            {g.unread > 0 ? ` (${g.unread} mới)` : ''}
          </button>
        ))}
      </div>
      {!groups.length && <p>Bạn chưa tham gia nhóm nào.</p>}
      {group && (
        <>
          <header className="hub-tabs">
            <h3>{group.name}</h3>
            <button className="secondary" onClick={() => setManaging(true)}>
              Thành viên
            </button>
          </header>
          <div className="group-message-list">
            {more && (
              <button
                className="secondary"
                disabled={loading}
                onClick={async () => {
                  const target = group.id;
                  setLoading(true);
                  try {
                    const data = await api<{ messages: GroupMessage[]; hasMore: boolean }>(
                      `/groups/${target}/messages?page=${page + 1}`,
                    );
                    if (current.current !== target) return;
                    setMessages((old) => [
                      ...data.messages,
                      ...old.filter((m) => !data.messages.some((x) => x.id === m.id)),
                    ]);
                    setMore(data.hasMore);
                    setPage(page + 1);
                  } catch (e) {
                    onError((e as Error).message);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Tin nhắn trước
              </button>
            )}
            {messages.map((m) => (
              <div
                className={`group-message ${m.senderId === me.id ? 'own-message' : ''}`}
                key={m.id}
              >
                <strong>
                  {m.author?.name || members.find((u) => u.id === m.senderId)?.name || 'Thành viên'}
                </strong>
                {m.recalledAt ? (
                  <p>Tin nhắn đã thu hồi</p>
                ) : (
                  <>
                    <p>{m.content}</p>
                    {m.attachment && <AttachmentView attachment={m.attachment} />}
                  </>
                )}
                <small>{timeAgo(m.createdAt)}</small>
                {m.senderId === me.id && !m.recalledAt && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Thu hồi tin nhắn?',
                          message: 'Tin nhắn sẽ bị gỡ khỏi nhóm.',
                          confirmLabel: 'Thu hồi',
                        }))
                      )
                        return;
                      setBusy(true);
                      try {
                        const data = await api<{ message: GroupMessage }>(
                          `/groups/${group.id}/messages/${m.id}`,
                          'DELETE',
                        );
                        setMessages((old) =>
                          old.map((x) => (x.id === m.id ? { ...x, ...data.message } : x)),
                        );
                      } catch (e) {
                        onError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Thu hồi
                  </button>
                )}
              </div>
            ))}
            {loading && <p role="status">Đang tải…</p>}
          </div>
          {attachment && (
            <div className="attachment-preview">
              <AttachmentView attachment={attachment} />
              <button className="text-button" onClick={() => setAttachment(null)}>
                Bỏ tệp
              </button>
            </div>
          )}
          <AttachmentPicker
            key={group.id}
            disabled={busy}
            onUploaded={setAttachment}
            onError={onError}
          />
          <form
            className="group-message-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current || (!draft.trim() && !attachment)) return;
              lock.current = true;
              setBusy(true);
              const target = group.id;
              try {
                const data = await api<{ message: GroupMessage }>(
                  `/groups/${target}/messages`,
                  'POST',
                  { content: draft, attachmentId: attachment?.id },
                );
                if (current.current === target) {
                  setMessages((old) =>
                    old.some((m) => m.id === data.message.id) ? old : [...old, data.message],
                  );
                  setDraft('');
                  setAttachment(null);
                }
              } catch (e) {
                onError((e as Error).message);
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            <input
              aria-label="Tin nhắn nhóm"
              value={draft}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Nhắn vào nhóm…"
            />
            <button className="primary" disabled={busy || (!draft.trim() && !attachment)}>
              Gửi vào nhóm
            </button>
          </form>
        </>
      )}
      {creating && (
        <Modal
          title="Tạo nhóm chat"
          onClose={() => {
            if (!busy) setCreating(false);
          }}
        >
          <input
            aria-label="Tên nhóm"
            placeholder="Tên nhóm"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            aria-label="Tìm thành viên"
            placeholder="Tìm người…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p>Đã chọn {ids.length} người</p>
          {people.map((u) => (
            <label className="setting-row" key={u.id}>
              {u.name}
              <input
                type="checkbox"
                checked={ids.includes(u.id)}
                onChange={(e) =>
                  setIds((old) =>
                    e.target.checked ? [...old, u.id] : old.filter((id) => id !== u.id),
                  )
                }
              />
            </label>
          ))}
          <button
            className="primary"
            disabled={busy || !name.trim() || !ids.length || ids.length > 49}
            onClick={async () => {
              setBusy(true);
              try {
                const data = await api<{ id: string }>('/groups', 'POST', { name, userIds: ids });
                setCreating(false);
                await refresh();
                selectGroup(data.id);
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Tạo nhóm
          </button>
        </Modal>
      )}
      {managing && group && (
        <Modal title="Thành viên nhóm" onClose={() => setManaging(false)}>
          {members.map((u) => (
            <div className="setting-row" key={u.id}>
              <span>
                {u.name}
                {u.id === group.owner_id ? ' · Trưởng nhóm' : ''}
              </span>
              {group.owner_id === me.id && u.id !== me.id && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: 'Xóa thành viên?',
                        message: `Gỡ ${u.name} khỏi nhóm.`,
                        confirmLabel: 'Xóa thành viên',
                      }))
                    )
                      return;
                    setBusy(true);
                    try {
                      await api(`/groups/${group.id}/members/${u.id}`, 'DELETE');
                      setMembers((old) => old.filter((m) => m.id !== u.id));
                      await refresh();
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Xóa
                </button>
              )}
            </div>
          ))}
          {group.owner_id === me.id && (
            <>
              <input
                aria-label="Tìm người thêm vào nhóm"
                value={query}
                placeholder="Tìm người thêm vào nhóm…"
                onChange={(e) => setQuery(e.target.value)}
              />
              {people
                .filter((u) => !members.some((m) => m.id === u.id))
                .map((u) => (
                  <button
                    className="secondary"
                    disabled={busy}
                    key={u.id}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/groups/${group.id}/members/${u.id}`, 'PUT');
                        setMembers((old) => [...old, u]);
                        await refresh();
                      } catch (e) {
                        onError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Thêm {u.name}
                  </button>
                ))}
            </>
          )}
          <button
            className="secondary danger"
            disabled={busy}
            onClick={async () => {
              if (
                !(await confirm({
                  title: group.owner_id === me.id ? 'Giải tán nhóm?' : 'Rời nhóm?',
                  message:
                    group.owner_id === me.id
                      ? 'Nhóm và lịch sử tin nhắn sẽ bị xóa.'
                      : 'Bạn sẽ không còn đọc được tin nhắn trong nhóm.',
                  confirmLabel: group.owner_id === me.id ? 'Giải tán' : 'Rời nhóm',
                  danger: true,
                }))
              )
                return;
              setBusy(true);
              try {
                await api(`/groups/${group.id}/members/${me.id}`, 'DELETE');
                setManaging(false);
                setSelected(null);
                await refresh();
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {group.owner_id === me.id ? 'Giải tán nhóm' : 'Rời nhóm'}
          </button>
        </Modal>
      )}
    </section>
  );
}

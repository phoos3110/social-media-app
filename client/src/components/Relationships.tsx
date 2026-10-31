import { useEffect, useState } from 'react';
import type { User } from '../types/social';
import { api } from '../lib/api';
import { Avatar, Loading } from './ui';
import Modal from './Modal';

export default function Relationships({
  userId,
  kind,
  onClose,
  onProfile,
}: {
  userId: string;
  kind: 'followers' | 'following';
  onClose: () => void;
  onProfile: (id: string) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<{ users: User[]; hasMore: boolean }>(
      `/users/${userId}/${kind}?page=${page}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        setUsers((previous) =>
          page === 1
            ? data.users
            : [...previous, ...data.users.filter((u) => !previous.some((p) => p.id === u.id))],
        );
        setMore(data.hasMore);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, kind, page, retry]);
  return (
    <Modal title={kind === 'followers' ? 'Người theo dõi' : 'Đang theo dõi'} onClose={onClose}>
      <div className="relationship-list">
        {users.map((user) => (
          <button
            className="relationship-user user-link"
            key={user.id}
            onClick={() => {
              onClose();
              onProfile(user.id);
            }}
          >
            <Avatar user={user} />
            <span>
              <strong>{user.name}</strong>
              <small>@{user.username}</small>
            </span>
          </button>
        ))}
      </div>
      {loading && <Loading />}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => {
              setError('');
              setLoading(true);
              setRetry((n) => n + 1);
            }}
          >
            Thử lại
          </button>
        </div>
      )}
      {!loading && !error && !users.length && (
        <p className="dialog-empty">Chưa có người dùng trong danh sách này.</p>
      )}
      {more && !error && (
        <button
          className="secondary load-more"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setPage((n) => n + 1);
          }}
        >
          Xem thêm
        </button>
      )}
    </Modal>
  );
}

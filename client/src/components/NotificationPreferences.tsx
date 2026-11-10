import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SocialPost } from '../types/social';
const labels = {
  like: 'Lượt thích và cảm xúc',
  comment: 'Bình luận',
  reply: 'Trả lời',
  follow: 'Theo dõi mới',
  request: 'Yêu cầu theo dõi',
  mention: 'Nhắc tên',
  message: 'Tin nhắn',
};
export default function NotificationPreferences() {
  const [preferences, setPreferences] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<SocialPost[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ preferences: Record<string, boolean> }>(
      '/account/notifications',
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => setPreferences(data.preferences))
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <details className="notification-preferences">
      <summary>Thông báo và bài viết đã ẩn</summary>
      {preferences && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setStatus('');
            try {
              await api(
                '/account/notifications',
                'PUT',
                Object.fromEntries(
                  Object.keys(labels).map((key) => [key, preferences[key] !== false]),
                ),
              );
              setStatus('Đã lưu cài đặt thông báo.');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {Object.entries(labels).map(([key, label]) => (
            <label className="setting-row" key={key}>
              {label}
              <input
                type="checkbox"
                checked={preferences[key] !== false}
                disabled={busy}
                onChange={(e) => setPreferences({ ...preferences, [key]: e.target.checked })}
              />
            </label>
          ))}
          <button className="primary" disabled={busy}>
            Lưu thông báo
          </button>
        </form>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const data = await api<{ posts: SocialPost[] }>('/account/hidden-posts');
            setHidden(data.posts);
            setStatus(data.posts.length ? '' : 'Không có bài viết đã ẩn.');
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Xem bài viết đã ẩn
      </button>
      {hidden.map((post) => (
        <div className="setting-row" key={post.id}>
          <span>
            {post.author.name}: {post.content.slice(0, 80) || post.songTitle || 'Ảnh / video'}
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/posts/${post.id}/preferences`, 'PUT', { hidden: false });
                setHidden((old) => old.filter((p) => p.id !== post.id));
                window.dispatchEvent(new Event('po:feed-refresh'));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Hiện lại
          </button>
        </div>
      ))}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </details>
  );
}

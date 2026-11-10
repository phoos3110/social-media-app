import { useEffect, useState } from 'react';
import { Bookmark, Flag, Share2 } from 'lucide-react';
import { api } from '../lib/api';
import type { SocialPost, User } from '../types/social';
import { Avatar, Loading } from './ui';
import Modal from './Modal';
import RichText from './RichText';
import YouTubeSong from './YouTubeSong';
export function PostMedia({ post }: { post: SocialPost }) {
  const media = post.media?.length
    ? post.media
    : post.image
      ? [{ url: post.image, kind: 'image' }]
      : [];
  return (
    <>
      {post.youtubeId && (
        <div className="song-card">
          {post.songTitle && <strong>{post.songTitle}</strong>}
          {post.songArtist && <small>{post.songArtist}</small>}
          <YouTubeSong id={post.youtubeId} />
        </div>
      )}
      {media.length ? (
        <div className={`post-media-grid media-count-${Math.min(media.length, 4)}`}>
          {media.map((m, i) =>
            m.kind === 'video' ? (
              <video
                className="post-video"
                key={m.url + i}
                src={m.url}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <a
                className="post-image-link"
                href={m.url}
                target="_blank"
                rel="noreferrer"
                key={m.url + i}
              >
                <img
                  className="post-image"
                  src={m.url}
                  loading="lazy"
                  alt={`Ảnh ${i + 1} trong bài của ${post.author.name}`}
                />
              </a>
            ),
          )}
        </div>
      ) : null}
    </>
  );
}
export function SharedPreview({ postId }: { postId: string }) {
  const [post, setPost] = useState<SocialPost | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{ post: SocialPost }>(`/posts/${postId}`, 'GET', undefined, controller.signal)
      .then((data) => setPost(data.post))
      .catch((e) => {
        if (e.name !== 'AbortError') setError('Bài viết gốc không còn khả dụng.');
      });
    return () => controller.abort();
  }, [postId]);
  return (
    <div className="shared-post">
      {error ? (
        <p>{error}</p>
      ) : post ? (
        <>
          <button
            className="user-link"
            onClick={() => {
              location.hash = `post=${postId}`;
            }}
          >
            <Avatar user={post.author} size="sm" />
            <span>
              <strong>{post.author.name}</strong>
              <small>Xem bài viết gốc</small>
            </span>
          </button>
          <p>
            <RichText text={post.content} />
          </p>
          <PostMedia post={post} />
        </>
      ) : (
        <Loading />
      )}
    </div>
  );
}
export function ReportButton({ postId, userId }: { postId?: string; userId?: string }) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  return (
    <>
      <button
        className="icon-button"
        aria-label={postId ? 'Báo cáo bài viết' : 'Báo cáo người dùng'}
        title="Báo cáo"
        onClick={() => {
          setError('');
          setDone(false);
          setOpen(true);
        }}
      >
        <Flag size={17} />
      </button>
      {open && (
        <Modal
          title="Báo cáo nội dung"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          {done ? (
            <p role="status">Đã gửi báo cáo cho quản trị viên.</p>
          ) : (
            <form
              className="account-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError('');
                try {
                  await api('/reports', 'POST', { postId, userId, reason });
                  setDone(true);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Lý do báo cáo
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </label>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy || reason.trim().length < 5}>
                Gửi báo cáo
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
export function SaveButton({
  post,
  onSaved,
  onError,
}: {
  post: SocialPost;
  onSaved: (saved: boolean) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`icon-button ${post.isSaved ? 'saved' : ''}`}
      aria-label={post.isSaved ? 'Bỏ lưu bài viết' : 'Lưu bài viết'}
      title={post.isSaved ? 'Bỏ lưu' : 'Lưu bài viết'}
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        const saved = !post.isSaved;
        setBusy(true);
        onSaved(saved);
        try {
          await api(`/posts/${post.id}/save`, 'PUT', { saved });
        } catch (e) {
          onSaved(!saved);
          onError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Bookmark size={18} fill={post.isSaved ? 'currentColor' : 'none'} />
    </button>
  );
}
export function SharePost({ post }: { post: SocialPost }) {
  const [open, setOpen] = useState(false),
    [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <button onClick={() => setOpen(true)}>
        <Share2 size={19} />
        Chia sẻ
      </button>
      {open && (
        <Modal
          title="Chia sẻ bài viết"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            className="account-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                await api('/posts', 'POST', {
                  content,
                  sharedPostId: post.sharedPostId || post.id,
                });
                setOpen(false);
                setContent('');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <textarea
              aria-label="Nội dung chia sẻ"
              placeholder="Viết thêm điều gì đó…"
              maxLength={5000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <p className="muted">Bài viết gốc chỉ hiển thị với người có quyền xem.</p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Chia sẻ ngay
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                const url = `${location.origin}/#post=${post.id}`;
                try {
                  await navigator.clipboard.writeText(url);
                  setError('Đã sao chép liên kết.');
                } catch {
                  setError(url);
                }
              }}
            >
              Sao chép liên kết
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function PostLikers({
  postId,
  onProfile,
  onClose,
}: {
  postId: string;
  onProfile: (id: string) => void;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [page, setPage] = useState(1),
    [more, setMore] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<{ users: User[]; hasMore: boolean }>(
      `/posts/${postId}/likes?page=${page}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        setUsers((old) => (page === 1 ? data.users : [...old, ...data.users]));
        setMore(data.hasMore);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [postId, page]);
  return (
    <Modal title="Người đã thích" onClose={onClose}>
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
      {error && <p role="alert">{error}</p>}
      {!loading && !users.length && !error && <p>Chưa có lượt thích.</p>}
      {more && (
        <button
          className="secondary"
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

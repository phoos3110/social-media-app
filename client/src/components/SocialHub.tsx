import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SocialPost, User } from '../types/social';
import FeedPost from './FeedPost';

export default function SocialHub({
  me,
  onProfile,
  onError,
}: {
  me: User;
  onProfile: (id: string) => void;
  onError: (s: string) => void;
}) {
  const [tab, setTab] = useState<'story' | 'reel' | null>(null);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [version, setVersion] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const key = `${tab}:${version}`;
  const loading = busy || Boolean(tab && loadedKey !== key);
  const visiblePosts = loadedKey === key ? posts : [];
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener('po:feed-refresh', refresh);
    return () => window.removeEventListener('po:feed-refresh', refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<{ tags: { tag: string; count: number }[] }>('/tags', 'GET', undefined, controller.signal)
      .then((data) => setTags(data.tags))
      .catch(() => {});
    return () => controller.abort();
  }, [version]);
  useEffect(() => {
    if (!tab) return;
    const controller = new AbortController();
    api<{ posts: SocialPost[]; hasMore: boolean }>(
      `/posts?kind=${tab}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setPosts(data.posts);
        setMore(data.hasMore);
        setPage(1);
        setLoadedKey(`${tab}:${version}`);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          onError(e.message);
          setPosts([]);
          setMore(false);
          setLoadedKey(`${tab}:${version}`);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [tab, version, onError]);
  useEffect(() => {
    if (tab !== 'story') return;
    const timer = setInterval(
      () =>
        setPosts((old) =>
          old.filter((p) => !p.expiresAt || new Date(p.expiresAt).getTime() > Date.now()),
        ),
      30000,
    );
    return () => clearInterval(timer);
  }, [tab]);
  return (
    <section className="social-hub">
      <div className="hub-tabs">
        <button
          className={tab === 'story' ? 'primary' : 'secondary'}
          onClick={() => setTab(tab === 'story' ? null : 'story')}
        >
          Stories · 24 giờ
        </button>
        <button
          className={tab === 'reel' ? 'primary' : 'secondary'}
          onClick={() => setTab(tab === 'reel' ? null : 'reel')}
        >
          Reels
        </button>
      </div>
      {tags.length > 0 && (
        <div className="tag-list">
          {tags.map((t) => (
            <button
              className="text-button"
              key={t.tag}
              onClick={() =>
                window.dispatchEvent(new CustomEvent('po:search', { detail: '#' + t.tag }))
              }
            >
              #{t.tag} <small>{t.count}</small>
            </button>
          ))}
        </div>
      )}
      {tab && (
        <>
          <p>
            Để đăng {tab === 'story' ? 'Story' : 'Reel'}, chọn loại bài trong ô soạn bài bên dưới.
          </p>
          {loading && <p role="status">Đang tải…</p>}
          {!loading && !visiblePosts.length && <p>Chưa có {tab === 'story' ? 'Story' : 'Reel'}.</p>}
          {visiblePosts.map((post) => (
            <FeedPost
              key={post.id}
              post={post}
              me={me}
              onProfile={onProfile}
              onError={onError}
              onChange={(updated) =>
                setPosts((old) => old.map((p) => (p.id === updated.id ? updated : p)))
              }
              onDelete={(id) => setPosts((old) => old.filter((p) => p.id !== id))}
            />
          ))}
          {more && loadedKey === key && (
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const data = await api<{ posts: SocialPost[]; hasMore: boolean }>(
                    `/posts?kind=${tab}&page=${page + 1}`,
                  );
                  setPosts((old) => [
                    ...old,
                    ...data.posts.filter((p) => !old.some((item) => item.id === p.id)),
                  ]);
                  setPage(page + 1);
                  setMore(data.hasMore);
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Xem thêm
            </button>
          )}
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import { api } from '../lib/api';
import type { SocialPost } from '../types/social';
export function PostPreferences({
  post,
  onHide,
  onChange,
  onError,
}: {
  post: SocialPost;
  onHide: () => void;
  onChange: (post: SocialPost) => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function change(hidden: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await api(
        `/posts/${post.id}/preferences`,
        'PUT',
        hidden ? { hidden: true } : { muted: !post.isMuted },
      );
      if (hidden) onHide();
      else onChange({ ...post, isMuted: !post.isMuted });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="post-preferences">
      <summary>Tùy chọn hiển thị</summary>
      <button type="button" disabled={busy} onClick={() => void change(true)}>
        Ẩn bài viết
      </button>
      <button type="button" disabled={busy} onClick={() => void change(false)}>
        {post.isMuted ? 'Bật' : 'Tắt'} thông báo bài này
      </button>
    </details>
  );
}
export function Reactions({
  post,
  onChange,
  onError,
}: {
  post: SocialPost;
  onChange: (p: SocialPost) => void;
  onError: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="reactions" aria-label="Cảm xúc bài viết">
      {Object.entries({
        like: '👍',
        love: '❤️',
        haha: '😆',
        wow: '😮',
        sad: '😢',
        angry: '😠',
      }).map(([key, emoji]) => (
        <button
          key={key}
          type="button"
          aria-label={`Cảm xúc ${key}`}
          aria-pressed={post.myReaction === key}
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const data = await api<{ post: SocialPost }>(`/posts/${post.id}/reaction`, 'PUT', {
                reaction: post.myReaction === key ? null : key,
              });
              onChange(data.post);
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {emoji} <small>{post.reactions?.[key] || ''}</small>
        </button>
      ))}
    </div>
  );
}

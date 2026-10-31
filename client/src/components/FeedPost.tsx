import { useEffect, useRef, useState } from 'react';
import { Check, ThumbsUp, MessageCircle, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { api, timeAgo } from '../lib/api';
import type { SocialPost, User } from '../types/social';
import { Avatar } from './ui';
import Comments from './Comments';
import { useOptimisticLike } from '../lib/useOptimisticLike';
import { useConfirm } from '../lib/confirmation';

type Props = {
  post: SocialPost;
  me: User;
  onChange: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  onProfile: (id: string) => void;
  onError: (message: string) => void;
};
export default function FeedPost({ post, me, onChange, onDelete, onProfile, onError }: Props) {
  const confirm = useConfirm();
  const actionLock = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const latestPost = useRef(post);
  useEffect(() => {
    latestPost.current = post;
  }, [post]);
  const toggleLike = useOptimisticLike(post, onChange, onError);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentsOpened, setCommentsOpened] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  async function run(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  return (
    <article className="card feed-post">
      <header className="post-header">
        <button className="user-link" onClick={() => onProfile(post.author.id)}>
          <Avatar user={post.author} />
          <span>
            <strong>{post.author.name}</strong>
            <small>
              @{post.author.username} <span>·</span> {timeAgo(post.createdAt)}
            </small>
          </span>
        </button>
        {me.id === post.author.id && (
          <div className="post-menu" ref={menuRef}>
            <button
              className="icon-button"
              aria-label="Tùy chọn bài viết"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={21} />
            </button>
            {menu && (
              <div className="dropdown">
                <button
                  onClick={() => {
                    setDraft(post.content);
                    setEditing(true);
                    setMenu(false);
                  }}
                >
                  <Pencil size={15} />
                  Sửa bài viết
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    setMenu(false);
                    if (
                      await confirm({
                        title: 'Xóa bài viết?',
                        message:
                          'Bài viết và các bình luận sẽ bị xóa. Bạn không thể hoàn tác thao tác này.',
                        confirmLabel: 'Xóa bài viết',
                        danger: true,
                      })
                    )
                      await run(async () => {
                        await api(`/posts/${post.id}`, 'DELETE');
                        onDelete(post.id);
                      });
                  }}
                >
                  <Trash2 size={15} />
                  Xóa bài viết
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      {editing ? (
        <form
          className="edit-post"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const data = await api<{ post: SocialPost }>(`/posts/${post.id}`, 'PATCH', {
                content: draft,
              });
              onChange(data.post);
              setEditing(false);
            });
          }}
        >
          <textarea
            disabled={busy}
            aria-label="Sửa nội dung bài viết"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={5000}
          />
          <div>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  draft !== post.content &&
                  !(await confirm({
                    title: 'Bỏ thay đổi?',
                    message: 'Nội dung bạn vừa sửa chưa được lưu.',
                    confirmLabel: 'Bỏ thay đổi',
                  }))
                )
                  return;
                setEditing(false);
              }}
            >
              <X size={15} />
              Hủy
            </button>
            <button className="primary" disabled={busy || (!draft.trim() && !post.image)}>
              <Check size={15} />
              Lưu
            </button>
          </div>
        </form>
      ) : (
        post.content && <p className="post-content">{post.content}</p>
      )}
      {post.image && (
        <a className="post-image-link" href={post.image} target="_blank" rel="noreferrer">
          <img
            className="post-image"
            src={post.image}
            loading="lazy"
            alt={`Ảnh trong bài viết của ${post.author.name}`}
          />
        </a>
      )}
      <div className="post-stats">
        <span>
          {post.likeCount > 0 ? (
            <>
              <span className="like-dot">
                <ThumbsUp size={10} fill="currentColor" />
              </span>
              {post.likeCount} lượt thích
            </>
          ) : (
            'Chưa có lượt thích'
          )}
        </span>
        <button
          onClick={() => {
            setShowComments(!showComments);
            setCommentsOpened(true);
          }}
        >
          {post.commentCount} bình luận
        </button>
      </div>
      <div className="post-actions">
        <button
          className={post.isLiked ? 'liked' : ''}
          aria-pressed={post.isLiked}
          disabled={busy}
          onClick={() => void toggleLike()}
        >
          <ThumbsUp size={19} fill={post.isLiked ? 'currentColor' : 'none'} />
          {post.isLiked ? 'Đã thích' : 'Thích'}
        </button>
        <button
          aria-expanded={showComments}
          onClick={() => {
            setShowComments(!showComments);
            setCommentsOpened(true);
          }}
        >
          <MessageCircle size={19} />
          Bình luận
        </button>
      </div>
      {commentsOpened && (
        <div hidden={!showComments}>
          <Comments
            postId={post.id}
            me={me}
            count={post.commentCount}
            onCountChange={(count) => onChange({ ...latestPost.current, commentCount: count })}
            onProfile={onProfile}
            onError={onError}
          />
        </div>
      )}
    </article>
  );
}

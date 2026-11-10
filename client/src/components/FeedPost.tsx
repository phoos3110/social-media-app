import { useEffect, useRef, useState } from 'react';
import { ThumbsUp, MessageCircle, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { api, timeAgo } from '../lib/api';
import type { SocialPost, User } from '../types/social';
import { Avatar } from './ui';
import Comments from './Comments';
import PostEditor from './PostEditor';
import RichText from './RichText';
import { PostPreferences, Reactions } from './PostControls';
import { useOptimisticLike } from '../lib/useOptimisticLike';
import { useConfirm } from '../lib/confirmation';
import {
  PostMedia,
  SharedPreview,
  ReportButton,
  SaveButton,
  SharePost,
  PostLikers,
} from './PostFeatures';

type Props = {
  post: SocialPost;
  me: User;
  onChange: (post: SocialPost) => void;
  onDelete: (id: string) => void;
  onProfile: (id: string) => void;
  onError: (message: string) => void;
  initialCommentId?: string;
};
export default function FeedPost({
  post,
  me,
  onChange,
  onDelete,
  onProfile,
  onError,
  initialCommentId,
}: Props) {
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
  const [busy, setBusy] = useState(false);
  const [showComments, setShowComments] = useState(Boolean(initialCommentId));
  const [commentsOpened, setCommentsOpened] = useState(Boolean(initialCommentId));
  const [likers, setLikers] = useState(false);

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
    <article className="card feed-post" data-post-id={post.id}>
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
        <div className="post-tools">
          <SaveButton
            post={post}
            onSaved={(saved) => onChange({ ...latestPost.current, isSaved: saved })}
            onError={onError}
          />
          {me.id !== post.author.id && <ReportButton postId={post.id} />}
        </div>
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
        <PostEditor
          post={post}
          onSaved={(updated) => {
            onChange(updated);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onError={onError}
        />
      ) : (
        post.content && (
          <p className="post-content">
            <RichText text={post.content} />
          </p>
        )
      )}
      <small className="audience-label">
        {post.audience === 'private'
          ? 'Chỉ mình tôi'
          : post.audience === 'followers'
            ? 'Người theo dõi'
            : post.author.isPrivate
              ? 'Tài khoản riêng tư'
              : 'Công khai'}
      </small>
      <PostPreferences
        post={post}
        onHide={() => onDelete(post.id)}
        onChange={onChange}
        onError={onError}
      />
      <PostMedia post={post} />
      <Reactions post={post} onChange={onChange} onError={onError} />
      {post.sharedPostId && <SharedPreview postId={post.sharedPostId} />}
      <div className="post-stats">
        <button className="likers-link" onClick={() => setLikers(true)}>
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
        </button>
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
        <SharePost post={post} />
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
            initialCommentId={initialCommentId}
          />
        </div>
      )}
      {likers && (
        <PostLikers postId={post.id} onProfile={onProfile} onClose={() => setLikers(false)} />
      )}
    </article>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Trash2, X, Pencil } from 'lucide-react';
import type { PostComment, User } from '../types/social';
import RichText from './RichText';
import { api, timeAgo, ApiError } from '../lib/api';
import { useConfirm } from '../lib/confirmation';
import { Avatar, Loading } from './ui';
import { useDraft } from '../lib/drafts';

type Page = { comments: PostComment[]; hasMore: boolean };
const merge = (a: PostComment[], b: PostComment[]) => [
  ...a,
  ...b.filter((c) => !a.some((x) => x.id === c.id)),
];
export default function Comments({
  postId,
  me,
  count,
  onCountChange,
  onProfile,
  onError,
  initialCommentId,
}: {
  postId: string;
  me: User;
  count: number;
  onCountChange: (count: number) => void;
  onProfile: (id: string) => void;
  onError: (message: string) => void;
  initialCommentId?: string;
}) {
  const confirm = useConfirm();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [replies, setReplies] = useState<Record<string, PostComment[]>>({});
  const [opened, setOpened] = useState<string[]>([]);
  const [replyPages, setReplyPages] = useState<Record<string, number>>({});
  const [moreReplies, setMoreReplies] = useState<Record<string, boolean>>({});
  const [replyLoading, setReplyLoading] = useState<string[]>([]);
  const [draft, setDraft] = useDraft(`po:draft:${me.id}:comment:${postId}`);
  const [targetJson, setTargetJson] = useDraft(`po:draft:${me.id}:reply:${postId}`);
  let target: { rootId: string; name: string } | null = null;
  try {
    const t = JSON.parse(targetJson);
    if (t && typeof t.rootId === 'string' && typeof t.name === 'string') target = t;
  } catch {}
  const setTarget = (value: { rootId: string; name: string } | null) =>
    setTargetJson(value ? JSON.stringify(value) : '');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [commentBusy, setCommentBusy] = useState<string[]>([]);
  const actionLocks = useRef(new Set<string>());
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const replyLocks = useRef(new Set<string>());
  const deleteLocks = useRef(new Set<string>());
  const countRef = useRef(count);
  function patchComment(commentId: string, update: (c: PostComment) => PostComment) {
    setComments((old) => old.map((c) => (c.id === commentId ? update(c) : c)));
    setReplies((old) =>
      Object.fromEntries(
        Object.entries(old).map(([key, items]) => [
          key,
          items.map((c) => (c.id === commentId ? update(c) : c)),
        ]),
      ),
    );
  }
  useEffect(() => {
    if (!initialCommentId) return;
    const controller = new AbortController();
    api<{ comments: PostComment[] }>(
      `/posts/${postId}/comments/${initialCommentId}/context`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        const root = data.comments.find((c) => !c.parentId);
        if (root) setComments((old) => merge([root], old));
        setReplies((old) => {
          const next = { ...old };
          for (const c of data.comments)
            if (c.parentId) next[c.parentId] = merge([c], next[c.parentId] || []);
          return next;
        });
        setOpened((old) => [
          ...new Set([
            ...old,
            ...data.comments.filter((c) => c.id !== initialCommentId).map((c) => c.id),
          ]),
        ]);
        requestAnimationFrame(() =>
          document
            .getElementById(`comment-${initialCommentId}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        );
      })
      .catch((e) => {
        if (e.name !== 'AbortError') onError(e.message);
      });
    return () => controller.abort();
  }, [initialCommentId, postId, onError]);
  useEffect(() => {
    countRef.current = count;
  }, [count]);
  const changeCount = (next: number) => {
    countRef.current = Math.max(0, next);
    onCountChange(countRef.current);
  };
  useEffect(() => {
    const controller = new AbortController();
    api<Page>(`/posts/${postId}/comments?page=${page}`, 'GET', undefined, controller.signal)
      .then((data) => {
        setComments((prev) =>
          page === 1 ? merge(data.comments, prev) : merge(prev, data.comments),
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
  }, [postId, page, retry]);
  const loadReplies = useCallback(
    async (rootId: string, nextPage = 1) => {
      if (replyLocks.current.has(rootId)) return;
      replyLocks.current.add(rootId);
      setReplyLoading((prev) => [...prev, rootId]);
      setOpened((prev) => (prev.includes(rootId) ? prev : [...prev, rootId]));
      try {
        const data = await api<Page>(
          `/posts/${postId}/comments/${rootId}/replies?page=${nextPage}`,
        );
        setReplies((prev) => ({
          ...prev,
          [rootId]: merge(
            nextPage === 1 ? data.comments : prev[rootId] || [],
            nextPage === 1 ? prev[rootId] || [] : data.comments,
          ),
        }));
        setReplyPages((prev) => ({ ...prev, [rootId]: nextPage }));
        setMoreReplies((prev) => ({ ...prev, [rootId]: data.hasMore }));
      } catch (e) {
        if (e instanceof ApiError && [403, 404].includes(e.status)) {
          setComments((old) => old.filter((c) => c.id !== rootId));
          setReplies((old) =>
            Object.fromEntries(
              Object.entries(old).map(([key, items]) => [
                key,
                items.filter((c) => c.id !== rootId),
              ]),
            ),
          );
          setOpened((old) => old.filter((id) => id !== rootId));
        } else onError((e as Error).message);
      } finally {
        replyLocks.current.delete(rootId);
        setReplyLoading((prev) => prev.filter((id) => id !== rootId));
      }
    },
    [postId, onError],
  );
  useEffect(() => {
    const change = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data?.id !== postId) return;
      if (data.deletedCommentId) {
        setComments((old) => old.filter((c) => c.id !== data.deletedCommentId));
        setReplies((old) =>
          Object.fromEntries(
            Object.entries(old).map(([key, items]) => [
              key,
              items.filter((c) => c.id !== data.deletedCommentId),
            ]),
          ),
        );
      }
      if (lock.current || deleteLocks.current.size || actionLocks.current.size) return;
      setPage(1);
      setRetry((n) => n + 1);
      for (const parent of opened) void loadReplies(parent);
    };
    window.addEventListener('po:post-changed', change);
    return () => window.removeEventListener('po:post-changed', change);
  }, [postId, opened, loadReplies]);
  async function submit() {
    const content = draft.trim();
    if (!content || lock.current) return;
    lock.current = true;
    setSending(true);
    const parent = target?.rootId || null;
    const temp: PostComment = {
      id: `pending-${crypto.randomUUID()}`,
      author: me,
      content,
      createdAt: new Date().toISOString(),
      parentId: parent,
      replyCount: 0,
    };
    const update = (apply: (items: PostComment[]) => PostComment[]) =>
      parent
        ? setReplies((prev) => ({ ...prev, [parent]: apply(prev[parent] || []) }))
        : setComments(apply);
    setPending((prev) => [...prev, temp.id]);
    update((prev) => (parent ? [...prev, temp] : [temp, ...prev]));
    if (parent) {
      setOpened((prev) => (prev.includes(parent) ? prev : [...prev, parent]));
      patchComment(parent, (c) => ({ ...c, replyCount: c.replyCount + 1 }));
    }
    setDraft('');
    setTarget(null);
    changeCount(countRef.current + 1);
    try {
      const data = await api<{ comment: PostComment }>(`/posts/${postId}/comments`, 'POST', {
        content,
        parentId: parent,
      });
      update((prev) => prev.map((c) => (c.id === temp.id ? data.comment : c)));
    } catch (e) {
      update((prev) => prev.filter((c) => c.id !== temp.id));
      if (parent)
        patchComment(parent, (c) => ({ ...c, replyCount: Math.max(0, c.replyCount - 1) }));
      changeCount(countRef.current - 1);
      setDraft((prev) => prev || content);
      if (parent) setTarget({ rootId: parent, name: target!.name });
      onError((e as Error).message);
    } finally {
      lock.current = false;
      setSending(false);
      setPending((prev) => prev.filter((id) => id !== temp.id));
      window.dispatchEvent(new CustomEvent('po:post-changed', { detail: { id: postId } }));
    }
  }
  async function remove(comment: PostComment) {
    if (deleteLocks.current.has(comment.id) || pending.includes(comment.id) || sending) return;
    if (
      !(await confirm({
        title: 'Xóa bình luận?',
        message: comment.replyCount
          ? 'Bình luận và các câu trả lời sẽ bị xóa.'
          : 'Bạn không thể hoàn tác thao tác này.',
        confirmLabel: 'Xóa bình luận',
        danger: true,
      }))
    )
      return;
    deleteLocks.current.add(comment.id);
    setDeleting((prev) => [...prev, comment.id]);
    try {
      const data = await api<{ commentCount: number }>(
        `/posts/${postId}/comments/${comment.id}`,
        'DELETE',
      );
      if (comment.parentId) {
        const root = comment.parentId;
        setReplies((prev) => ({
          ...prev,
          [root]: (prev[root] || []).filter((c) => c.id !== comment.id),
        }));
        patchComment(root, (c) => ({ ...c, replyCount: Math.max(0, c.replyCount - 1) }));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== comment.id));
        if (target?.rootId === comment.id) setTarget(null);
      }
      changeCount(data.commentCount);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      deleteLocks.current.delete(comment.id);
      setDeleting((prev) => prev.filter((id) => id !== comment.id));
      window.dispatchEvent(new CustomEvent('po:post-changed', { detail: { id: postId } }));
    }
  }
  async function likeComment(comment: PostComment) {
    if (actionLocks.current.has(comment.id)) return;
    actionLocks.current.add(comment.id);
    setCommentBusy((old) => [...old, comment.id]);
    const liked = !comment.isLiked;
    patchComment(comment.id, (c) => ({
      ...c,
      isLiked: liked,
      likeCount: Math.max(0, (c.likeCount || 0) + (liked ? 1 : -1)),
    }));
    try {
      const data = await api<{ liked: boolean; likeCount: number }>(
        `/posts/${postId}/comments/${comment.id}/like`,
        'PUT',
        { liked },
      );
      patchComment(comment.id, (c) => ({ ...c, isLiked: data.liked, likeCount: data.likeCount }));
    } catch (e) {
      patchComment(comment.id, (c) => ({
        ...c,
        isLiked: comment.isLiked,
        likeCount: comment.likeCount,
      }));
      onError((e as Error).message);
    } finally {
      actionLocks.current.delete(comment.id);
      setCommentBusy((old) => old.filter((id) => id !== comment.id));
      window.dispatchEvent(new CustomEvent('po:post-changed', { detail: { id: postId } }));
    }
  }
  async function saveComment(comment: PostComment) {
    if (!editing?.content.trim() || actionLocks.current.has(comment.id)) return;
    actionLocks.current.add(comment.id);
    setCommentBusy((old) => [...old, comment.id]);
    const content = editing.content.trim();
    patchComment(comment.id, (c) => ({ ...c, content }));
    setEditing(null);
    try {
      await api(`/posts/${postId}/comments/${comment.id}`, 'PATCH', { content });
    } catch (e) {
      patchComment(comment.id, (c) => ({ ...c, content: comment.content }));
      setEditing({ id: comment.id, content });
      onError((e as Error).message);
    } finally {
      actionLocks.current.delete(comment.id);
      setCommentBusy((old) => old.filter((id) => id !== comment.id));
      window.dispatchEvent(new CustomEvent('po:post-changed', { detail: { id: postId } }));
    }
  }
  function renderComment(comment: PostComment, rootId: string) {
    const waiting = pending.includes(comment.id);
    return (
      <div
        className={`comment ${waiting ? 'comment-pending' : ''} ${initialCommentId === comment.id ? 'comment-highlight' : ''}`}
        id={`comment-${comment.id}`}
        key={comment.id}
      >
        <button
          className="avatar-button"
          onClick={() => onProfile(comment.author.id)}
          aria-label={`Xem hồ sơ ${comment.author.name}`}
        >
          <Avatar user={comment.author} size="sm" />
        </button>
        <div className="comment-main">
          <div className="comment-bubble">
            <strong>{comment.author.name}</strong>
            {editing?.id === comment.id ? (
              <form
                className="comment-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveComment(comment);
                }}
              >
                <textarea
                  aria-label="Sửa bình luận"
                  maxLength={2000}
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                />
                <button
                  className="text-button"
                  disabled={!editing.content.trim() || commentBusy.includes(comment.id)}
                >
                  Lưu
                </button>
                <button type="button" className="text-button" onClick={() => setEditing(null)}>
                  Hủy
                </button>
              </form>
            ) : (
              <p>
                <RichText text={comment.content} />
              </p>
            )}
          </div>
          <div className="comment-meta">
            <small>{waiting ? 'Đang gửi…' : timeAgo(comment.createdAt)}</small>
            <button
              type="button"
              disabled={waiting}
              onClick={() => {
                setTarget({ rootId, name: comment.author.name });
                input.current?.focus();
              }}
            >
              Trả lời
            </button>
            <button
              className={comment.isLiked ? 'liked' : ''}
              disabled={waiting || commentBusy.includes(comment.id)}
              aria-pressed={Boolean(comment.isLiked)}
              onClick={() => void likeComment(comment)}
            >
              Thích{comment.likeCount ? ` · ${comment.likeCount}` : ''}
            </button>
          </div>
        </div>
        {comment.author.id === me.id && (
          <>
            <button
              className="icon-button"
              aria-label="Sửa bình luận"
              disabled={waiting || commentBusy.includes(comment.id)}
              onClick={() => setEditing({ id: comment.id, content: comment.content })}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="Xóa bình luận"
              disabled={waiting || sending || deleting.includes(comment.id)}
              onClick={() => void remove(comment)}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    );
  }
  function renderThread(c: PostComment, depth = 0): React.ReactNode {
    return (
      <div className="comment-thread" key={c.id}>
        {renderComment(c, c.id)}
        {c.replyCount > 0 && !opened.includes(c.id) && (
          <button className="text-button replies-toggle" onClick={() => void loadReplies(c.id)}>
            Xem {c.replyCount} câu trả lời
          </button>
        )}
        {opened.includes(c.id) && (
          <div className={`comment-replies ${depth >= 1 ? 'flat-replies' : ''}`}>
            <button
              className="text-button"
              onClick={() => setOpened((old) => old.filter((id) => id !== c.id))}
            >
              Ẩn câu trả lời
            </button>
            {(replies[c.id] || []).map((r) => renderThread(r, depth + 1))}
            {replyLoading.includes(c.id) && <Loading />}
            {moreReplies[c.id] && (
              <button
                className="text-button"
                disabled={replyLoading.includes(c.id)}
                onClick={() => void loadReplies(c.id, (replyPages[c.id] || 0) + 1)}
              >
                Xem thêm câu trả lời
              </button>
            )}
            {!replyPages[c.id] && c.replyCount > (replies[c.id]?.length || 0) && (
              <button
                className="text-button"
                disabled={replyLoading.includes(c.id)}
                onClick={() => void loadReplies(c.id)}
              >
                Tải câu trả lời trước
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <section className="comments">
      {target && (
        <div className="reply-target">
          Đang trả lời {target.name}
          <button className="icon-button" aria-label="Hủy trả lời" onClick={() => setTarget(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Avatar user={me} size="sm" />
        <input
          ref={input}
          aria-label="Nội dung bình luận"
          placeholder={target ? `Trả lời ${target.name}…` : 'Viết bình luận…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
        <button
          className="icon-button"
          aria-label="Gửi bình luận"
          disabled={sending || !draft.trim()}
        >
          <Send size={18} />
        </button>
      </form>
      {comments.map((c) => renderThread(c))}
      {loading && <Loading />}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            className="text-button"
            onClick={() => {
              setError('');
              setLoading(true);
              setRetry((n) => n + 1);
            }}
          >
            Thử lại
          </button>
        </p>
      )}
      {!loading && !error && !comments.length && (
        <p className="muted small">Chưa có bình luận. Bắt đầu cuộc trò chuyện nhé!</p>
      )}
      {more && (
        <button
          className="text-button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setPage((n) => n + 1);
          }}
        >
          Xem bình luận trước
        </button>
      )}
    </section>
  );
}

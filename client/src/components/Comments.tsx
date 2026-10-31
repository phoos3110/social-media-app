import { useEffect, useRef, useState } from 'react';
import { Send, Trash2, X } from 'lucide-react';
import type { PostComment, User } from '../types/social';
import { api, timeAgo } from '../lib/api';
import { useConfirm } from '../lib/confirmation';
import { Avatar, Loading } from './ui';

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
}: {
  postId: string;
  me: User;
  count: number;
  onCountChange: (count: number) => void;
  onProfile: (id: string) => void;
  onError: (message: string) => void;
}) {
  const confirm = useConfirm();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [replies, setReplies] = useState<Record<string, PostComment[]>>({});
  const [opened, setOpened] = useState<string[]>([]);
  const [replyPages, setReplyPages] = useState<Record<string, number>>({});
  const [moreReplies, setMoreReplies] = useState<Record<string, boolean>>({});
  const [replyLoading, setReplyLoading] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState<{ rootId: string; name: string } | null>(null);
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
  async function loadReplies(rootId: string, nextPage = 1) {
    if (replyLocks.current.has(rootId)) return;
    replyLocks.current.add(rootId);
    setReplyLoading((prev) => [...prev, rootId]);
    setOpened((prev) => (prev.includes(rootId) ? prev : [...prev, rootId]));
    try {
      const data = await api<Page>(`/posts/${postId}/comments/${rootId}/replies?page=${nextPage}`);
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
      onError((e as Error).message);
    } finally {
      replyLocks.current.delete(rootId);
      setReplyLoading((prev) => prev.filter((id) => id !== rootId));
    }
  }
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
      setComments((prev) =>
        prev.map((c) => (c.id === parent ? { ...c, replyCount: c.replyCount + 1 } : c)),
      );
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
        setComments((prev) =>
          prev.map((c) =>
            c.id === parent ? { ...c, replyCount: Math.max(0, c.replyCount - 1) } : c,
          ),
        );
      changeCount(countRef.current - 1);
      setDraft((prev) => prev || content);
      if (parent) setTarget({ rootId: parent, name: target!.name });
      onError((e as Error).message);
    } finally {
      lock.current = false;
      setSending(false);
      setPending((prev) => prev.filter((id) => id !== temp.id));
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
        setComments((prev) =>
          prev.map((c) =>
            c.id === root ? { ...c, replyCount: Math.max(0, c.replyCount - 1) } : c,
          ),
        );
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
    }
  }
  function renderComment(comment: PostComment, rootId: string) {
    const waiting = pending.includes(comment.id);
    return (
      <div className={`comment ${waiting ? 'comment-pending' : ''}`} key={comment.id}>
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
            <p>{comment.content}</p>
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
          </div>
        </div>
        {comment.author.id === me.id && (
          <button
            className="icon-button"
            aria-label="Xóa bình luận"
            disabled={waiting || sending || deleting.includes(comment.id)}
            onClick={() => void remove(comment)}
          >
            <Trash2 size={14} />
          </button>
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
      {comments.map((c) => (
        <div className="comment-thread" key={c.id}>
          {renderComment(c, c.id)}
          {c.replyCount > 0 && !opened.includes(c.id) && (
            <button className="text-button replies-toggle" onClick={() => void loadReplies(c.id)}>
              Xem {c.replyCount} câu trả lời
            </button>
          )}
          {opened.includes(c.id) && (
            <div className="comment-replies">
              {(replies[c.id] || []).map((r) => renderComment(r, c.id))}
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
      ))}
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

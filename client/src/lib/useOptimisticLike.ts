import { useEffect, useRef } from 'react';
import type { SocialPost } from '../types/social';
import { api } from './api';

export function useOptimisticLike(
  post: SocialPost,
  onChange: (post: SocialPost) => void,
  onError: (message: string) => void,
) {
  const latest = useRef(post);
  const confirmed = useRef({ liked: post.isLiked, count: post.likeCount });
  const desired = useRef(post.isLiked);
  const running = useRef(false);
  useEffect(() => {
    latest.current = post;
    if (!running.current) {
      confirmed.current = { liked: post.isLiked, count: post.likeCount };
      desired.current = post.isLiked;
    }
  }, [post]);
  function show() {
    onChange({
      ...latest.current,
      isLiked: desired.current,
      likeCount: Math.max(
        0,
        confirmed.current.count + Number(desired.current) - Number(confirmed.current.liked),
      ),
    });
  }
  return async function toggle() {
    window.dispatchEvent(
      new CustomEvent('po:like-pending', { detail: { id: post.id, pending: true } }),
    );
    desired.current = !desired.current;
    show();
    if (running.current) return;
    running.current = true;
    try {
      while (desired.current !== confirmed.current.liked) {
        const target = desired.current;
        const data = await api<{ post: SocialPost }>(`/posts/${post.id}/like`, 'PUT', {
          liked: target,
        });
        confirmed.current = { liked: data.post.isLiked, count: data.post.likeCount };
        show();
      }
    } catch (error) {
      desired.current = confirmed.current.liked;
      show();
      onError((error as Error).message);
    } finally {
      running.current = false;
      window.dispatchEvent(
        new CustomEvent('po:like-pending', { detail: { id: post.id, pending: false } }),
      );
    }
  };
}

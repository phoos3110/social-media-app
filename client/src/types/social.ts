export type User = {
  id: string;
  username: string;
  name: string;
  bio: string;
  avatar: string;
  cover?: string;
  isPrivate?: boolean;
  requested?: boolean;
  createdAt: string;
  isFollowing?: boolean;
  followers?: number;
  following?: number;
  postCount?: number;
};
export type SocialPost = {
  id: string;
  author: User;
  content: string;
  image: string;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  isLiked: boolean;
  commentCount: number;
  media?: { url: string; kind: 'image' | 'video' }[];
  youtubeId?: string | null;
  sharedPostId?: string | null;
  isSaved?: boolean;
};
export type PostComment = {
  id: string;
  author: User;
  content: string;
  createdAt: string;
  parentId: string | null;
  replyCount: number;
  likeCount?: number;
  isLiked?: boolean;
};
export type Notice = {
  id: string;
  actor: User;
  kind: 'like' | 'comment' | 'follow' | 'reply' | 'request';
  postId: string | null;
  commentId?: string | null;
  readAt: string | null;
  createdAt: string;
};
export type Message = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  image?: string;
  replyToId?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    content: string;
    image: string;
    recalledAt: string | null;
  } | null;
  recalledAt?: string | null;
};
export type Conversation = { user: User; lastMessage: string; lastAt: string; unread: number };

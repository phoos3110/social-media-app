export type User = {
  id: string;
  username: string;
  name: string;
  bio: string;
  avatar: string;
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
};
export type PostComment = {
  id: string;
  author: User;
  content: string;
  createdAt: string;
  parentId: string | null;
  replyCount: number;
};
export type Notice = {
  id: string;
  actor: User;
  kind: 'like' | 'comment' | 'follow' | 'reply';
  postId: string | null;
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
};
export type Conversation = { user: User; lastMessage: string; lastAt: string; unread: number };

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  CheckCheck,
  Compass,
  Home,
  Heart,
  LogOut,
  MessageCircle,
  Search,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import AuthPage from './components/AuthPage';
import { InstallApp } from './components/Pwa';
import { ThemeToggle } from './components/Theme';
import Settings from './components/Settings';
import AccountLink from './components/AccountLink';
import { usePresence } from './lib/usePresence';
import { useConfirm } from './lib/confirmation';
import Composer from './components/Composer';
import FeedPost from './components/FeedPost';
import Profile from './components/Profile';
import Chat from './components/Chat';
import { Avatar, Brand, Empty, Loading } from './components/ui';
import { api, ApiError, timeAgo } from './lib/api';
import type { Conversation, Notice, SocialPost, User } from './types/social';

type View = 'feed' | 'discover' | 'notifications' | 'messages' | 'profile' | 'saved';
export default function App() {
  const confirm = useConfirm();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const logoutLock = useRef(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [readingNotices, setReadingNotices] = useState(false);
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const userId = me?.id;
  const [bootAttempt, setBootAttempt] = useState(0);
  const [booting, setBooting] = useState(true);
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const [bootError, setBootError] = useState('');
  const [view, setView] = useState<View>('feed');
  const [feed, setFeed] = useState<'all' | 'following'>('all');
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [people, setPeople] = useState<User[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [noticePage, setNoticePage] = useState(1);
  const [moreNotices, setMoreNotices] = useState(false);
  const [unread, setUnread] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [profileId, setProfileId] = useState('');
  const [peer, setPeer] = useState<User | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loadedFeedKey, setLoadedFeedKey] = useState('');
  const feedKey = JSON.stringify([userId, view, feed, keyword, profileId, refresh]);
  const visiblePosts = loadedFeedKey === feedKey ? posts : [];
  const feedLoading = loading || loadedFeedKey !== feedKey;
  const [toast, setToast] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const online = usePresence(
    people.map((u) => u.id),
    socket,
  );
  const optimisticLikes = useRef(new Set<string>());
  useEffect(() => {
    const update = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data.pending) optimisticLikes.current.add(data.id);
      else optimisticLikes.current.delete(data.id);
    };
    window.addEventListener('po:like-pending', update);
    return () => window.removeEventListener('po:like-pending', update);
  }, []);
  const [focusedPost, setFocusedPost] = useState<SocialPost | null>(null);
  const knownPosts = useRef(new Set<string>());
  useEffect(() => {
    knownPosts.current = new Set([
      ...posts.map((p) => p.id),
      ...(focusedPost ? [focusedPost.id] : []),
    ]);
  }, [posts, focusedPost]);
  const [pendingFollow, setPendingFollow] = useState<string[]>([]);
  const followLocks = useRef(new Set<string>());
  const feedRequest = useRef(0);
  const notify = useCallback((message: string) => setToast(message), []);
  function boot() {
    setBootError('');
    setBooting(true);
    setBootAttempt((attempt) => attempt + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: User }>('/auth/me', 'GET', undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setMe(data.user);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) setMe(null);
        if (error.name !== 'AbortError' && !(error instanceof ApiError && error.status === 401))
          setBootError('Không thể kết nối. Vui lòng kiểm tra kết nối và thử lại.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBooting(false);
      });
    return () => controller.abort();
  }, [bootAttempt]);
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refreshBadges = useCallback(async () => {
    const [notifications, chats] = await Promise.all([
      api<{ notifications: Notice[]; unread: number; hasMore: boolean }>('/notifications'),
      api<{ conversations: Conversation[] }>('/conversations'),
    ]);
    setUnread(notifications.unread);
    setNotices(notifications.notifications);
    setNoticePage(1);
    setMoreNotices(notifications.hasMore);
    setUnreadMessages(chats.conversations.reduce((sum, c) => sum + c.unread, 0));
  }, []);
  const handleRead = useCallback(() => {
    void refreshBadges().catch((error) => notify(error.message));
  }, [refreshBadges, notify]);
  useEffect(() => {
    if (!userId) return;
    const connection = io({ withCredentials: true });
    const update = () => {
      void refreshBadges().catch((e) => notify(e.message));
    };
    connection.on('connect', () => {
      setSocket(connection);
      setConnected(true);
      update();
    });
    connection.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect')
        void api('/auth/me').catch((e) => {
          if (e instanceof ApiError && e.status === 401) setMe(null);
        });
    });
    connection.on('connect_error', () => {
      setConnected(false);
      void api('/auth/me').catch((e) => {
        if (e instanceof ApiError && e.status === 401) setMe(null);
      });
    });
    connection.on('notification:new', update);
    connection.on('message:new', update);
    connection.on('conversation:read', update);
    update();
    const expire = () => {
      setMe(null);
      notify('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    };
    window.addEventListener('session:expired', expire);
    return () => {
      connection.disconnect();
      setSocket(null);
      setConnected(false);
      window.removeEventListener('session:expired', expire);
    };
  }, [userId, notify, refreshBadges]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    api<{ users: User[] }>(
      `/users?search=${encodeURIComponent(view === 'discover' ? keyword : '')}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => setPeople(data.users))
      .catch((e) => {
        if (e.name !== 'AbortError') notify(e.message);
      });
    return () => controller.abort();
  }, [userId, keyword, view, refresh, notify]);
  useEffect(() => {
    if (!userId || !['feed', 'profile', 'saved'].includes(view)) return;
    const controller = new AbortController();
    const request = ++feedRequest.current;
    const params = new URLSearchParams({
      search: keyword,
      feed: view === 'feed' ? feed : 'all',
      ...(view === 'profile' ? { author: profileId } : {}),
    });
    api<{ posts: SocialPost[]; hasMore: boolean }>(
      view === 'saved' ? '/bookmarks' : `/posts?${params}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (request === feedRequest.current && !controller.signal.aborted) {
          setPosts(data.posts);
          setHasMore(data.hasMore);
          setPage(1);
          setLoadedFeedKey(feedKey);
        }
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          notify(e.message);
          setPosts([]);
          setHasMore(false);
          setLoadedFeedKey(feedKey);
        }
      })
      .finally(() => {
        if (request === feedRequest.current && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      feedRequest.current = request + 1;
    };
  }, [userId, view, feed, keyword, profileId, refresh, feedKey, notify]);
  function navigate(next: View) {
    setView(next);
    setSearch('');
    setKeyword('');
    setFocusedPost(null);
    if (next === 'profile') setProfileId(me!.id);
  }
  function openProfile(userId: string) {
    setView('profile');
    setProfileId(userId);
    setSearch('');
    setKeyword('');
    setFocusedPost(null);
  }
  function openChat(user: User) {
    setPeer(user);
    navigate('messages');
  }
  useEffect(() => {
    if (!userId) return;
    const params = new URLSearchParams(hash.slice(1));
    const postId = params.get('post'),
      chatId = params.get('chat');
    let active = true;
    if (postId)
      void api<{ post: SocialPost }>(`/posts/${postId}`)
        .then((data) => {
          if (active) {
            setView('feed');
            setFocusedPost(data.post);
          }
        })
        .catch((e) => {
          if (active) notify(e.message);
        });
    if (chatId)
      void api<{ user: User }>(`/users/${chatId}`)
        .then((data) => {
          if (active) {
            setPeer(data.user);
            setView('messages');
            setFocusedPost(null);
          }
        })
        .catch((e) => {
          if (active) notify(e.message);
        });
    return () => {
      active = false;
    };
  }, [hash, userId, notify]);
  async function follow(user: User) {
    if (followLocks.current.has(user.id))
      return { following: Boolean(user.isFollowing), requested: user.requested };
    followLocks.current.add(user.id);
    setPendingFollow((previous) => [...previous, user.id]);
    setPeople((previous) =>
      previous.map((p) =>
        p.id === user.id
          ? {
              ...p,
              isFollowing: !user.isFollowing,
              followers: Math.max(0, (p.followers || 0) + (user.isFollowing ? -1 : 1)),
            }
          : p,
      ),
    );
    try {
      const result = await api<{ following: boolean; requested?: boolean }>(
        `/users/${user.id}/follow`,
        'PUT',
        { following: !(user.isFollowing || user.requested) },
      );
      setPeople((previous) =>
        previous.map((p) =>
          p.id === user.id
            ? {
                ...p,
                isFollowing: result.following,
                requested: result.requested,
                followers: Math.max(
                  0,
                  (user.followers || 0) +
                    Number(result.following) -
                    Number(Boolean(user.isFollowing)),
                ),
              }
            : p,
        ),
      );
      return result;
    } catch (e) {
      setPeople((previous) =>
        previous.map((p) =>
          p.id === user.id
            ? { ...p, isFollowing: user.isFollowing, followers: user.followers ?? p.followers }
            : p,
        ),
      );
      throw e;
    } finally {
      followLocks.current.delete(user.id);
      setPendingFollow((previous) => previous.filter((id) => id !== user.id));
    }
  }
  function updatePost(post: SocialPost) {
    setPosts((previous) =>
      view === 'saved'
        ? post.isSaved === false
          ? previous.filter((p) => p.id !== post.id)
          : previous.some((p) => p.id === post.id)
            ? previous.map((p) => (p.id === post.id ? post : p))
            : [post, ...previous]
        : previous.map((p) => (p.id === post.id ? post : p)),
    );
    setFocusedPost((previous) => (previous?.id === post.id ? post : previous));
  }
  function deletePost(postId: string) {
    setPosts((previous) => previous.filter((p) => p.id !== postId));
    setFocusedPost((previous) => (previous?.id === postId ? null : previous));
    setProfileVersion((version) => version + 1);
  }
  useEffect(() => {
    if (!socket || !userId) return;
    let active = true;
    const inFlight = new Set<string>();
    const dirty = new Set<string>();
    const change = ({ id, deletedCommentId }: { id: string; deletedCommentId?: string }): void => {
      window.dispatchEvent(
        new CustomEvent('po:post-changed', { detail: { id, deletedCommentId } }),
      );
      if (!knownPosts.current.has(id)) return;
      if (inFlight.has(id)) {
        dirty.add(id);
        return;
      }
      inFlight.add(id);
      void api<{ post: SocialPost }>(`/posts/${id}`)
        .then((data) => {
          if (!active) return;
          const merge = (old: SocialPost) => ({
            ...data.post,
            ...(optimisticLikes.current.has(id)
              ? { isLiked: old.isLiked, likeCount: old.likeCount }
              : {}),
          });
          setPosts((old) => old.map((p) => (p.id === id ? merge(p) : p)));
          setFocusedPost((old) => (old?.id === id ? merge(old) : old));
        })
        .catch((e) => {
          if (active && e instanceof ApiError && [403, 404].includes(e.status)) {
            setPosts((old) => old.filter((p) => p.id !== id));
            setFocusedPost((old) => (old?.id === id ? null : old));
          }
        })
        .finally(() => {
          inFlight.delete(id);
          if (dirty.delete(id) && active) change({ id });
        });
    };
    const remove = ({ id }: { id: string }) => {
      setPosts((old) => old.filter((p) => p.id !== id));
      setFocusedPost((old) => (old?.id === id ? null : old));
    };
    let feedLoading = false;
    const feedUpdate = () => {
      if (feedLoading || !['feed', 'profile'].includes(view)) return;
      feedLoading = true;
      const params = new URLSearchParams({
        search: keyword,
        feed: view === 'feed' ? feed : 'all',
        ...(view === 'profile' ? { author: profileId } : {}),
      });
      void api<{ posts: SocialPost[] }>(`/posts?${params}`)
        .then((data) => {
          if (active)
            setPosts((old) => [
              ...data.posts.map((p) => {
                const local = old.find((o) => o.id === p.id);
                return local && optimisticLikes.current.has(p.id)
                  ? { ...p, isLiked: local.isLiked, likeCount: local.likeCount }
                  : p;
              }),
              ...old.filter((p) => !data.posts.some((n) => n.id === p.id)),
            ]);
        })
        .catch(() => {})
        .finally(() => {
          feedLoading = false;
        });
    };
    const permissions = () => {
      void refreshBadges().catch((e) => notify(e.message));
      setFocusedPost(null);
      setRefresh((r) => r + 1);
      if (peer)
        void api(`/users/${peer.id}`).catch((e) => {
          if (active && e instanceof ApiError && [403, 404].includes(e.status)) setPeer(null);
        });
    };
    socket.on('post:changed', change);
    socket.on('post:deleted', remove);
    socket.on('feed:changed', feedUpdate);
    socket.on('permissions:changed', permissions);
    return () => {
      active = false;
      socket.off('post:changed', change);
      socket.off('post:deleted', remove);
      socket.off('feed:changed', feedUpdate);
      socket.off('permissions:changed', permissions);
    };
  }, [socket, userId, view, keyword, feed, profileId, peer, refreshBadges, notify]);
  const actionParams = new URLSearchParams(hash.slice(1));
  if (
    ['reset', 'verify', 'email'].includes(actionParams.get('action') || '') &&
    actionParams.get('token')
  )
    return (
      <AccountLink
        action={actionParams.get('action')!}
        token={actionParams.get('token')!}
        onDone={() => {
          history.replaceState(null, '', location.pathname);
          setHash('');
          boot();
        }}
      />
    );
  if (booting)
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    );
  if (bootError)
    return (
      <div className="boot">
        <Brand />
        <p>{bootError}</p>
        <button className="primary" onClick={() => void boot()}>
          Thử lại
        </button>
      </div>
    );
  if (!me)
    return (
      <AuthPage
        onAuth={(user) => {
          setMe(user);
          setView('feed');
          setSearch('');
          setKeyword('');
          setFocusedPost(null);
          setPeer(null);
          setFeed('all');
        }}
      />
    );
  const navItems = [
    { id: 'feed' as const, label: 'Bảng tin', icon: Home, badge: 0 },
    { id: 'discover' as const, label: 'Khám phá', icon: Compass, badge: 0 },
    { id: 'messages' as const, label: 'Tin nhắn', icon: MessageCircle, badge: unreadMessages },
    { id: 'notifications' as const, label: 'Thông báo', icon: Bell, badge: unread },
    { id: 'profile' as const, label: 'Trang cá nhân', icon: UserRound, badge: 0 },
  ];
  const title = {
    feed: 'Bảng tin',
    discover: 'Khám phá',
    notifications: 'Thông báo',
    messages: 'Tin nhắn',
    profile: 'Trang cá nhân',
    saved: 'Bài viết đã lưu',
  }[view];
  return (
    <div className={`app-layout ${mobileSearchOpen ? 'search-open' : ''}`} data-view={view}>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="brand-button"
              onClick={() => navigate('feed')}
              aria-label="Po - Trang chủ"
            >
              <Brand />
            </button>
            <label className="header-search">
              <Search size={19} />
              <input
                type="search"
                aria-label="Tìm kiếm trên Po"
                placeholder="Tìm kiếm trên Po"
                value={search}
                onChange={(event) => {
                  if (!['feed', 'discover', 'profile'].includes(view)) {
                    setView('feed');
                    setFocusedPost(null);
                  }
                  setSearch(event.target.value);
                }}
              />
            </label>
          </div>
          <nav className="header-nav" aria-label="Điều hướng chính">
            {navItems
              .filter((item) => item.id !== 'notifications')
              .map(({ id, label, icon: Icon, badge }) => (
                <button
                  key={id}
                  aria-label={label}
                  title={label}
                  className={view === id ? 'active' : ''}
                  onClick={() => navigate(id)}
                >
                  <Icon size={25} />
                  {badge > 0 && <b className="badge">{badge > 99 ? '99+' : badge}</b>}
                </button>
              ))}
          </nav>
          <div className="topbar-right">
            <button
              className="icon-button mobile-search-toggle"
              aria-label="Tìm kiếm bài viết"
              aria-expanded={mobileSearchOpen}
              onClick={() => {
                navigate('feed');
                setMobileSearchOpen((open) => !open);
                if (mobileSearchOpen) setSearch('');
              }}
            >
              {mobileSearchOpen ? <X size={20} /> : <Search size={20} />}
            </button>
            <Settings
              me={me}
              onBookmarks={() => navigate('saved')}
              onChanged={() => setRefresh((r) => r + 1)}
            >
              <div className="setting-row">
                <span>Giao diện sáng / tối</span>
                <ThemeToggle />
              </div>
              <div className="setting-row setting-install">
                <span>Cài Po lên thiết bị</span>
                <InstallApp />
              </div>
              <div className="setting-row">
                <span>Đăng xuất tài khoản</span>
                <button
                  className="icon-button"
                  aria-label="Đăng xuất"
                  title="Đăng xuất"
                  disabled={loggingOut}
                  onClick={async () => {
                    if (logoutLock.current) return;
                    logoutLock.current = true;
                    try {
                      if (
                        !(await confirm({
                          title: 'Đăng xuất khỏi Po?',
                          message: 'Bạn sẽ cần đăng nhập lại để tiếp tục sử dụng tài khoản.',
                          confirmLabel: 'Đăng xuất',
                        }))
                      )
                        return;
                      setLoggingOut(true);
                      setLogoutError('');
                      await api('/auth/logout', 'POST');
                      setMe(null);
                    } catch (error) {
                      setLogoutError((error as Error).message);
                      notify((error as Error).message);
                    } finally {
                      logoutLock.current = false;
                      setLoggingOut(false);
                    }
                  }}
                >
                  <LogOut size={20} />
                </button>
              </div>
              {logoutError && (
                <p role="alert" className="form-error">
                  {logoutError}
                </p>
              )}
            </Settings>
            <span className={`connection-state ${connected ? '' : 'offline'}`}>
              <span className="status-dot" />
              {connected ? 'Đã kết nối' : 'Đang kết nối lại'}
            </span>
            <button
              className="icon-button"
              aria-label="Mở tin nhắn"
              onClick={() => navigate('messages')}
            >
              <MessageCircle size={22} />
            </button>
            <button
              className="icon-button notification-icon"
              aria-label="Mở thông báo"
              onClick={() => navigate('notifications')}
            >
              <Bell size={20} />
              {unread > 0 && <span />}
            </button>
            <button
              className="avatar-button"
              onClick={() => openProfile(me.id)}
              aria-label="Hồ sơ của bạn"
            >
              <Avatar user={me} size="sm" />
            </button>
          </div>
        </header>
        <div className={`workspace ${view === 'messages' ? 'workspace-chat' : ''}`}>
          <main className="main-column">
            <div className="page-heading">
              <div>
                <h1>{view === 'feed' ? 'Bảng tin' : title}</h1>
                <p>
                  {view === 'feed'
                    ? 'Cập nhật từ bạn bè và những người bạn theo dõi.'
                    : view === 'discover'
                      ? 'Tìm những người cùng sở thích, thêm một kết nối mới.'
                      : view === 'messages'
                        ? 'Giữ cuộc trò chuyện luôn tiếp nối.'
                        : view === 'notifications'
                          ? 'Những tương tác nhỏ, niềm vui mỗi ngày.'
                          : view === 'saved'
                            ? 'Những bài viết bạn muốn xem lại.'
                            : 'Một góc nhỏ kể câu chuyện của bạn.'}
                </p>
              </div>
            </div>
            {focusedPost ? (
              <>
                <button className="text-button back-link" onClick={() => setFocusedPost(null)}>
                  <ArrowLeft size={16} />
                  Quay lại
                </button>
                <FeedPost
                  key={`${focusedPost.id}:${actionParams.get('comment') || ''}`}
                  post={focusedPost}
                  me={me}
                  onChange={updatePost}
                  onDelete={deletePost}
                  onProfile={openProfile}
                  onError={notify}
                  initialCommentId={actionParams.get('comment') || undefined}
                />
              </>
            ) : (
              <>
                {(view === 'feed' || view === 'discover' || view === 'profile') && (
                  <div className="search-field">
                    <Search size={18} />
                    <input
                      type="search"
                      aria-label="Tìm kiếm"
                      placeholder={
                        view === 'discover'
                          ? 'Tìm tên hoặc tên người dùng…'
                          : 'Tìm câu chuyện, tên tác giả…'
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Xóa tìm kiếm"
                        onClick={() => setSearch('')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                )}
                {view === 'profile' && (
                  <Profile
                    key={`${profileId}:${refresh + profileVersion}`}
                    userId={profileId}
                    me={me}
                    onMe={setMe}
                    onChat={openChat}
                    onFollow={follow}
                    onError={notify}
                    onProfile={openProfile}
                    onBlocked={() => {
                      navigate('feed');
                      setRefresh((r) => r + 1);
                    }}
                  />
                )}
                {view === 'feed' && (
                  <Composer
                    user={me}
                    onError={notify}
                    onCreated={(post) => {
                      setPosts((previous) => [post, ...previous.filter((p) => p.id !== post.id)]);
                      setSearch('');
                      setKeyword('');
                      if (keyword || feed === 'following') {
                        setFeed('all');
                        setRefresh((r) => r + 1);
                      }
                      notify('Đã chia sẻ câu chuyện của bạn.');
                    }}
                  />
                )}
                {(view === 'feed' || view === 'profile' || view === 'saved') && (
                  <>
                    <div className="feed-heading">
                      {view === 'feed' ? (
                        <div className="feed-tabs">
                          <button
                            className={feed === 'all' ? 'active' : ''}
                            onClick={() => setFeed('all')}
                          >
                            <Sparkles size={15} />
                            Dành cho bạn
                          </button>
                          <button
                            className={feed === 'following' ? 'active' : ''}
                            onClick={() => setFeed('following')}
                          >
                            <Users size={15} />
                            Đang theo dõi
                          </button>
                        </div>
                      ) : (
                        <h3>Bài viết</h3>
                      )}
                      <span>Mới nhất</span>
                    </div>
                    {feedLoading && visiblePosts.length === 0 ? (
                      <Loading />
                    ) : !visiblePosts.length ? (
                      <Empty
                        title={
                          view === 'saved'
                            ? 'Chưa có bài viết đã lưu'
                            : keyword
                              ? 'Chưa tìm thấy câu chuyện'
                              : 'Một khởi đầu mới'
                        }
                        text={
                          view === 'saved'
                            ? 'Bấm Lưu trên một bài viết để xem lại ở đây.'
                            : keyword
                              ? 'Thử một từ khóa khác nhé.'
                              : feed === 'following' && view === 'feed'
                                ? 'Theo dõi một vài người hoặc chia sẻ bài viết đầu tiên của bạn.'
                                : 'Chưa có bài viết nào. Chia sẻ một điều nhỏ hôm nay nhé!'
                        }
                      />
                    ) : (
                      <div className="feed-list">
                        {visiblePosts.map((post) => (
                          <FeedPost
                            key={post.id}
                            post={post}
                            me={me}
                            onChange={updatePost}
                            onDelete={deletePost}
                            onProfile={openProfile}
                            onError={notify}
                          />
                        ))}
                      </div>
                    )}
                    {hasMore && loadedFeedKey === feedKey && (
                      <button
                        className="secondary load-more"
                        disabled={loading}
                        onClick={async () => {
                          const request = feedRequest.current;
                          setLoading(true);
                          try {
                            const params = new URLSearchParams({
                              page: String(page + 1),
                              feed: view === 'feed' ? feed : 'all',
                              search: keyword,
                              ...(view === 'profile' ? { author: profileId } : {}),
                            });
                            const data = await api<{ posts: SocialPost[]; hasMore: boolean }>(
                              view === 'saved' ? `/bookmarks?page=${page + 1}` : `/posts?${params}`,
                            );
                            if (request !== feedRequest.current) return;
                            setPosts((previous) => [
                              ...previous,
                              ...data.posts.filter((p) => !previous.some((x) => x.id === p.id)),
                            ]);
                            setPage((p) => p + 1);
                            setHasMore(data.hasMore);
                          } catch (e) {
                            notify((e as Error).message);
                          } finally {
                            if (request === feedRequest.current) setLoading(false);
                          }
                        }}
                      >
                        {loading ? 'Đang tải…' : 'Xem thêm câu chuyện'}
                      </button>
                    )}
                  </>
                )}
                {view === 'discover' && (
                  <div className="people-grid">
                    {people.length ? (
                      people.map((user) => (
                        <article className="card person-card" key={user.id}>
                          <button className="person-profile" onClick={() => openProfile(user.id)}>
                            <Avatar user={user} size="lg" />
                            <h3>{user.name}</h3>
                            <span>@{user.username}</span>
                          </button>
                          <p>{user.bio || 'Một người bạn mới đang chờ kết nối.'}</p>
                          <small>{user.followers || 0} người theo dõi</small>
                          <div className="flex-row">
                            <button
                              className={user.isFollowing ? 'secondary' : 'primary'}
                              disabled={pendingFollow.includes(user.id)}
                              onClick={() => void follow(user).catch((e) => notify(e.message))}
                            >
                              {user.isFollowing
                                ? 'Đang theo dõi'
                                : user.requested
                                  ? 'Đã gửi yêu cầu'
                                  : 'Theo dõi'}
                            </button>
                            <button
                              className="secondary"
                              aria-label={`Nhắn tin cho ${user.name}`}
                              onClick={() => openChat(user)}
                            >
                              <MessageCircle size={17} />
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <Empty
                        title="Chưa tìm thấy người dùng"
                        text="Mời một người bạn đăng ký hoặc thử một tên khác."
                      />
                    )}
                  </div>
                )}
                {view === 'notifications' && (
                  <>
                    <div className="section-toolbar notification-toolbar">
                      <span>{unread} thông báo chưa đọc</span>
                      <button
                        className="text-button"
                        disabled={unread === 0 || readingNotices}
                        onClick={async () => {
                          if (readingNotices) return;
                          setReadingNotices(true);
                          try {
                            await api('/notifications/read', 'PATCH');
                            await refreshBadges();
                          } catch (e) {
                            notify((e as Error).message);
                          } finally {
                            setReadingNotices(false);
                          }
                        }}
                      >
                        <CheckCheck size={16} />
                        Đọc tất cả
                      </button>
                    </div>
                    {notices.length ? (
                      <div className="card notifications-list">
                        {notices.map((n) => (
                          <button
                            className={`notice ${n.readAt ? '' : 'unread'}`}
                            key={n.id}
                            onClick={async () => {
                              try {
                                if (!n.readAt) {
                                  await api(`/notifications/${n.id}/read`, 'PATCH');
                                  setNotices((previous) =>
                                    previous.map((notice) =>
                                      notice.id === n.id
                                        ? { ...notice, readAt: new Date().toISOString() }
                                        : notice,
                                    ),
                                  );
                                  await refreshBadges();
                                }
                                if (n.kind === 'request') {
                                  window.dispatchEvent(new Event('po:open-settings'));
                                  return;
                                }
                                if (!n.postId) return openProfile(n.actor.id);
                                window.location.hash = `post=${n.postId}${n.commentId ? '&comment=' + n.commentId : ''}`;
                              } catch (e) {
                                notify((e as Error).message);
                              }
                            }}
                          >
                            <span className={`notice-avatar notice-kind-${n.kind}`}>
                              <Avatar user={n.actor} />
                              <span className="notice-kind" aria-hidden="true">
                                {n.kind === 'like' ? (
                                  <Heart size={12} />
                                ) : n.kind === 'comment' || n.kind === 'reply' ? (
                                  <MessageCircle size={12} />
                                ) : (
                                  <Users size={12} />
                                )}
                              </span>
                            </span>
                            <span className="notice-content">
                              <p>
                                <strong>{n.actor.name}</strong>{' '}
                                {n.kind === 'like'
                                  ? 'đã thích bài viết của bạn.'
                                  : n.kind === 'comment'
                                    ? 'đã bình luận về bài viết của bạn.'
                                    : n.kind === 'reply'
                                      ? 'đã trả lời bình luận của bạn.'
                                      : n.kind === 'request'
                                        ? 'đã gửi yêu cầu theo dõi bạn.'
                                        : 'đã bắt đầu theo dõi bạn.'}
                              </p>
                              <small>{timeAgo(n.createdAt)}</small>
                            </span>
                            {!n.readAt && <i />}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="Mọi thứ đang yên ắng"
                        text="Khi có người tương tác, bạn sẽ nhận được thông báo tại đây."
                      />
                    )}
                    {moreNotices && (
                      <button
                        className="secondary load-more"
                        disabled={loadingNotices}
                        onClick={async () => {
                          if (loadingNotices) return;
                          setLoadingNotices(true);
                          try {
                            const data = await api<{ notifications: Notice[]; hasMore: boolean }>(
                              `/notifications?page=${noticePage + 1}`,
                            );
                            setNotices((prev) => [
                              ...prev,
                              ...data.notifications.filter((n) => !prev.some((x) => x.id === n.id)),
                            ]);
                            setMoreNotices(data.hasMore);
                            setNoticePage((p) => p + 1);
                          } catch (e) {
                            notify((e as Error).message);
                          } finally {
                            setLoadingNotices(false);
                          }
                        }}
                      >
                        Xem thông báo trước
                      </button>
                    )}
                  </>
                )}
                {view === 'messages' && (
                  <Chat
                    key={peer?.id || 'inbox'}
                    me={me}
                    socket={socket}
                    initialPeer={peer}
                    onError={notify}
                    onRead={handleRead}
                  />
                )}
              </>
            )}
          </main>
          {view !== 'messages' && (
            <aside className="right-column">
              <section className="contacts-section">
                <div className="section-title">
                  <h3>Người liên hệ</h3>
                  <MessageCircle size={19} />
                </div>
                {people.slice(0, 6).map((user) => (
                  <button
                    className="contact-row user-link"
                    key={user.id}
                    onClick={() => openChat(user)}
                  >
                    <span className="contact-avatar">
                      <Avatar user={user} />
                      {online.includes(user.id) && <i className="online-dot" />}
                    </span>
                    <span>
                      <strong>{user.name}</strong>
                      <small>Nhắn tin</small>
                    </span>
                  </button>
                ))}
                {!people.length && (
                  <p className="small muted">Khám phá mọi người để bắt đầu cuộc trò chuyện.</p>
                )}
                <button className="text-button" onClick={() => navigate('discover')}>
                  Tìm bạn mới <ArrowUpRight size={16} />
                </button>
              </section>
              <section className="card suggestions">
                <div className="section-title">
                  <h3>Những người bạn có thể biết</h3>
                  <Users size={17} />
                </div>
                {people.slice(0, 4).map((user) => (
                  <div className="suggestion" key={user.id}>
                    <button className="user-link" onClick={() => openProfile(user.id)}>
                      <Avatar user={user} size="sm" />
                      <span>
                        <strong>{user.name}</strong>
                        <small>@{user.username}</small>
                      </span>
                    </button>
                    <button
                      className={`follow-small ${user.isFollowing ? 'following' : ''}`}
                      disabled={pendingFollow.includes(user.id)}
                      onClick={() => void follow(user).catch((e) => notify(e.message))}
                    >
                      {user.isFollowing
                        ? 'Đã theo dõi'
                        : user.requested
                          ? 'Đã gửi yêu cầu'
                          : 'Theo dõi'}
                    </button>
                  </div>
                ))}
                {!people.length && (
                  <p className="small muted">
                    Cộng đồng đang chờ những người bạn đầu tiên. Mời bạn bè cùng tham gia nhé.
                  </p>
                )}
                <button className="suggestions-more" onClick={() => navigate('discover')}>
                  Khám phá mọi người <ArrowUpRight size={15} />
                </button>
              </section>
              <footer className="site-footer">
                Po · Không gian kết nối của bạn
                <br />
                <span>Được tạo nên từ những câu chuyện nhỏ.</span>
              </footer>
            </aside>
          )}
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button className="icon-button" aria-label="Đóng thông báo" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <nav className="mobile-nav" aria-label="Điều hướng di động">
        {navItems.map(({ id, label, icon: Icon, badge }) => (
          <button
            key={id}
            aria-label={label}
            title={label}
            aria-current={view === id ? 'page' : undefined}
            className={view === id ? 'active' : ''}
            onClick={() => navigate(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
            {badge > 0 && <i />}
          </button>
        ))}
      </nav>
    </div>
  );
}

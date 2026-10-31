import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Camera, MessageCircle, Pencil } from 'lucide-react';
import type { User } from '../types/social';
import { api, uploadImage } from '../lib/api';
import { Avatar, Loading, Empty } from './ui';
import { useConfirm } from '../lib/confirmation';
import Relationships from './Relationships';
import { ReportButton } from './PostFeatures';

export default function Profile({
  userId,
  me,
  onMe,
  onChat,
  onFollow,
  onError,
  onProfile,
  onBlocked,
}: {
  userId: string;
  me: User;
  onMe: (user: User) => void;
  onChat: (user: User) => void;
  onFollow: (user: User) => Promise<{ following: boolean; requested?: boolean }>;
  onError: (message: string) => void;
  onProfile: (id: string) => void;
  onBlocked: () => void;
}) {
  const confirm = useConfirm();
  const actionLock = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [relationship, setRelationship] = useState<'followers' | 'following' | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState<{ id: string; url: string } | null>(null);
  async function cancelEdit() {
    if (busy) return;
    if (
      (dirty || avatar) &&
      !(await confirm({
        title: 'Bỏ thay đổi hồ sơ?',
        message: 'Những thay đổi chưa lưu sẽ bị mất.',
        confirmLabel: 'Bỏ thay đổi',
      }))
    )
      return;
    setEditing(false);
    setAvatar(null);
    setDirty(false);
  }
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: User }>(`/users/${userId}`, 'GET', undefined, controller.signal)
      .then((data) => setUser(data.user))
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError(e.message);
          onError(e.message);
        }
      });
    return () => controller.abort();
  }, [userId, onError]);
  if (!user) return error ? <Empty title="Hồ sơ không khả dụng" text={error} /> : <Loading />;
  return (
    <section className="card profile-card">
      <div className="profile-cover">
        {user.cover && (
          <img className="cover-image" src={user.cover} alt={`Ảnh bìa của ${user.name}`} />
        )}{' '}
        {user.id === me.id && (
          <label className="cover-upload">
            <Camera size={16} />
            Đổi ảnh bìa
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  const asset = await uploadImage(file);
                  const data = await api<{ cover: string }>('/account/cover', 'PATCH', {
                    uploadId: asset.id,
                  });
                  setUser({ ...user, cover: data.cover });
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        )}
      </div>
      <div className="profile-body">
        <div className="profile-top">
          <Avatar user={{ ...user, avatar: avatar?.url || user.avatar }} size="lg" />
          <div className="profile-buttons">
            {user.id === me.id ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (editing) {
                    void cancelEdit();
                    return;
                  }
                  setAvatar(null);
                  setDirty(false);
                  setEditing(true);
                }}
              >
                <Pencil size={15} />
                Chỉnh sửa hồ sơ
              </button>
            ) : (
              <>
                <button className="secondary" onClick={() => onChat(user)}>
                  <MessageCircle size={16} />
                  Nhắn tin
                </button>
                <button
                  className={user.isFollowing ? 'secondary' : 'primary'}
                  disabled={busy}
                  onClick={async () => {
                    if (actionLock.current) return;
                    actionLock.current = true;
                    const previous = user;
                    setBusy(true);
                    setUser({
                      ...user,
                      isFollowing: !user.isFollowing,
                      followers: Math.max(0, (user.followers || 0) + (user.isFollowing ? -1 : 1)),
                    });
                    try {
                      const result = await onFollow(user);
                      setUser({
                        ...previous,
                        isFollowing: result.following,
                        requested: result.requested,
                        followers: Math.max(
                          0,
                          (previous.followers || 0) +
                            Number(result.following) -
                            Number(Boolean(previous.isFollowing)),
                        ),
                      });
                    } catch (e) {
                      setUser(previous);
                      onError((e as Error).message);
                    } finally {
                      actionLock.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  {user.isFollowing
                    ? 'Đang theo dõi'
                    : user.requested
                      ? 'Đã gửi yêu cầu'
                      : 'Theo dõi'}
                </button>
                <ReportButton userId={user.id} />
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Chặn ${user.name}?`,
                        message: 'Hai người sẽ không thể xem bài hoặc nhắn tin cho nhau.',
                        confirmLabel: 'Chặn',
                        danger: true,
                      }))
                    )
                      return;
                    setBusy(true);
                    try {
                      await api(`/users/${user.id}/block`, 'PUT', { blocked: true });
                      onBlocked();
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Chặn
                </button>
              </>
            )}
          </div>
        </div>
        {editing ? (
          <form
            className="profile-edit"
            onChange={() => setDirty(true)}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy || actionLock.current) return;
              actionLock.current = true;
              const values = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              try {
                const data = await api<{ user: User }>('/users/me', 'PATCH', {
                  ...values,
                  avatarUploadId: avatar?.id,
                });
                onMe(data.user);
                setUser({ ...user, ...data.user });
                setEditing(false);
                setAvatar(null);
                setDirty(false);
              } catch (error) {
                onError((error as Error).message);
              } finally {
                actionLock.current = false;
                setBusy(false);
              }
            }}
          >
            <label className="upload-avatar">
              <Camera size={16} />
              Đổi ảnh đại diện
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setBusy(true);
                  try {
                    setAvatar(await uploadImage(file));
                  } catch (error) {
                    onError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
            <label>
              Tên hiển thị
              <input name="name" defaultValue={user.name} required maxLength={80} disabled={busy} />
            </label>
            <label>
              Giới thiệu
              <textarea
                name="bio"
                disabled={busy}
                defaultValue={user.bio}
                maxLength={300}
                placeholder="Một chút về bạn…"
              />
            </label>
            <div className="flex-row">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void cancelEdit()}
              >
                Hủy
              </button>
              <button className="primary" disabled={busy}>
                Lưu thay đổi
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2>{user.name}</h2>
            {user.isPrivate && <p className="private-label">Tài khoản riêng tư</p>}
            <p className="muted">@{user.username}</p>
            {user.bio && <p className="profile-bio">{user.bio}</p>}
            <div className="profile-meta">
              <CalendarDays size={14} />
              Tham gia{' '}
              {new Date(user.createdAt).toLocaleDateString('vi-VN', {
                month: 'numeric',
                year: 'numeric',
              })}
            </div>
            <div className="profile-stats">
              <span>
                <strong>{user.postCount || 0}</strong> bài viết
              </span>
              <button className="profile-stat-button" onClick={() => setRelationship('followers')}>
                <strong>{user.followers || 0}</strong> người theo dõi
              </button>
              <button className="profile-stat-button" onClick={() => setRelationship('following')}>
                <strong>{user.following || 0}</strong> đang theo dõi
              </button>
            </div>
          </>
        )}
      </div>
      {relationship && (
        <Relationships
          key={`${userId}:${relationship}`}
          userId={userId}
          kind={relationship}
          onClose={() => setRelationship(null)}
          onProfile={onProfile}
        />
      )}
    </section>
  );
}

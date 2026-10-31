import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { clearDrafts } from '../lib/drafts';
import { useConfirm } from '../lib/confirmation';
import type { User } from '../types/social';
import { Avatar, Loading } from './ui';

type Account = {
  email: string;
  emailVerified: boolean;
  isPrivate: boolean;
  emailConfigured: boolean;
  isAdmin: boolean;
};
type Report = {
  id: string;
  reason: string;
  status: string;
  target_user_id: string | null;
  post_id: string | null;
  post_content: string | null;
  target_username: string | null;
  post_media?: { url: string; kind: string }[];
  post_image?: string;
};
export default function AccountPanel({
  me,
  onSaved,
  initialTab = '',
}: {
  me: User;
  onSaved: () => void;
  initialTab?: string;
}) {
  const confirm = useConfirm();
  const [account, setAccount] = useState<Account | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(initialTab),
    [blocked, setBlocked] = useState<User[]>([]),
    [requests, setRequests] = useState<User[]>([]),
    [reports, setReports] = useState<Report[]>([]),
    [reportPage, setReportPage] = useState(1),
    [reportMore, setReportMore] = useState(false);
  const [pushState, setPushState] = useState<{ enabled: boolean; active: boolean }>({
    enabled: false,
    active: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    api<Account>('/account', 'GET', undefined, controller.signal)
      .then(setAccount)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(next: string) {
    setTab(next);
    await perform(async () => {
      if (next === 'blocked') setBlocked((await api<{ users: User[] }>('/account/blocks')).users);
      if (next === 'requests')
        setRequests((await api<{ users: User[] }>('/account/requests')).users);
      if (next === 'admin') {
        const data = await api<{ reports: Report[]; hasMore: boolean }>('/admin/reports');
        setReports(data.reports);
        setReportPage(1);
        setReportMore(data.hasMore);
      }
      if (next === 'push') {
        const config = await api<{ enabled: boolean }>('/push/config');
        const registration = await navigator.serviceWorker?.getRegistration();
        const sub = await registration?.pushManager?.getSubscription();
        setPushState({ enabled: config.enabled, active: Boolean(sub) });
      }
    });
  }
  useEffect(() => {
    if (initialTab === 'requests') {
      const controller = new AbortController();
      void api<{ users: User[] }>('/account/requests', 'GET', undefined, controller.signal)
        .then((data) => setRequests(data.users))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
      return () => controller.abort();
    }
  }, [initialTab]);
  const form = (
    action: (values: Record<string, FormDataEntryValue>) => Promise<void>,
    children: React.ReactNode,
  ) => (
    <form
      className="account-form"
      onSubmit={(e) => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.currentTarget));
        void perform(() => action(values));
      }}
    >
      {children}
      <button className="primary" disabled={busy || (tab === 'email' && !account?.emailConfigured)}>
        Lưu thay đổi
      </button>
    </form>
  );
  if (!account) return <>{error ? <p role="alert">{error}</p> : <Loading />}</>;
  return (
    <section className="account-panel">
      <h3>Tài khoản & quyền riêng tư</h3>
      <p className="account-id">
        Mã tài khoản: <code>{me.id}</code>
      </p>
      <div className="settings-nav">
        {[
          ['password', 'Đổi mật khẩu'],
          ['email', 'Email'],
          ['privacy', 'Quyền riêng tư'],
          ['requests', 'Yêu cầu theo dõi'],
          ['blocked', 'Đã chặn'],
          ['push', 'Thông báo đẩy'],
          ['drafts', 'Bản nháp'],
          ...(account.isAdmin ? [['admin', 'Quản trị']] : []),
          ['delete', 'Xóa tài khoản'],
        ].map(([value, label]) => (
          <button
            className={tab === value ? 'active' : ''}
            key={value}
            disabled={busy}
            onClick={() => void open(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="account-status">
          {message}
        </p>
      )}
      {tab === 'password' &&
        form(
          async (values) => {
            if (values.password !== values.repeat) throw new Error('Mật khẩu mới chưa khớp.');
            await api('/account/password', 'POST', {
              currentPassword: values.currentPassword,
              password: values.password,
            });
            window.location.reload();
          },
          <>
            <label>
              Mật khẩu hiện tại
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={72}
              />
            </label>
            <label>
              Mật khẩu mới
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
              />
            </label>
            <label>
              Nhập lại mật khẩu mới
              <input name="repeat" type="password" autoComplete="new-password" required />
            </label>
          </>,
        )}
      {tab === 'email' && (
        <>
          <p>
            {account.email} · {account.emailVerified ? 'Đã xác minh' : 'Chưa xác minh'}
          </p>
          {!account.emailConfigured && <p className="muted">Server chưa bật gửi email.</p>}
          <button
            className="secondary"
            disabled={busy || !account.emailConfigured || account.emailVerified}
            onClick={() =>
              void perform(async () => {
                await api('/account/verification', 'POST');
                setMessage('Đã gửi liên kết xác minh.');
              })
            }
          >
            Gửi email xác minh
          </button>
          {form(
            async (values) => {
              await api('/account/email', 'POST', {
                email: values.email,
                password: values.password,
              });
              setMessage('Kiểm tra hộp thư mới để xác nhận đổi email.');
            },
            <>
              <label>
                Email mới
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  disabled={!account.emailConfigured}
                />
              </label>
              <label>
                Mật khẩu hiện tại
                <input
                  name="password"
                  type="password"
                  required
                  maxLength={72}
                  disabled={!account.emailConfigured}
                />
              </label>
            </>,
          )}
        </>
      )}
      {tab === 'privacy' && (
        <div className="privacy-option">
          <p>
            Ở chế độ riêng tư, chỉ bạn và người đã được duyệt theo dõi mới xem được bài viết của
            bạn. Ảnh đại diện, ảnh bìa, tên và giới thiệu vẫn công khai.
          </p>
          <button
            role="switch"
            aria-checked={account.isPrivate}
            className="secondary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const result = await api<{ isPrivate: boolean }>('/account/privacy', 'PATCH', {
                  isPrivate: !account.isPrivate,
                });
                setAccount({ ...account, isPrivate: result.isPrivate });
                onSaved();
              })
            }
          >
            {account.isPrivate ? 'Tài khoản riêng tư' : 'Tài khoản công khai'}
          </button>
        </div>
      )}
      {tab === 'requests' && (
        <div className="relationship-list">
          {requests.map((user) => (
            <div className="account-user" key={user.id}>
              <Avatar user={user} />
              <span>{user.name}</span>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api(`/account/requests/${user.id}`, 'PUT', { accept: true });
                    setRequests((old) => old.filter((u) => u.id !== user.id));
                    onSaved();
                  })
                }
              >
                Duyệt
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api(`/account/requests/${user.id}`, 'PUT', { accept: false });
                    setRequests((old) => old.filter((u) => u.id !== user.id));
                  })
                }
              >
                Từ chối
              </button>
            </div>
          ))}
          {!busy && !requests.length && <p className="dialog-empty">Không có yêu cầu theo dõi.</p>}
        </div>
      )}
      {tab === 'blocked' && (
        <div className="relationship-list">
          {blocked.map((user) => (
            <div className="account-user" key={user.id}>
              <Avatar user={user} />
              <span>{user.name}</span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api(`/users/${user.id}/block`, 'PUT', { blocked: false });
                    setBlocked((old) => old.filter((u) => u.id !== user.id));
                    onSaved();
                  })
                }
              >
                Bỏ chặn
              </button>
            </div>
          ))}
          {!busy && !blocked.length && <p className="dialog-empty">Bạn chưa chặn ai.</p>}
        </div>
      )}
      {tab === 'drafts' && (
        <>
          <p>Bản nháp được lưu trên trình duyệt này theo từng tài khoản.</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Xóa các bản nháp?',
                  message: 'Xóa bản nháp bài viết, bình luận và tin nhắn trên thiết bị này.',
                  confirmLabel: 'Xóa bản nháp',
                })
              ) {
                clearDrafts(me.id);
                setMessage('Đã xóa bản nháp. Tải lại trang để bỏ nội dung đang mở.');
              }
            }}
          >
            Xóa bản nháp trên thiết bị
          </button>
        </>
      )}
      {tab === 'push' && (
        <>
          <p>
            Nhận thông báo khi đóng Po. Trên iPhone, mở Po từ biểu tượng đã thêm vào Màn hình chính.
          </p>
          {!pushState.enabled && <p className="muted">Server chưa bật khóa thông báo đẩy.</p>}
          <button
            className="secondary"
            disabled={busy || !pushState.enabled || !('PushManager' in window)}
            onClick={() =>
              void perform(async () => {
                const registration = await navigator.serviceWorker?.getRegistration();
                if (!registration)
                  throw new Error('Hãy mở bản HTTPS/PWA đã triển khai để bật thông báo.');
                if (pushState.active) {
                  const subscription = await registration.pushManager.getSubscription();
                  if (subscription) {
                    await api('/push/subscriptions', 'DELETE', { endpoint: subscription.endpoint });
                    await subscription.unsubscribe();
                  }
                  setPushState((old) => ({ ...old, active: false }));
                  return;
                }
                const config = await api<{ publicKey: string }>('/push/config');
                if ((await Notification.requestPermission()) !== 'granted')
                  throw new Error('Bạn chưa cho phép thông báo trong trình duyệt.');
                const base64 = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
                const raw = atob(base64);
                const key = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
                const subscription = await registration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: key,
                });
                try {
                  await api('/push/subscriptions', 'POST', subscription.toJSON());
                } catch (e) {
                  await subscription.unsubscribe();
                  throw e;
                }
                setPushState((old) => ({ ...old, active: true }));
              })
            }
          >
            {pushState.active ? 'Tắt thông báo trên thiết bị' : 'Bật thông báo trên thiết bị'}
          </button>
        </>
      )}
      {tab === 'delete' &&
        form(
          async (values) => {
            if (
              !(await confirm({
                title: 'Xóa vĩnh viễn tài khoản?',
                message:
                  'Bài viết, bình luận, tin nhắn và dữ liệu tài khoản sẽ bị xóa. Không thể hoàn tác.',
                confirmLabel: 'Xóa tài khoản',
                danger: true,
              }))
            )
              return;
            await api('/account', 'DELETE', { password: values.password });
            clearDrafts(me.id);
            window.location.reload();
          },
          <label>
            Nhập mật khẩu để xác nhận
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={72}
            />
          </label>,
        )}
      {tab === 'admin' && (
        <div className="admin-reports">
          {reports.map((report) => (
            <article className="report-card" key={report.id}>
              <strong>{report.target_username || report.post_content || 'Nội dung báo cáo'}</strong>
              <p>{report.reason}</p>
              {report.post_content && (
                <blockquote className="report-evidence">{report.post_content}</blockquote>
              )}
              <div className="report-media">
                {(report.post_media?.length
                  ? report.post_media
                  : report.post_image
                    ? [{ url: report.post_image, kind: 'image' }]
                    : []
                ).map((media, index) =>
                  media.kind === 'video' ? (
                    <video src={media.url} controls playsInline preload="metadata" key={index} />
                  ) : (
                    <img src={media.url} alt="Ảnh trong nội dung bị báo cáo" key={index} />
                  ),
                )}
              </div>
              <small>{report.status}</small>
              <div className="flex-row">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api(`/admin/reports/${report.id}`, 'PATCH', { status: 'resolved' });
                      setReports((old) =>
                        old.map((r) => (r.id === report.id ? { ...r, status: 'resolved' } : r)),
                      );
                    })
                  }
                >
                  Đã xử lý
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api(`/admin/reports/${report.id}`, 'PATCH', { status: 'dismissed' });
                      setReports((old) =>
                        old.map((r) => (r.id === report.id ? { ...r, status: 'dismissed' } : r)),
                      );
                    })
                  }
                >
                  Bỏ qua
                </button>
                {report.post_id && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        if (
                          await confirm({
                            title: 'Gỡ bài viết?',
                            message: 'Gỡ nội dung bị báo cáo khỏi Po.',
                            confirmLabel: 'Gỡ bài',
                            danger: true,
                          })
                        ) {
                          await api(`/admin/posts/${report.post_id}`, 'DELETE');
                          setReports((old) => old.filter((r) => r.id !== report.id));
                          onSaved();
                        }
                      })
                    }
                  >
                    Gỡ bài
                  </button>
                )}
                {report.target_user_id && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        if (
                          await confirm({
                            title: 'Khóa người dùng?',
                            message: 'Người dùng sẽ bị đăng xuất và không thể đăng nhập.',
                            confirmLabel: 'Khóa',
                            danger: true,
                          })
                        )
                          await api(`/admin/users/${report.target_user_id}/ban`, 'PUT', {
                            banned: true,
                          });
                      })
                    }
                  >
                    Khóa tài khoản
                  </button>
                )}
                {report.target_user_id && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api(`/admin/users/${report.target_user_id}/ban`, 'PUT', {
                          banned: false,
                        });
                        setMessage('Đã mở khóa tài khoản.');
                      })
                    }
                  >
                    Mở khóa tài khoản
                  </button>
                )}
              </div>
            </article>
          ))}
          {!reports.length && <p>Chưa có báo cáo.</p>}
          {reportMore && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const data = await api<{ reports: Report[]; hasMore: boolean }>(
                    `/admin/reports?page=${reportPage + 1}`,
                  );
                  setReports((old) => [...old, ...data.reports]);
                  setReportPage((p) => p + 1);
                  setReportMore(data.hasMore);
                })
              }
            >
              Xem thêm
            </button>
          )}
        </div>
      )}
    </section>
  );
}

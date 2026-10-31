import { useState } from 'react';
import { api } from '../lib/api';
import { Brand } from './ui';
import Modal from './Modal';
export function ForgotPassword({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <Modal title="Quên mật khẩu" onClose={onClose}>
      <form
        className="account-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const data = await api<{ message: string }>('/auth/forgot-password', 'POST', { email });
            setMessage(data.message);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email đăng ký
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
        </label>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || Boolean(message)}>
          {busy ? 'Đang gửi…' : 'Gửi liên kết đặt lại'}
        </button>
      </form>
    </Modal>
  );
}
export default function AccountLink({
  action,
  token,
  onDone,
}: {
  action: string;
  token: string;
  onDone: () => void;
}) {
  const [password, setPassword] = useState(''),
    [repeat, setRepeat] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState(false),
    [error, setError] = useState('');
  return (
    <main className="account-link-page">
      <Brand />
      <section className="card account-link-card">
        <h1>{action === 'reset' ? 'Đặt lại mật khẩu' : 'Xác minh email'}</h1>
        {success ? (
          <>
            <p>Đã hoàn tất. Bạn có thể quay lại Po.</p>
            <button className="primary" onClick={onDone}>
              Quay lại Po
            </button>
          </>
        ) : (
          <form
            className="account-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              if (action === 'reset' && password !== repeat) {
                setError('Hai mật khẩu chưa khớp.');
                return;
              }
              setBusy(true);
              setError('');
              try {
                await api(
                  action === 'reset' ? '/auth/reset-password' : '/auth/verify-email',
                  'POST',
                  { token, ...(action === 'reset' ? { password } : {}) },
                );
                setSuccess(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {action === 'reset' && (
              <>
                <label>
                  Mật khẩu mới
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label>
                  Nhập lại mật khẩu
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Đang xử lý…' : 'Xác nhận'}
            </button>
            <button type="button" className="secondary" onClick={onDone}>
              Quay lại
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

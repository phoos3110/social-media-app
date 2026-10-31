import { useState } from 'react';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import type { User } from '../types/social';
import { Brand } from './ui';
import { ThemeToggle } from './Theme';

export default function AuthPage({ onAuth }: { onAuth: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="auth-layout">
      <ThemeToggle className="auth-theme-toggle" />
      <section className="auth-story">
        <Brand />
        <div className="auth-copy">
          <p>Kết nối với bạn bè và chia sẻ những khoảnh khắc trong cuộc sống của bạn.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">
          <h2>{register ? 'Bắt đầu câu chuyện của bạn' : 'Rất vui được gặp lại bạn'}</h2>
          <p>
            {register
              ? 'Tạo tài khoản và tìm những kết nối mới.'
              : 'Đăng nhập để xem hôm nay mọi người có gì mới.'}
          </p>
          <div className="auth-tabs">
            <button
              disabled={busy}
              className={!register ? 'active' : ''}
              onClick={() => {
                setRegister(false);
                setError('');
              }}
            >
              Đăng nhập
            </button>
            <button
              disabled={busy}
              className={register ? 'active' : ''}
              onClick={() => {
                setRegister(true);
                setError('');
              }}
            >
              Đăng ký
            </button>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              const values = Object.fromEntries(new FormData(event.currentTarget));
              try {
                const { user } = await api<{ user: User }>(
                  `/auth/${register ? 'register' : 'login'}`,
                  'POST',
                  values,
                );
                onAuth(user);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {register && (
              <>
                <label>
                  Tên hiển thị
                  <input
                    name="name"
                    disabled={busy}
                    autoComplete="name"
                    placeholder="Bạn muốn mọi người gọi mình là gì?"
                    required
                    maxLength={80}
                  />
                </label>
                <label>
                  Tên người dùng
                  <input
                    name="username"
                    disabled={busy}
                    autoComplete="username"
                    placeholder="vd: minhan_"
                    pattern="[a-z0-9_]{3,30}"
                    title="3–30 chữ thường, số hoặc dấu gạch dưới"
                    required
                  />
                </label>
              </>
            )}
            <label>
              Email
              <input
                name="email"
                disabled={busy}
                type="email"
                autoComplete="email"
                placeholder="ban@example.com"
                required
                maxLength={254}
              />
            </label>
            <label>
              Mật khẩu
              <span className="password-field">
                <input
                  name="password"
                  disabled={busy}
                  type={visible ? 'text' : 'password'}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder={register ? 'Ít nhất 8 ký tự' : 'Nhập mật khẩu của bạn'}
                  required
                  minLength={register ? 8 : 1}
                  maxLength={72}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} className="primary auth-submit">
              {busy ? 'Đang xử lý…' : register ? 'Tạo tài khoản' : 'Đăng nhập'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-footnote">Một không gian cho những kết nối có ý nghĩa.</p>
        </div>
      </section>
    </main>
  );
}

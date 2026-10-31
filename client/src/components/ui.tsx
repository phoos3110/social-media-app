import type { User } from '../types/social';
import { LoaderCircle } from 'lucide-react';

export function Avatar({ user, size = 'md' }: { user: User; size?: 'sm' | 'md' | 'lg' }) {
  const color = [...user.username].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
  return user.avatar ? (
    <img className={`avatar avatar-${size}`} src={user.avatar} alt={`Ảnh của ${user.name}`} />
  ) : (
    <span className={`avatar avatar-${size} avatar-color-${color}`} aria-hidden="true">
      {user.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">p</span>
      Po
    </span>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Đang tải…
    </div>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty card">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

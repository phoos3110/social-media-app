export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    cache: 'no-store',
    credentials: 'include',
    signal,
    headers: body && !multipart ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  });
  const data = await response.json().catch(() => ({ error: 'Không thể kết nối đến server.' }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('session:expired'));
    throw new ApiError(data.error || 'Yêu cầu không thành công.', response.status);
  }
  return data as T;
}
export async function uploadImage(file: File) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Ảnh không được vượt quá 5 MB.');
  const form = new FormData();
  form.append('image', file);
  return api<{ id: string; url: string }>('/uploads', 'POST', form);
}
export function timeAgo(date: string) {
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'Vừa xong';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} giờ trước`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} ngày trước`;
  return new Date(date).toLocaleDateString('vi-VN');
}

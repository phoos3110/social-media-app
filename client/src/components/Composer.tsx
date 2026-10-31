import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Send, X } from 'lucide-react';
import { api, uploadImage } from '../lib/api';
import type { SocialPost, User } from '../types/social';
import { Avatar } from './ui';

export default function Composer({
  user,
  onCreated,
  onError,
}: {
  user: User;
  onCreated: (post: SocialPost) => void;
  onError: (message: string) => void;
}) {
  const [content, setContent] = useState('');
  const [asset, setAsset] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="card composer"
      onSubmit={async (event) => {
        event.preventDefault();
        if ((!content.trim() && !asset) || busy || uploading) return;
        setBusy(true);
        try {
          const { post } = await api<{ post: SocialPost }>('/posts', 'POST', {
            content,
            uploadId: asset?.id,
          });
          onCreated(post);
          setContent('');
          setAsset(null);
        } catch (e) {
          onError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="composer-input">
        <Avatar user={user} />
        <textarea
          disabled={busy}
          aria-label="Nội dung bài viết"
          placeholder={`${user.name.split(' ').pop()} ơi, hôm nay bạn có gì muốn chia sẻ?`}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
        />
      </div>
      {asset && (
        <div className="composer-preview">
          <img src={asset.url} alt="Ảnh chuẩn bị đăng" />
          <button
            type="button"
            className="icon-button"
            aria-label="Bỏ ảnh"
            disabled={busy || uploading}
            onClick={() => setAsset(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div className="composer-bottom">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            try {
              setAsset(await uploadImage(file));
            } catch (error) {
              onError((error as Error).message);
            } finally {
              setUploading(false);
              e.target.value = '';
            }
          }}
        />
        <button
          type="button"
          className="text-button"
          disabled={uploading || busy}
          onClick={() => input.current?.click()}
        >
          {uploading ? <LoaderCircle className="spin" size={18} /> : <ImagePlus size={18} />}
          <span>{uploading ? 'Đang tải ảnh…' : 'Ảnh / Hình ảnh'}</span>
        </button>
        <span className="composer-count">
          {content.length > 4500 ? `${content.length}/5000` : 'Một điều nhỏ cũng đáng chia sẻ'}
        </span>
        <button className="primary" disabled={busy || uploading || (!content.trim() && !asset)}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Đăng bài
        </button>
      </div>
    </form>
  );
}

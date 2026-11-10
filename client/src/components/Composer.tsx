import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Music2, Send, X } from 'lucide-react';
import { api, uploadMedia } from '../lib/api';
import { useDraft } from '../lib/drafts';
import type { SocialPost, User } from '../types/social';
import { Avatar } from './ui';
import { youtubeId } from '../lib/youtube';
import YouTubeSong from './YouTubeSong';
type Asset = { id: string; url: string; kind: 'image' | 'video' };
export default function Composer({
  user,
  onCreated,
  onError,
}: {
  user: User;
  onCreated: (post: SocialPost) => void;
  onError: (message: string) => void;
}) {
  const [content, setContent] = useDraft('po:draft:' + user.id + ':post');
  const [youtubeUrl, setYoutubeUrl] = useDraft('po:draft:' + user.id + ':youtube');
  const [showYoutube, setShowYoutube] = useState(Boolean(youtubeUrl));
  const songId = youtubeId(youtubeUrl);
  const invalidSong = Boolean(youtubeUrl.trim()) && !songId;
  const [stored, setStored] = useDraft('po:draft:' + user.id + ':media');
  let assets: Asset[] = [];
  try {
    const parsed = JSON.parse(stored || '[]');
    if (Array.isArray(parsed))
      assets = parsed
        .filter(
          (a) =>
            typeof a.id === 'string' &&
            typeof a.url === 'string' &&
            ['image', 'video'].includes(a.kind),
        )
        .slice(0, 10);
  } catch {}
  const setAssets = (items: Asset[]) => setStored(JSON.stringify(items));
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className={`card composer ${content || assets.length || youtubeUrl ? 'has-draft' : ''}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          invalidSong ||
          lock.current ||
          uploading ||
          (!content.trim() && !assets.length && !songId)
        )
          return;
        lock.current = true;
        setBusy(true);
        try {
          const data = await api<{ post: SocialPost }>('/posts', 'POST', {
            content,
            youtubeUrl,
            uploadIds: assets.map((a) => a.id),
          });
          onCreated(data.post);
          setContent('');
          setStored('');
          setYoutubeUrl('');
          setShowYoutube(false);
        } catch (e) {
          onError((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <div className="composer-input">
        <Avatar user={user} />
        <textarea
          rows={1}
          disabled={busy}
          aria-label="Nội dung bài viết"
          placeholder={user.name.split(' ').pop() + ' ơi, bạn đang nghĩ gì?'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
        />
      </div>
      {assets.length > 0 && (
        <div className="composer-assets">
          {assets.map((asset) => (
            <div className="composer-preview" key={asset.id}>
              {asset.kind === 'video' ? (
                <video src={asset.url} controls preload="metadata" />
              ) : (
                <img src={asset.url} alt="Ảnh chuẩn bị đăng" />
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Bỏ ảnh"
                disabled={busy || uploading}
                onClick={() => setAssets(assets.filter((a) => a.id !== asset.id))}
              >
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      {(showYoutube || youtubeUrl) && (
        <div className="composer-youtube">
          <label htmlFor="youtube-url">Bài hát từ YouTube</label>
          <div className="youtube-input-row">
            <input
              id="youtube-url"
              type="url"
              placeholder="Dán link YouTube hoặc YouTube Music…"
              value={youtubeUrl}
              maxLength={2048}
              disabled={busy}
              aria-invalid={invalidSong}
              aria-describedby="youtube-help"
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Bỏ bài hát"
              disabled={busy}
              onClick={() => {
                setYoutubeUrl('');
                setShowYoutube(false);
              }}
            >
              <X size={18} />
            </button>
          </div>
          <small id="youtube-help" role={invalidSong ? 'alert' : undefined}>
            {invalidSong
              ? 'Link không hợp lệ. Hãy dán link video từ YouTube.'
              : 'Hỗ trợ youtube.com, youtu.be và music.youtube.com.'}
          </small>
          {songId && <YouTubeSong key={songId} id={songId} />}
        </div>
      )}
      <div className="composer-bottom">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"
          multiple
          hidden
          disabled={busy || uploading}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length + assets.length > 10) {
              onError('Tối đa 10 ảnh/video cho một bài.');
              e.target.value = '';
              return;
            }
            setUploading(true);
            const updated = [...assets];
            try {
              for (const file of files) {
                updated.push(await uploadMedia(file));
                setAssets([...updated]);
              }
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
          <span>{uploading ? 'Đang tải…' : 'Ảnh / Video'}</span>
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          aria-expanded={showYoutube || Boolean(youtubeUrl)}
          onClick={() => setShowYoutube(true)}
        >
          <Music2 size={18} />
          <span>Bài hát</span>
        </button>
        <span className="composer-count">
          {content.length > 4500 ? content.length + '/5000' : ''}
        </span>
        <button
          className="primary"
          disabled={
            invalidSong || busy || uploading || (!content.trim() && !assets.length && !songId)
          }
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}Đăng bài
        </button>
      </div>
    </form>
  );
}

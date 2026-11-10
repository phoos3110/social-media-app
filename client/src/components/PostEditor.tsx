import { useRef, useState } from 'react';
import type { SocialPost } from '../types/social';
import { api, uploadMedia } from '../lib/api';
import { youtubeId } from '../lib/youtube';
import { useConfirm } from '../lib/confirmation';
import SongDetails from './SongDetails';
import YouTubeSong from './YouTubeSong';

export default function PostEditor({
  post,
  onSaved,
  onCancel,
  onError,
}: {
  post: SocialPost;
  onSaved: (post: SocialPost) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const confirm = useConfirm();
  const [content, setContent] = useState(post.content);
  const [audience, setAudience] = useState(post.audience || 'public');
  const [song, setSong] = useState({
    url: post.youtubeId ? `https://www.youtube.com/watch?v=${post.youtubeId}` : '',
    title: post.songTitle || '',
    artist: post.songArtist || '',
  });
  const [media, setMedia] = useState(
    (post.media?.length
      ? post.media
      : post.image
        ? [{ url: post.image, kind: 'image' as const }]
        : []
    ).map((m) => ({ ...m, id: '' })),
  );
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lock = useRef(false);
  const original = useRef(JSON.stringify({ content, audience, song, media }));
  const id = youtubeId(song.url);
  return (
    <form
      className="edit-post expanded-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current || uploading || (song.url.trim() && !id)) return;
        lock.current = true;
        setBusy(true);
        try {
          const data = await api<{ post: SocialPost }>(`/posts/${post.id}`, 'PATCH', {
            content,
            audience,
            youtubeUrl: song.url,
            songTitle: song.title,
            songArtist: song.artist,
            retainedMedia: media.filter((m) => !m.id).map((m) => m.url),
            uploadIds: media.filter((m) => m.id).map((m) => m.id),
          });
          onSaved(data.post);
        } catch (e) {
          onError((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <textarea
        aria-label="Sửa nội dung bài viết"
        value={content}
        maxLength={5000}
        disabled={busy}
        onChange={(e) => setContent(e.target.value)}
      />
      <label>
        Ai được xem?
        <select
          aria-label="Quyền xem bài viết"
          value={audience}
          disabled={busy}
          onChange={(e) => setAudience(e.target.value as typeof audience)}
        >
          <option value="public">Công khai (theo quyền tài khoản)</option>
          <option value="followers">Người theo dõi</option>
          <option value="private">Chỉ mình tôi</option>
        </select>
      </label>
      <div className="editor-assets">
        {media.map((m, i) => (
          <div key={m.url}>
            {m.kind === 'video' ? (
              <video src={m.url} controls preload="metadata" />
            ) : (
              <img src={m.url} alt={`Tệp ${i + 1}`} />
            )}
            <button
              type="button"
              disabled={busy || uploading}
              onClick={() => setMedia(media.filter((_, j) => i !== j))}
            >
              Bỏ tệp {i + 1}
            </button>
          </div>
        ))}
      </div>
      <label>
        Thêm ảnh / video
        <input
          aria-label="Thêm ảnh hoặc video"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm"
          disabled={busy || uploading}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length + media.length > 10) {
              onError('Tối đa 10 ảnh/video.');
              return;
            }
            setUploading(true);
            try {
              for (const file of files) {
                const asset = await uploadMedia(file);
                setMedia((old) => [...old, asset]);
              }
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      <label>
        Link bài hát
        <input
          aria-label="Sửa link YouTube"
          value={song.url}
          maxLength={2048}
          disabled={busy}
          onChange={(e) => setSong({ url: e.target.value, title: '', artist: '' })}
        />
      </label>
      {song.url.trim() && !id && <p role="alert">Link YouTube không hợp lệ.</p>}
      <SongDetails
        url={song.url}
        title={song.title}
        artist={song.artist}
        disabled={busy}
        onChange={setSong}
      />
      {id && <YouTubeSong id={id} />}
      <div>
        <button
          type="button"
          className="secondary"
          disabled={busy || uploading}
          onClick={async () => {
            if (
              original.current !== JSON.stringify({ content, audience, song, media }) &&
              !(await confirm({
                title: 'Bỏ thay đổi?',
                message: 'Các thay đổi chưa được lưu.',
                confirmLabel: 'Bỏ thay đổi',
              }))
            )
              return;
            onCancel();
          }}
        >
          Hủy
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            uploading ||
            Boolean(song.url.trim() && !id) ||
            (!content.trim() && !media.length && !id && !post.sharedPostId)
          }
        >
          {uploading ? 'Đang tải…' : busy ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </form>
  );
}

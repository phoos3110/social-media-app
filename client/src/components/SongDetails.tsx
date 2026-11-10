import { useState } from 'react';
import { api } from '../lib/api';
import { youtubeId } from '../lib/youtube';

type Song = { id: string; title: string; artist: string };
export default function SongDetails({
  url,
  title,
  artist,
  disabled,
  onChange,
}: {
  url: string;
  title: string;
  artist: string;
  disabled: boolean;
  onChange: (value: { url: string; title: string; artist: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(search: boolean) {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      if (search) {
        const data = await api<{ songs: Song[] }>(`/youtube/search?q=${encodeURIComponent(query)}`);
        setSongs(data.songs);
        if (!data.songs.length) setError('Không tìm thấy bài hát.');
      } else {
        const song = await api<Song>(`/youtube/metadata?url=${encodeURIComponent(url)}`);
        onChange({ url, title: song.title, artist: song.artist });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="song-details">
      <div className="youtube-input-row">
        <input
          aria-label="Tìm bài hát"
          placeholder="Tìm bài hát theo tên…"
          value={query}
          disabled={disabled || busy}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy || !query.trim()}
          onClick={() => void load(true)}
        >
          Tìm nhạc
        </button>
      </div>
      {songs.map((song) => (
        <button
          className="song-result"
          type="button"
          key={song.id}
          disabled={disabled}
          onClick={() => {
            onChange({
              url: `https://www.youtube.com/watch?v=${song.id}`,
              title: song.title,
              artist: song.artist,
            });
            setSongs([]);
          }}
        >
          {song.title}
          <small>{song.artist}</small>
        </button>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={disabled || busy || !youtubeId(url)}
        onClick={() => void load(false)}
      >
        {busy ? 'Đang tải…' : 'Lấy tên bài từ YouTube'}
      </button>
      <input
        aria-label="Tên bài hát"
        placeholder="Tên bài hát"
        value={title}
        maxLength={200}
        disabled={disabled}
        onChange={(e) => onChange({ url, title: e.target.value, artist })}
      />
      <input
        aria-label="Ca sĩ hoặc kênh"
        placeholder="Ca sĩ / kênh YouTube"
        value={artist}
        maxLength={200}
        disabled={disabled}
        onChange={(e) => onChange({ url, title, artist: e.target.value })}
      />
      {error && (
        <p role="status" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}

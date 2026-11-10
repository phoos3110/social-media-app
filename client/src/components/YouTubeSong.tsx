export default function YouTubeSong({ id }: { id: string }) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return (
    <div className="youtube-song">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title="Bài hát YouTube"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noopener noreferrer">
        Mở trên YouTube
      </a>
      <small>Nếu không phát được tại đây, hãy mở bài hát trên YouTube.</small>
    </div>
  );
}

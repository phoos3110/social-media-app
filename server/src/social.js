import { z } from 'zod';
import { visiblePost } from './community.js';
import { youtubeId } from './youtube.js';

export function socialRoutes({ app, db, io, requirePost, postSelect, postJSON, notify }) {
  const q = async (s, p = []) => (await db.query(s, p)).rows;
  const one = async (s, p = []) => (await q(s, p))[0];
  app.get('/api/account/notifications', async (req, res) => {
    res.json({
      preferences: (
        await one('SELECT notification_preferences FROM users WHERE id=$1', [req.user.id])
      ).notification_preferences,
    });
  });
  app.put('/api/account/notifications', async (req, res) => {
    const preferences = z
      .object({
        like: z.boolean(),
        comment: z.boolean(),
        reply: z.boolean(),
        follow: z.boolean(),
        request: z.boolean(),
        mention: z.boolean(),
        message: z.boolean(),
      })
      .strict()
      .parse(req.body);
    await db.query('UPDATE users SET notification_preferences=$1 WHERE id=$2', [
      JSON.stringify(preferences),
      req.user.id,
    ]);
    res.json({ preferences });
  });
  app.get('/api/account/hidden-posts', async (req, res) => {
    const posts = await q(
      `${postSelect} WHERE ${visiblePost()} AND EXISTS(SELECT 1 FROM post_preferences pref WHERE pref.user_id=$1 AND pref.post_id=p.id AND pref.hidden) ORDER BY p.created_at DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ posts: posts.map(postJSON) });
  });
  app.put('/api/posts/:id/preferences', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    const input = z
      .object({ hidden: z.boolean().optional(), muted: z.boolean().optional() })
      .parse(req.body);
    await db.query(
      `INSERT INTO post_preferences(user_id,post_id,hidden,muted) VALUES($1,$2,COALESCE($3,FALSE),COALESCE($4,FALSE))
      ON CONFLICT(user_id,post_id) DO UPDATE SET hidden=COALESCE($3,post_preferences.hidden),muted=COALESCE($4,post_preferences.muted)`,
      [req.user.id, post.id, input.hidden ?? null, input.muted ?? null],
    );
    res.json({ ok: true });
  });
  app.put('/api/posts/:id/reaction', async (req, res) => {
    const post = await requirePost(req.params.id, req.user.id);
    const { reaction } = z
      .object({ reaction: z.enum(['like', 'love', 'haha', 'wow', 'sad', 'angry']).nullable() })
      .parse(req.body);
    if (reaction) {
      const old = await one('SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2', [
        req.user.id,
        post.id,
      ]);
      await db.query(
        'INSERT INTO likes(user_id,post_id,reaction) VALUES($1,$2,$3) ON CONFLICT(user_id,post_id) DO UPDATE SET reaction=$3',
        [req.user.id, post.id, reaction],
      );
      if (!old) await notify(post.user_id, req.user.id, 'like', post.id);
    } else
      await db.query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2', [req.user.id, post.id]);
    io.emit('post:changed', { id: post.id });
    res.json({ post: postJSON(await one(`${postSelect} WHERE p.id=$2`, [req.user.id, post.id])) });
  });
  app.get('/api/tags', async (req, res) => {
    const rows = await q(
      `SELECT lower(m[1]) AS tag,COUNT(*)::int AS count FROM posts p CROSS JOIN LATERAL regexp_matches(p.content,'#([[:alnum:]_]+)','g') AS m WHERE ${visiblePost()} AND p.kind='post' GROUP BY lower(m[1]) ORDER BY count DESC,tag LIMIT 20`,
      [req.user.id],
    );
    res.json({ tags: rows });
  });
  app.get('/api/youtube/metadata', async (req, res) => {
    const url = z.string().max(2048).parse(req.query.url);
    const videoId = youtubeId(url);
    if (!videoId) return res.status(400).json({ error: 'Link YouTube không hợp lệ.' });
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) throw new Error();
      const data = await response.json();
      res.json({
        id: videoId,
        title: String(data.title || '').slice(0, 200),
        artist: String(data.author_name || '').slice(0, 200),
      });
    } catch {
      res.status(502).json({ error: 'Không lấy được tên bài hát. Bạn có thể nhập thủ công.' });
    }
  });
  app.get('/api/youtube/search', async (req, res) => {
    const search = z.string().trim().min(1).max(100).parse(req.query.q);
    if (!process.env.YOUTUBE_API_KEY)
      return res.status(503).json({
        error: 'Tìm kiếm cần YOUTUBE_API_KEY trên server. Bạn vẫn có thể dán link YouTube.',
      });
    try {
      const params = new URLSearchParams({
        key: process.env.YOUTUBE_API_KEY,
        part: 'snippet',
        type: 'video',
        videoCategoryId: '10',
        maxResults: '10',
        q: search,
      });
      const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error();
      const data = await response.json();
      res.json({
        songs: (data.items || []).map((item) => ({
          id: item.id.videoId,
          title: item.snippet.title,
          artist: item.snippet.channelTitle,
        })),
      });
    } catch {
      res.status(502).json({ error: 'Không tìm được bài hát lúc này. Hãy thử lại.' });
    }
  });
}

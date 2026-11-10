export async function migrateSocial(db) {
  await db.query(`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM schema_migrations WHERE version='004_social_expansion') THEN RETURN; END IF;
    ALTER TABLE posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'public' CHECK(audience IN ('public','followers','private'));
    ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post' CHECK(kind IN ('post','story','reel'));
    ALTER TABLE posts ADD COLUMN expires_at TIMESTAMPTZ;
    ALTER TABLE posts ADD COLUMN song_title VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE posts ADD COLUMN song_artist VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE likes ADD COLUMN reaction TEXT NOT NULL DEFAULT 'like' CHECK(reaction IN ('like','love','haha','wow','sad','angry'));
    ALTER TABLE users ADD COLUMN notification_preferences JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE messages ADD COLUMN edited_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN attachment JSONB;
    ALTER TABLE uploads ADD COLUMN original_name VARCHAR(200) NOT NULL DEFAULT '';
    ALTER TABLE uploads ADD COLUMN content_type TEXT NOT NULL DEFAULT '';
    CREATE TABLE post_preferences(user_id UUID REFERENCES users(id) ON DELETE CASCADE,post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,muted BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(user_id,post_id));
    CREATE TABLE groups(id UUID PRIMARY KEY,name VARCHAR(80) NOT NULL,owner_id UUID REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE group_members(group_id UUID REFERENCES groups(id) ON DELETE CASCADE,user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(group_id,user_id));
    CREATE TABLE group_messages(id UUID PRIMARY KEY,group_id UUID REFERENCES groups(id) ON DELETE CASCADE,sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
      content VARCHAR(2000) NOT NULL DEFAULT '',attachment JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),recalled_at TIMESTAMPTZ);
    CREATE INDEX group_messages_history ON group_messages(group_id,created_at DESC,id DESC);
    CREATE UNIQUE INDEX notification_mention_once ON notifications(user_id,actor_id,post_id,COALESCE(comment_id,'00000000-0000-0000-0000-000000000000')) WHERE kind='mention';
    INSERT INTO schema_migrations(version) VALUES('004_social_expansion');
  END $$;`);
}

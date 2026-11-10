export async function migrateFeatures(db) {
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version='003_youtube_posts') THEN
      ALTER TABLE posts ADD COLUMN youtube_id VARCHAR(11);
      INSERT INTO schema_migrations(version) VALUES('003_youtube_posts');
    END IF;
  END $$;`);
  await db.query(`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM schema_migrations WHERE version='002_community_features') THEN RETURN; END IF;
    ALTER TABLE users ADD COLUMN cover TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN banned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE uploads ADD COLUMN kind TEXT NOT NULL DEFAULT 'image';
    ALTER TABLE uploads ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE uploads ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'upload';
    ALTER TABLE posts ADD COLUMN media JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE posts ADD COLUMN shared_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;
    ALTER TABLE notifications ADD COLUMN comment_id UUID REFERENCES comments(id) ON DELETE CASCADE;
    ALTER TABLE messages ADD COLUMN image TEXT NOT NULL DEFAULT '';
    ALTER TABLE messages ADD COLUMN reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;
    ALTER TABLE messages ADD COLUMN recalled_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN client_id UUID;
    CREATE UNIQUE INDEX messages_client_once ON messages(sender_id,client_id) WHERE client_id IS NOT NULL;
    CREATE TABLE account_tokens(token_hash TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,new_email TEXT,expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE blocks(user_id UUID REFERENCES users(id) ON DELETE CASCADE,target_id UUID REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(user_id,target_id),CHECK(user_id<>target_id));
    CREATE TABLE follow_requests(user_id UUID REFERENCES users(id) ON DELETE CASCADE,target_id UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,target_id),CHECK(user_id<>target_id));
    CREATE TABLE bookmarks(user_id UUID REFERENCES users(id) ON DELETE CASCADE,post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,post_id));
    CREATE TABLE comment_likes(user_id UUID REFERENCES users(id) ON DELETE CASCADE,comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
      PRIMARY KEY(user_id,comment_id));
    CREATE TABLE reports(id UUID PRIMARY KEY,user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
      reason VARCHAR(1000) NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      subscription JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX blocks_target ON blocks(target_id,user_id);
    CREATE INDEX reports_status ON reports(status,created_at DESC);
    CREATE TABLE media_cleanup(id UUID PRIMARY KEY,public_id TEXT,kind TEXT NOT NULL,delivery_type TEXT NOT NULL,source_url TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE UNIQUE INDEX notifications_request_once ON notifications(user_id,actor_id) WHERE kind='request';
    INSERT INTO schema_migrations(version) VALUES('002_community_features');
  END $$;`);
}

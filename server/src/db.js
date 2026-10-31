import 'dotenv/config';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrateNotifications } from './migrations.js';
import { migrateFeatures } from './schema-features.js';

export async function createDatabase({ memory = false, embeddedPath } = {}) {
  let driver;
  if (!memory && !embeddedPath && process.env.DATABASE_URL) {
    driver = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    });
  } else {
    const directory = embeddedPath || fileURLToPath(new URL('../data/postgres', import.meta.url));
    if (!memory) await mkdir(directory, { recursive: true });
    driver = new PGlite(memory ? undefined : directory);
  }
  const db = {
    query: (sql, params = []) => driver.query(sql, params),
    close: () => (driver.end ? driver.end() : driver.close()),
  };
  // Schema is idempotent. Keep future schema upgrades as versioned migrations.
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY, username VARCHAR(30) UNIQUE NOT NULL, email VARCHAR(254) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, name VARCHAR(80) NOT NULL, bio VARCHAR(300) NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS uploads (
      id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url TEXT NOT NULL, public_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS likes (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(user_id,post_id))`,
    `CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY, post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, content VARCHAR(2000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS follows (
      follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(follower_id,following_id), CHECK(follower_id <> following_id))`,
    `CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY, sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, content VARCHAR(2000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind VARCHAR(20) NOT NULL,
      post_id UUID REFERENCES posts(id) ON DELETE CASCADE, read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS posts_timeline ON posts(created_at DESC,id DESC)`,
    `CREATE INDEX IF NOT EXISTS posts_author ON posts(user_id,created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id,created_at)`,
    `ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE`,
    `CREATE INDEX IF NOT EXISTS comments_parent ON comments(parent_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS follows_target ON follows(following_id)`,
    `CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id,recipient_id,created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS messages_recipient ON messages(recipient_id,created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  ];
  for (const sql of statements) await db.query(sql);
  await migrateNotifications(db);
  await migrateFeatures(db);
  return db;
}

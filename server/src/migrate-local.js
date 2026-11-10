import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './db.js';

// Stop the embedded-database backend first. Never merge or overwrite target records.
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in server/.env first.');
const sourcePath = fileURLToPath(new URL('../data/postgres', import.meta.url));
const backupPath = fileURLToPath(
  new URL(`../data/backups/embedded-${Date.now()}`, import.meta.url),
);
await mkdir(fileURLToPath(new URL('../data/backups', import.meta.url)), { recursive: true });
await cp(sourcePath, backupPath, { recursive: true, errorOnExist: true, force: false });
console.log('Created a backup of the embedded database under server/data/backups.');
const upgraded = await createDatabase({ embeddedPath: sourcePath });
await upgraded.close();
const source = new PGlite(sourcePath);
const schema = await createDatabase();
await schema.close();
const target = new pg.Client({ connectionString: process.env.DATABASE_URL });
const tables = [
  'users',
  'sessions',
  'uploads',
  'posts',
  'likes',
  'comments',
  'follows',
  'messages',
  'notifications',
  'account_tokens',
  'blocks',
  'follow_requests',
  'bookmarks',
  'comment_likes',
  'reports',
  'push_subscriptions',
  'media_cleanup',
  'post_preferences',
  'groups',
  'group_members',
  'group_messages',
];
try {
  await target.connect();
  await target.query('BEGIN');
  await target.query(`LOCK TABLE ${tables.join(',')} IN ACCESS EXCLUSIVE MODE`);
  for (const table of tables) {
    const {
      rows: [{ count }],
    } = await target.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    if (count !== 0)
      throw new Error(`Target table ${table} contains data. Migration stopped without changes.`);
  }
  for (const table of tables) {
    const { rows } = await source.query(`SELECT * FROM ${table}`);
    const deferred =
      table === 'posts'
        ? 'shared_post_id'
        : table === 'comments'
          ? 'parent_id'
          : table === 'messages'
            ? 'reply_to_id'
            : null;
    for (const row of rows) {
      const columns = Object.keys(row);
      const placeholders = columns.map((_, index) => `$${index + 1}`);
      await target.query(
        `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${placeholders.join(',')})`,
        columns.map((c) =>
          c === deferred
            ? null
            : ['media', 'subscription', 'attachment', 'notification_preferences'].includes(c) &&
                row[c] !== null
              ? JSON.stringify(row[c])
              : row[c],
        ),
      );
    }
    if (deferred)
      for (const row of rows)
        if (row[deferred])
          await target.query(`UPDATE ${table} SET ${deferred}=$1 WHERE id=$2`, [
            row[deferred],
            row.id,
          ]);
    const result = await target.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    if (result.rows[0].count !== rows.length) throw new Error(`Count mismatch for ${table}`);
    console.log(`${table}: ${rows.length} records verified`);
  }
  await target.query('COMMIT');
  console.log('Migration complete. Original embedded database has been retained.');
} catch (error) {
  await target.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await target.end();
  await source.close();
}

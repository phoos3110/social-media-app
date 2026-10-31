export async function migrateNotifications(db) {
  // One statement runs in one transaction/connection on both pg.Pool and PGlite.
  await db.query(`
    DO $$
    BEGIN
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='001_notification_dedup') THEN
        -- Retain the newest event and preserve unread state from any duplicate.
        WITH ranked AS (
          SELECT id,
            ROW_NUMBER() OVER (PARTITION BY user_id,actor_id,kind,post_id ORDER BY created_at DESC,id DESC) AS position,
            BOOL_OR(read_at IS NULL) OVER (PARTITION BY user_id,actor_id,kind,post_id) AS unread
          FROM notifications WHERE kind IN ('follow','like')
        )
        UPDATE notifications SET read_at=NULL
        WHERE id IN (SELECT id FROM ranked WHERE position=1 AND unread);

        WITH ranked AS (
          SELECT id,ROW_NUMBER() OVER (
            PARTITION BY user_id,actor_id,kind,post_id ORDER BY created_at DESC,id DESC
          ) AS position
          FROM notifications WHERE kind IN ('follow','like')
        )
        DELETE FROM notifications WHERE id IN (SELECT id FROM ranked WHERE position>1);

        CREATE UNIQUE INDEX notifications_follow_once ON notifications(user_id,actor_id) WHERE kind='follow';
        CREATE UNIQUE INDEX notifications_like_once ON notifications(user_id,actor_id,post_id) WHERE kind='like';
        INSERT INTO schema_migrations(version) VALUES('001_notification_dedup');
      END IF;
    END $$;
  `);
}

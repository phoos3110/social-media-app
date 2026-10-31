import 'dotenv/config';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

const db = await createDatabase();
const { http, io } = createApp(db);
const port = Number(process.env.PORT || 4180);
http.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Nhip API: http://localhost:${port}`);
  console.log(
    `Database: ${process.env.DATABASE_URL ? 'PostgreSQL server' : 'embedded PostgreSQL (server/data/postgres)'}`,
  );
});
async function stop() {
  io.close();
  http.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

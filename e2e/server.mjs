process.env.CLIENT_ORIGIN = 'http://localhost:4100';
process.env.NODE_ENV = 'test';
const { createDatabase } = await import('../server/src/db.js');
const { createApp } = await import('../server/src/app.js');
const db = await createDatabase({ memory: true });
const { http, io } = createApp(db, { testing: true });
http.listen(4100, () => console.log('Isolated E2E server :4100'));
async function stop() {
  io.close();
  http.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

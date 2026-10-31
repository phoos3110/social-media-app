process.env.CLIENT_ORIGIN = 'http://localhost:4100';
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:4100';
process.env.ADMIN_EMAILS = 'complete_admin@example.com';
delete process.env.ADMIN_USER_IDS;
const { createDatabase } = await import('../server/src/db.js');
const { createApp } = await import('../server/src/app.js');
const db = await createDatabase({ memory: true });
const { mkdir, appendFile, writeFile } = await import('node:fs/promises');
await mkdir('test-results', { recursive: true });
await writeFile('test-results/mail.jsonl', '');
const { http, io } = createApp(db, {
  testing: true,
  sendMail: async (mail) => appendFile('test-results/mail.jsonl', JSON.stringify(mail) + '\n'),
});
http.listen(4100, () => console.log('Isolated E2E server :4100'));
async function stop() {
  io.close();
  http.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

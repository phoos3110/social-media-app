// Run inside backend via stdin: no host node_modules required.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const ids = [];
const base = 'http://frontend';
try {
  for (const origin of ['http://localhost:5180', 'http://127.0.0.1:5180']) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Origin test',
        username: `origin_${suffix}`,
        email: `${suffix}@example.com`,
        password: 'OriginTest123!',
      }),
    });
    assert.equal(response.status, 201);
    const { user } = await response.json();
    ids.push(user.id);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const headers = { Origin: origin, Cookie: cookie };
    const me = await fetch(`${base}/api/auth/me`, { headers });
    assert.equal((await me.json()).user.id, user.id);
    const open = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers });
    const handshake = await open.text();
    assert.equal(handshake[0], '0');
    const { sid } = JSON.parse(handshake.slice(1));
    const socketURL = `${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
    const connect = await fetch(socketURL, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: '40',
    });
    assert.equal(connect.status, 200);
    const acknowledgment = await (await fetch(socketURL, { headers })).text();
    assert.ok(acknowledgment.startsWith('40'), `Socket.IO connection rejected: ${acknowledgment}`);
    assert.equal((await fetch(`${base}/api/auth/logout`, { method: 'POST', headers })).status, 200);
    console.log(`${origin}: register, authenticated session, Socket.IO and logout passed`);
  }
  const rejected = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(rejected.status, 403);
  console.log('Untrusted origin still rejected with 403.');
} finally {
  if (ids.length) await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
  await db.end();
}

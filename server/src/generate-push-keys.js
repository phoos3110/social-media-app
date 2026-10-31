import webpush from 'web-push';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const keys = webpush.generateVAPIDKeys();
const path = fileURLToPath(new URL('../.env.push.local', import.meta.url));
await writeFile(
  path,
  `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:replace-with-your-email@example.com\n`,
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'VAPID keys saved to server/.env.push.local (ignored by Git). Keep this file private and set its values in Render.',
);

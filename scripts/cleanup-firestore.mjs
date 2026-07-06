#!/usr/bin/env node
// Manually prune old rtc-audio sessions from Firestore.
//
// Runs with a service-account key via the Firebase Admin SDK, which bypasses
// security rules — so it can enumerate and delete across the whole `calls`
// tree without exposing anything to browser clients. Deletes each old room
// doc AND all its subcollections (recursiveDelete cascades, unlike TTL).
//
// Setup (one time):
//   1. Firebase console > Project settings > Service accounts >
//      "Generate new private key" — save it (do NOT commit it).
//   2. npm i firebase-admin
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./key.json node cleanup-firestore.mjs
//        → dry run: reports how many rooms older than 1 day would be deleted
//   ... node cleanup-firestore.mjs --delete          → actually delete
//   ... node cleanup-firestore.mjs --days 7 --delete → older than 7 days

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const doDelete = args.includes('--delete');
const daysArg = args.indexOf('--days');
const days = daysArg !== -1 ? Number(args[daysArg + 1]) : 1;

if (!Number.isFinite(days) || days < 0) {
  console.error('Invalid --days value.');
  process.exit(1);
}

const keyPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json';
if (!existsSync(keyPath)) {
  console.error(`Service-account key not found at: ${keyPath}`);
  console.error(
    'Download one from Firebase console > Project settings > Service ' +
      'accounts, then set GOOGLE_APPLICATION_CREDENTIALS to its path.'
  );
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(readFileSync(keyPath, 'utf8'))
  ),
});
const db = admin.firestore();

// Rooms always carry createdAt (even docs predating the expireAt field), so
// key the cutoff on that — it catches the full historical backlog.
const cutoff = admin.firestore.Timestamp.fromMillis(
  Date.now() - days * 86_400_000
);
const snapshot = await db
  .collection('calls')
  .where('createdAt', '<', cutoff)
  .get();

console.log(`${snapshot.size} room(s) older than ${days} day(s).`);

if (!doDelete) {
  console.log('Dry run — re-run with --delete to remove them.');
  process.exit(0);
}

let deleted = 0;
for (const doc of snapshot.docs) {
  await db.recursiveDelete(doc.ref); // deletes the room + all subcollections
  if (++deleted % 25 === 0) {
    console.log(`  deleted ${deleted}/${snapshot.size}...`);
  }
}
console.log(`Done. Deleted ${deleted} room(s) and all their subcollections.`);
process.exit(0);

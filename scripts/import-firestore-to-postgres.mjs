#!/usr/bin/env node
/**
 * Idempotently imports the current Firestore data into PostgreSQL.
 *
 * Required environment variables:
 *   DATABASE_URL                    PostgreSQL connection string
 *   FIREBASE_SERVICE_ACCOUNT_PATH   path to a Firebase Admin service-account JSON file
 * Optional:
 *   DRY_RUN=1                       validates and reports counts without writing
 */
import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const dryRun = process.env.DRY_RUN === "1";

if (!databaseUrl || !serviceAccountPath) {
  throw new Error("Set DATABASE_URL and FIREBASE_SERVICE_ACCOUNT_PATH before running this import.");
}

const serviceAccount = JSON.parse(await readFile(serviceAccountPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });

const client = new Client({ connectionString: databaseUrl });
const firestore = getFirestore();
const usersByFirebaseUid = new Map();
const validStatuses = new Set(["open", "claimed", "reunited"]);

function firestoreTimestamp(value) {
  return value?.toDate ? value.toDate() : value instanceof Date ? value : new Date();
}

function itemValue(data, key) {
  return typeof data[key] === "string" ? data[key].trim() : "";
}

async function upsertUser({ uid, email = null, displayName = null, createdAt = new Date() }) {
  if (usersByFirebaseUid.has(uid)) return usersByFirebaseUid.get(uid);
  const result = await client.query(
    `insert into app_users (firebase_uid, email, display_name, created_at, migrated_at)
     values ($1, $2, $3, $4, now())
     on conflict (firebase_uid) do update set
       email = coalesce(excluded.email, app_users.email),
       display_name = coalesce(excluded.display_name, app_users.display_name),
       migrated_at = now()
     returning id`,
    [uid, email, displayName || "User", createdAt]
  );
  const id = result.rows[0].id;
  usersByFirebaseUid.set(uid, id);
  return id;
}

async function categoryId(category) {
  const slug = /^[a-z0-9-]+$/.test(category || "") ? category : "other";
  const result = await client.query(
    `insert into categories (name, slug) values ($1, $2)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [slug === "other" ? "Other" : slug[0].toUpperCase() + slug.slice(1), slug]
  );
  return result.rows[0].id;
}

async function locationId(location) {
  if (!location) return null;
  const result = await client.query(
    `select id from locations where name = $1 and address is null limit 1`,
    [location]
  );
  if (result.rows[0]) return result.rows[0].id;
  const inserted = await client.query(
    `insert into locations (name) values ($1) returning id`, [location]
  );
  return inserted.rows[0].id;
}

async function importAuthUsers() {
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      await upsertUser({
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        createdAt: new Date(user.metadata.creationTime)
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
}

async function importItems(collectionName, kind) {
  const snapshot = await firestore.collection(collectionName).get();
  for (const document of snapshot.docs) {
    const data = document.data();
    if (!data.userId) {
      console.warn(`Skipping ${collectionName}/${document.id}: missing userId.`);
      continue;
    }
    const ownerId = await upsertUser({ uid: data.userId });
    const category = await categoryId(data.category);
    const location = await locationId(itemValue(data, "location"));
    const status = validStatuses.has(data.status) ? data.status : "open";
    await client.query(
      `insert into items (
         legacy_firestore_id, owner_id, category_id, location_id, kind, title, description,
         occurred_on, contact, status, created_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (legacy_firestore_id) do update set
         owner_id = excluded.owner_id, category_id = excluded.category_id,
         location_id = excluded.location_id, kind = excluded.kind, title = excluded.title,
         description = excluded.description, occurred_on = excluded.occurred_on,
         contact = excluded.contact, status = excluded.status
       returning id`,
      [
        document.id, ownerId, category, location, kind,
        itemValue(data, "title") || "Untitled item",
        itemValue(data, "description") || "No description provided.", data.date || null,
        itemValue(data, "contact") || null, status, firestoreTimestamp(data.createdAt)
      ]
    );
    const itemId = (await client.query(
      `select id from items where legacy_firestore_id = $1`, [document.id]
    )).rows[0].id;
    if (data.imagePath) {
      await client.query(
        `insert into item_images (item_id, storage_path, public_url, alt_text)
         values ($1, $2, $3, $4)
         on conflict (storage_path) do update set public_url = excluded.public_url,
           alt_text = excluded.alt_text`,
        [itemId, data.imagePath, data.imageUrl || null, itemValue(data, "title") || null]
      );
    }
  }
  return snapshot.size;
}

async function importMessages() {
  const snapshot = await firestore.collection("contactMessages").get();
  for (const document of snapshot.docs) {
    const data = document.data();
    const message = itemValue(data, "message");
    if (!message || !itemValue(data, "email")) {
      console.warn(`Skipping contactMessages/${document.id}: missing required content.`);
      continue;
    }
    await client.query(
      `insert into contact_messages (legacy_firestore_id, name, email, subject, message, created_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (legacy_firestore_id) do update set
         name = excluded.name, email = excluded.email, subject = excluded.subject,
         message = excluded.message`,
      [document.id, itemValue(data, "name") || "Unknown", itemValue(data, "email"),
       itemValue(data, "subject") || "No subject", message, firestoreTimestamp(data.createdAt)]
    );
  }
  return snapshot.size;
}

try {
  if (dryRun) {
    const [lost, found, messages] = await Promise.all([
      firestore.collection("lostItems").count().get(),
      firestore.collection("foundItems").count().get(),
      firestore.collection("contactMessages").count().get()
    ]);
    console.log(JSON.stringify({ dryRun: true, lostItems: lost.data().count, foundItems: found.data().count, contactMessages: messages.data().count }));
  } else {
    await client.connect();
    await client.query("begin");
    await importAuthUsers();
    const lost = await importItems("lostItems", "lost");
    const found = await importItems("foundItems", "found");
    const messages = await importMessages();
    await client.query("commit");
    console.log(JSON.stringify({ imported: { lostItems: lost, foundItems: found, contactMessages: messages } }));
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}

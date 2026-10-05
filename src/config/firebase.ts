import admin from "firebase-admin";
import fs from "node:fs";
import path from "node:path";
import type { AppEnv } from "./env.js";

export interface FirebaseHandles {
  firestore: admin.firestore.Firestore;
  rtdb: admin.database.Database;
}

function loadServiceAccount(): admin.ServiceAccount {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) return JSON.parse(inline);

  const credentialsPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve("firebase-key.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      "Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_JSON " +
        "(preferred in production) or FIREBASE_SERVICE_ACCOUNT_PATH.",
    );
  }
  return JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
}

/** Explicit initialisation: importing this module has no side effects. */
export function initFirebase(env: AppEnv): FirebaseHandles {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
    databaseURL: env.firebaseDatabaseUrl,
  });
  return { firestore: admin.firestore(), rtdb: admin.database() };
}

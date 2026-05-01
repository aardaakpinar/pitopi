import admin from "firebase-admin";
import fs from "fs";
import path from "path";

function loadServiceAccount() {
  const inlineCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inlineCredentials) {
    return JSON.parse(inlineCredentials);
  }

  const credentialsPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.resolve("firebase-key.json");

  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Firebase service account not found at ${credentialsPath}. ` +
      "Place firebase-key.json in the project root or set FIREBASE_SERVICE_ACCOUNT_PATH."
    );
  }

  return JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
}

const serviceAccount = loadServiceAccount();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://pitopi-server-default-rtdb.europe-west1.firebasedatabase.app/"
});

export const dbf = admin.firestore();
export const dbd = admin.database() as admin.database.Database;

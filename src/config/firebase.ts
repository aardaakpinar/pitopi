import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("./firebase-key.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://pitopi-server-default-rtdb.europe-west1.firebasedatabase.app/"
});

export const dbf = admin.firestore();
export const dbd = admin.database() as admin.database.Database;
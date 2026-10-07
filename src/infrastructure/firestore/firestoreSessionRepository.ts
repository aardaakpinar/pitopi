import type { CollectionReference, Firestore } from "firebase-admin/firestore";
import type { SessionRepository } from "../../application/ports.js";
import type { SessionRecord } from "../../domain/types.js";

export class FirestoreSessionRepository implements SessionRepository {
  private readonly col: CollectionReference;

  constructor(private readonly db: Firestore) {
    this.col = db.collection("sessions");
  }

  async save(tokenHash: string, record: SessionRecord): Promise<void> {
    await this.col.doc(tokenHash).set(record);
  }

  async find(tokenHash: string): Promise<SessionRecord | null> {
    const snap = await this.col.doc(tokenHash).get();
    if (!snap.exists) return null;
    const accountId = snap.get("accountId");
    const expiresAt = Number(snap.get("expiresAt"));
    return typeof accountId === "string" && Number.isFinite(expiresAt) ? { accountId, expiresAt } : null;
  }

  async delete(tokenHash: string): Promise<void> {
    await this.col.doc(tokenHash).delete();
  }

  async deleteExpired(now: number, limit: number): Promise<number> {
    const snap = await this.col.where("expiresAt", "<", now).limit(limit).get();
    if (snap.empty) return 0;
    const batch = this.db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return snap.size;
  }
}

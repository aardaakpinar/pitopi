import type { CollectionReference, Firestore } from "firebase-admin/firestore";
import type { SessionRepository } from "../../application/ports.js";
import type { SessionRecord } from "../../domain/types.js";

function toRecord(
  accountId: string,
  expiresAt: number,
  snap: { get(field: string): unknown },
): SessionRecord {
  const device = snap.get("device");
  return {
    accountId,
    expiresAt,
    createdAt: Number(snap.get("createdAt")) || 0,
    device: typeof device === "string" ? device : "",
  };
}

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
    return typeof accountId === "string" && Number.isFinite(expiresAt) ? toRecord(accountId, expiresAt, snap) : null;
  }

  async listByAccount(accountId: string): Promise<Array<{ tokenHash: string; record: SessionRecord }>> {
    // Single-field equality query: served by the automatic index.
    const snap = await this.col.where("accountId", "==", accountId).limit(50).get();
    const out: Array<{ tokenHash: string; record: SessionRecord }> = [];
    for (const doc of snap.docs) {
      const expiresAt = Number(doc.get("expiresAt"));
      if (Number.isFinite(expiresAt)) out.push({ tokenHash: doc.id, record: toRecord(accountId, expiresAt, doc) });
    }
    return out;
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

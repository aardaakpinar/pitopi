import type admin from "firebase-admin";
import type { TokenRecord, TokenRepository } from "../../application/ports.js";

const ALREADY_EXISTS = 6; // gRPC status code

export class FirestoreTokenRepository implements TokenRepository {
  private readonly col: admin.firestore.CollectionReference;

  constructor(db: admin.firestore.Firestore) {
    this.col = db.collection("tokens");
  }

  async create(id: string, createdAt: number): Promise<boolean> {
    try {
      await this.col.doc(id).create({ createdAt, claimed: false });
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return false;
      throw err;
    }
  }

  async exists(id: string): Promise<boolean> {
    return (await this.col.doc(id).get()).exists;
  }

  async markClaimed(id: string): Promise<void> {
    await this.col.doc(id).set({ claimed: true }, { merge: true });
  }

  async listUnclaimed(limit: number): Promise<TokenRecord[]> {
    // Single-field equality query: no composite index required.
    const snap = await this.col.where("claimed", "==", false).limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, createdAt: Number(d.get("createdAt")) || 0 }));
  }

  async delete(id: string): Promise<void> {
    await this.col.doc(id).delete();
  }
}

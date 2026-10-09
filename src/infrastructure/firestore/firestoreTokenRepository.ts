import type { CollectionReference, Firestore } from "firebase-admin/firestore";
import type { TokenRecord, TokenRepository } from "../../application/ports.js";

const ALREADY_EXISTS = 6; // gRPC status code

export class FirestoreTokenRepository implements TokenRepository {
  private readonly col: CollectionReference;

  constructor(db: Firestore) {
    this.col = db.collection("tokens");
  }

  async create(id: string, createdAt: number): Promise<boolean> {
    try {
      await this.col.doc(id).create({ createdAt });
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === ALREADY_EXISTS) return false;
      throw err;
    }
  }

  async find(id: string): Promise<TokenRecord | null> {
    const snap = await this.col.doc(id).get();
    return snap.exists
      ? { id, createdAt: Number(snap.get("createdAt")) || 0 }
      : null;
  }

  async listCreatedBefore(cutoff: number, limit: number): Promise<TokenRecord[]> {
    const snap = await this.col
      .where("createdAt", "<=", cutoff)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => ({ id: d.id, createdAt: Number(d.get("createdAt")) || 0 }));
  }

  async delete(id: string): Promise<void> {
    await this.col.doc(id).delete();
  }
}

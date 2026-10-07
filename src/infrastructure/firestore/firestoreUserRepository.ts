import type { CollectionReference, DocumentData, Firestore } from "firebase-admin/firestore";
import type { UserRepository } from "../../application/ports.js";
import type { UserRecord } from "../../domain/types.js";

const ALREADY_EXISTS = 6;

function toRecord(id: string, data: DocumentData): UserRecord {
  return {
    id,
    username: typeof data.username === "string" ? data.username : `user_${id.slice(0, 8)}`,
    createdAt: Number(data.createdAt) || 0,
    profilePic: typeof data.profilePic === "string" ? data.profilePic : null,
    hidden: data.hidden === true,
  };
}

export class FirestoreUserRepository implements UserRepository {
  private readonly col: CollectionReference;

  constructor(db: Firestore) {
    this.col = db.collection("users");
  }

  async findById(id: string): Promise<UserRecord | null> {
    const snap = await this.col.doc(id).get();
    return snap.exists ? toRecord(id, snap.data() ?? {}) : null;
  }

  async createIfAbsent(user: UserRecord): Promise<{ user: UserRecord; created: boolean }> {
    try {
      await this.col.doc(user.id).create({ ...user });
      return { user, created: true };
    } catch (err) {
      if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
      const existing = await this.findById(user.id);
      if (!existing) throw err;
      return { user: existing, created: false };
    }
  }

  async exists(id: string): Promise<boolean> {
    return (await this.col.doc(id).get()).exists;
  }

  async updateProfilePic(id: string, profilePic: string | null): Promise<void> {
    await this.col.doc(id).update({ profilePic });
  }

  async updateHidden(id: string, hidden: boolean): Promise<void> {
    await this.col.doc(id).update({ hidden });
  }
}

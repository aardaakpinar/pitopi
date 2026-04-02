import { TURKISH_MONTHS } from "../config/constants.js";
import { dbf, dbd } from "../config/firebase.js";

// ==================== LOGGING HELPERS ====================
/**
 * Her socket için tutarlı kimlik bağlamı döner.
 * socketId  → anlık bağlantı (değişken)
 * userId    → Firebase kalıcı hash
 * persistentUserId → oturum boyunca sabit (12 saat)
 * username  → okunabilir isim
 */
export function resolveLogContext(socketId: string, users: Map<string, any>, overrideUserId?: string | null) {
  const user = users.get(socketId);
  return {
    socketId,
    userId:          overrideUserId ?? user?.userId ?? null,
    persistentUserId: user?.persistentUserId ?? null,
    username:        user?.username ?? null,
  };
}

/**
 * İki kullanıcı içeren eventler için (call, connection vb.)
 */
export function resolveLogContextPair(socketIdA: string, socketIdB: string, users: Map<string, any>) {
  const a = resolveLogContext(socketIdA, users);
  const b = resolveLogContext(socketIdB, users);
  return {
    user1: { socketId: a.socketId, userId: a.userId, persistentUserId: a.persistentUserId, username: a.username },
    user2: { socketId: b.socketId, userId: b.userId, persistentUserId: b.persistentUserId, username: b.username },
  };
}

export async function logToFirebase(event: string, data: Record<string, any>) {
  try {
    const now = new Date();
    const year  = now.getFullYear().toString();
    const month = TURKISH_MONTHS[now.getMonth()];
    const day   = String(now.getDate()).padStart(2, "0");
    const key   = `${Date.now()}_${event}`;

    const sanitized = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v ?? null])
    );

    await dbd.ref(`LOG/${year}/${month}/${day}/${key}`).set({
      event,
      timestamp: now.toISOString(),
      unixMs: Date.now(),
      ...sanitized,
    });
  } catch (err) {
    console.error("❗ Log write error:", err);
  }
}
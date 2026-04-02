import crypto from "crypto";
import { USER_ID_EXPIRY, STORY_EXPIRY } from "../config/constants.js";
import { dbf } from "../config/firebase.js";

// ==================== UTILITY FUNCTIONS ====================
export function generatePersistentUserId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function getOrCreatePersistentUserId(username: string, persistentUsers: Map<string, any>, clientPersistentId?: string): string {
  const now = Date.now();

  if (clientPersistentId && persistentUsers.has(clientPersistentId)) {
    const userData: any = persistentUsers.get(clientPersistentId);
    if (now - userData.lastSeen < USER_ID_EXPIRY && userData.username === username) {
      userData.lastSeen = now;
      persistentUsers.set(clientPersistentId, userData);
      return clientPersistentId;
    } else {
      persistentUsers.delete(clientPersistentId);
    }
  }

  const newPersistentId = generatePersistentUserId();
  persistentUsers.set(newPersistentId, { username, lastSeen: now, createdAt: now });
  return newPersistentId;
}

export async function trackConnection(socketIdA: string, socketIdB: string, activeConnections: Map<string, any>, users: Map<string, any>, io: any) {
  const connectionId = [socketIdA, socketIdB].sort().join("-");
  activeConnections.set(connectionId, { users: [socketIdA, socketIdB], timestamp: Date.now() });
  console.log(`[${new Date().toISOString()}] Connection tracked: ${socketIdA} <-> ${socketIdB}`);
  const { logToFirebase, resolveLogContextPair } = await import("../utils/logging.js");
  await logToFirebase("CALL_CONNECTED", resolveLogContextPair(socketIdA, socketIdB, users));
  broadcastOnlineUsers(activeConnections, users, io);
}

export async function removeConnection(socketIdA: string, socketIdB: string, activeConnections: Map<string, any>, users: Map<string, any>, io: any) {
  const connectionId = [socketIdA, socketIdB].sort().join("-");
  if (!activeConnections.has(connectionId)) return;
  activeConnections.delete(connectionId);
  console.log(`[${new Date().toISOString()}] Connection removed: ${socketIdA} <-> ${socketIdB}`);
  const { logToFirebase, resolveLogContextPair } = await import("../utils/logging.js");
  await logToFirebase("CALL_ENDED", resolveLogContextPair(socketIdA, socketIdB, users));
  broadcastOnlineUsers(activeConnections, users, io);
}

export function getConnectedPartner(userId: string, activeConnections: Map<string, any>): string | null {
  for (const [_, connection] of activeConnections.entries()) {
    if (connection.users.includes(userId)) {
      return connection.users.find((id: string) => id !== userId) || null;
    }
  }
  return null;
}

export function isUserConnected(userId: string, activeConnections: Map<string, any>): boolean {
  return getConnectedPartner(userId, activeConnections) !== null;
}

export function getAllActiveStories(stories: Map<string, any>, persistentUsers: Map<string, any>, users: Map<string, any>) {
  const now = Date.now();
  const activeStories: any = {};

  for (const [persistentUserId, userStories] of stories.entries()) {
    const activeUserStories = userStories.filter((story: any) => now - story.createdAt < STORY_EXPIRY);

    if (activeUserStories.length > 0) {
      let userData = null;

      for (const [_, user] of users.entries()) {
        if (user.persistentUserId === persistentUserId) {
          userData = user;
          break;
        }
      }

      if (!userData && persistentUsers.has(persistentUserId)) {
        const persistentData: any = persistentUsers.get(persistentUserId);
        userData = {
          username: persistentData.username,
          profilePic: null,
          persistentUserId
        };
      }

      if (userData) {
        activeStories[persistentUserId] = {
          stories: activeUserStories.map((story: any) => ({
            ...story,
            viewers: Array.from(story.viewers || []),
            viewersCount: (story.viewers?.size || 0)
          })),
          user: userData,
        };
      }
    }
  }

  return activeStories;
}

export function broadcastOnlineUsers(activeConnections: Map<string, any>, users: Map<string, any>, io: any) {
  const usersList = Array.from(users.values())
    .filter(user => !user.hidden)
    .map(user => {
      const busy = isUserConnected(user.socketId, activeConnections);
      return {
        socketId: user.socketId,
        persistentUserId: user.persistentUserId,
        username: user.username,
        profilePic: user.profilePic,
        busy
      };
    });

  io.emit("online-users", usersList);
}
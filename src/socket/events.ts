import { Server } from "socket.io";
import { RESERVED_NAMES, AUTHORIZED_IPS, STALE_CONNECTION_TIMEOUT, STORY_EXPIRY, USER_ID_EXPIRY, CLEANUP_INTERVAL } from "../config/constants.js";
import { dbf } from "../config/firebase.js";
import { resolveLogContext, logToFirebase } from "../utils/logging.js";
import { isBanned, getRemainingBanTime, recordFailedAttempt, recordSuccessfulAttempt } from "../auth/bruteForce.js";
import { getOrCreatePersistentUserId, trackConnection, removeConnection, getConnectedPartner, isUserConnected, getAllActiveStories, broadcastOnlineUsers } from "../utils/helpers.js";

// ==================== DATA STRUCTURES ====================
export const users = new Map();
export const stories = new Map();
export const persistentUsers = new Map();
export const activeConnections = new Map();

// ==================== SOCKET.IO EVENTS ====================
export function setupSocketEvents(io: Server) {
  io.on("connection", (socket) => {
    const ip = (socket.handshake.headers["x-forwarded-for"] as string) || socket.handshake.address;
    const userAgent = socket.handshake.headers["user-agent"] || "unknown";
    const acceptLanguage = socket.handshake.headers["accept-language"] || "en";
    const timestamp = new Date().toISOString();

    // uid: Firebase kalıcı hash — auth sonrası set edilir
    let uid: string | null = null;

    console.log(`⚡ [${timestamp}] New connection: ${socket.id} (IP: ${ip})`);

    // -------- AUTHENTICATION
    socket.on("auth", async (userId: string) => {
      if (isBanned(ip, "auth")) {
        const remaining = getRemainingBanTime(ip, "auth");
        socket.emit("auth_failed", `${remaining} dakika sonra tekrar dene.`);
        socket.disconnect();
        return;
      }

      if (isBanned(ip, "auth")) { // Note: This seems duplicated, but keeping as is
        socket.emit("auth_failed", "Çok fazla istek.");
        socket.disconnect();
        return;
      }

      console.log(`🔑 [${timestamp}] Auth request: ${userId}`);

      try {
        if (!userId || userId.length < 8) {
          recordFailedAttempt(ip, "auth");
          console.error(`❌ [${timestamp}] Invalid userId format: ${userId}`);
          socket.emit("auth_failed", "Invalid user ID format");
          await logToFirebase("AUTH_FAILED", {
            reason: "invalid_user_id",
            userId,
            ip,
            socketId: socket.id,
          });
          return;
        }

        const userDoc = await dbf.collection("users").doc(userId).get();
        if (!userDoc.exists) {
          recordFailedAttempt(ip, "auth");
          console.log(`❌ [${timestamp}] User not found: ${userId}`);
          socket.emit("auth_failed", "User not found");
          await logToFirebase("AUTH_FAILED", {
            reason: "user_not_found",
            userId,
            ip,
            socketId: socket.id,
          });
          return;
        }

        uid = userId;
        const userData = userDoc.data();
        const username = userData?.username || "user_" + uid.slice(0, 4);

        if (RESERVED_NAMES.has(username.toLowerCase())) {
          const ipKey = ip.split(",")[0].trim();
          if (!AUTHORIZED_IPS.has(ipKey)) {
            console.log(`⛔ [${timestamp}] Reserved name attempt: ${username} from ${ipKey}`);
            await logToFirebase("AUTH_FAILED", {
              reason: "reserved_name",
              userId,
              username,
              ip,
              socketId: socket.id,
            });
            socket.emit("nickname-restricted", "This username is reserved");
            socket.disconnect();
            return;
          }
        }

        const usernameTaken = Array.from(users.values()).some(u => u.username === username);
        if (usernameTaken) {
          recordFailedAttempt(ip, "auth");
          console.log(`🚫 [${timestamp}] Username taken: ${username}`);
          socket.emit("nickname-taken", "Username already in use");
          await logToFirebase("AUTH_FAILED", {
            reason: "username_taken",
            userId,
            username,
            ip,
            socketId: socket.id,
          });
          socket.disconnect();
          return;
        }

        const clientPersistentId = userData?.persistentUserId;
        const persistentUserId = getOrCreatePersistentUserId(username, persistentUsers, clientPersistentId);

        // users map'ine userId'yi de kaydediyoruz — resolveLogContext için
        users.set(socket.id, {
          id: socket.id,
          userId: uid,              // ← Firebase kalıcı hash
          persistentUserId,
          username,
          profilePic: userData?.profilePic || null,
          socketId: socket.id,
          hidden: userData?.hidden || false,
          ip,
          userAgent,
          language: acceptLanguage
        });

        console.log(`🔐 [${timestamp}] Auth successful: ${username} (${persistentUserId})`);

        await logToFirebase("AUTH_OK", {
          ...resolveLogContext(socket.id, users, uid),
          ip,
          userAgent,
        });

        recordSuccessfulAttempt(ip, "auth");

        socket.emit("auth_ok", { userId: uid, user: userData });
        socket.emit("your-id", {
          socketId: socket.id,
          persistentUserId,
          username,
          profilePic: userData?.profilePic || null,
        });

        broadcastOnlineUsers(activeConnections, users, io);
        socket.emit("stories-updated", getAllActiveStories(stories, persistentUsers, users));

      } catch (err) {
        console.error(`❗ [${timestamp}] Auth error:`, err);
        socket.emit("auth_failed", "Authentication error: " + (err instanceof Error ? err.message : String(err)));
      }
    });

    // -------- UPDATE VISIBILITY
    socket.on("update-visibility", async ({ hidden }) => {
      const user = users.get(socket.id);
      if (user) {
        user.hidden = hidden;
        users.set(socket.id, user);

        try {
          await dbf.collection("users").doc(uid!).update({ hidden });
        } catch (err) {
          console.error("Visibility update error:", err);
        }

        broadcastOnlineUsers(activeConnections, users, io);
      }
    });

    // -------- P2P CALL HANDLING
    socket.on("call-user", ({ targetId, offer, cryptoPublicKey }) => {
      console.log(`📞 [${timestamp}] Call from ${socket.id} to ${targetId}`);

      if (isUserConnected(socket.id, activeConnections) || isUserConnected(targetId, activeConnections)) {
        socket.emit("call-rejected", { reason: "User is busy" });
        console.log(`❌ [${timestamp}] Call rejected: user busy`);
        return;
      }

      const targetUser = users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit("incoming-call", {
          from: socket.id,
          offer,
          cryptoPublicKey,
        });
      }
    });

    socket.on("call-rejected", ({ targetId, reason }) => {
      console.log(`❌ [${timestamp}] Call rejected from ${socket.id} to ${targetId}: ${reason}`);

      const targetUser = users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit("call-rejected", { reason });
      }
    });

    socket.on("send-answer", ({ targetId, answer, cryptoPublicKey }) => {
      console.log(`✅ [${timestamp}] Call answered: ${socket.id} -> ${targetId}`);

      trackConnection(socket.id, targetId, activeConnections, users, io);

      const targetUser = users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit("call-answered", { answer, cryptoPublicKey });
      }
    });

    socket.on("relay-message", ({ targetId, envelope }) => {
      const targetUser = users.get(targetId);
      if (!targetUser || !envelope || envelope.type !== "encrypted") return;

      io.to(targetUser.socketId).emit("relay-message", {
        from: socket.id,
        envelope,
      });
    });

    socket.on("send-ice-candidate", ({ targetId, candidate }) => {
      const targetUser = users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit("ice-candidate", { candidate });
      }
    });

    socket.on("connection-ended", ({ targetId }) => {
      console.log(`🛑 [${timestamp}] Connection ended: ${socket.id} -> ${targetId}`);

      removeConnection(socket.id, targetId, activeConnections, users, io);

      const targetUser = users.get(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit("peer-disconnected", { from: socket.id });
      }
    });

    // -------- STORIES
    socket.on("upload-story", async ({ data, type, caption }) => {
      if (!uid) return;

      const user = users.get(socket.id);
      if (!user) return;

      console.log(`📸 [${timestamp}] Story uploaded by ${user.username}`);
      await logToFirebase("STORY_UPLOADED", {
        ...resolveLogContext(socket.id, users, uid),
        type,
      });

      const storyId = `${uid}_${Date.now()}`;
      const story: any = {
        id: storyId,
        data,
        type,
        caption: caption || "",
        createdAt: Date.now(),
        userId: socket.id,
        persistentUserId: user.persistentUserId,
        viewers: new Set<string>()
      };

      if (!stories.has(user.persistentUserId)) {
        stories.set(user.persistentUserId, []);
      }

      const userStories: any[] = stories.get(user.persistentUserId) || [];
      userStories.push(story);
      stories.set(user.persistentUserId, userStories);

      if (persistentUsers.has(user.persistentUserId)) {
        const persistentData: any = persistentUsers.get(user.persistentUserId);
        persistentData.lastSeen = Date.now();
        persistentUsers.set(user.persistentUserId, persistentData);
      }

      io.emit("stories-updated", getAllActiveStories(stories, persistentUsers, users));
    });

    socket.on("story-viewed", async ({ storyId, persistentUserId }) => {
      const userStories = stories.get(persistentUserId);
      if (!userStories) return;

      const story = userStories.find((s: any) => s.id === storyId);
      if (!story) return;

      if (!story.viewers) {
        story.viewers = new Set();
      }

      story.viewers.add(uid!);
      console.log(`👁️ [${timestamp}] Story ${storyId} viewed by ${uid}`);
      await logToFirebase("STORY_VIEWED", {
        storyId,
        persistentUserId,           // hikaye sahibi
        viewer: resolveLogContext(socket.id, users, uid),  // kim izledi
      });
    });

    socket.on("delete-story", async ({ storyId }) => {
      if (!uid) return;

      const user = users.get(socket.id);
      if (!user) return;

      const userStories = stories.get(user.persistentUserId) || [];
      const updatedStories = userStories.filter((s: any) => s.id !== storyId);

      if (updatedStories.length !== userStories.length) {
        stories.set(user.persistentUserId, updatedStories);
        console.log(`🗑️ [${timestamp}] Story ${storyId} deleted by ${user.username}`);
        await logToFirebase("STORY_DELETED", {
          storyId,
          ...resolveLogContext(socket.id, users, uid),
        });
        io.emit("stories-updated", getAllActiveStories(stories, persistentUsers, users));
      }
    });

    // -------- PROFILE PICTURE UPDATE
    socket.on("update-profile-pic", async (base64Image) => {
      if (!uid) return;

      const user = users.get(socket.id);
      if (!user) return;

      console.log(`🖼️ [${timestamp}] Profile picture updated by ${user.username}`);

      try {
        await dbf.collection("users").doc(uid).update({
          profilePic: base64Image,
        });

        user.profilePic = base64Image;
        users.set(socket.id, user);

        broadcastOnlineUsers(activeConnections, users, io);
      } catch (err) {
        console.error("❗ Profile picture update error:", err);
      }
    });

    // -------- KEEPALIVE PING
    socket.on("ping", () => {
      socket.emit("pong");
    });

    // -------- DISCONNECT
    socket.on("disconnect", async () => {
      const user = users.get(socket.id);

      if (user && persistentUsers.has(user.persistentUserId)) {
        const persistentData: any = persistentUsers.get(user.persistentUserId);
        persistentData.lastSeen = Date.now();
        persistentUsers.set(user.persistentUserId, persistentData);
      }

      const connectedPartner = getConnectedPartner(socket.id, activeConnections);

      // resolveLogContext'i silmeden önce çağır
      const logCtx = resolveLogContext(socket.id, users, uid);
      users.delete(socket.id);

      console.log(`❌ [${timestamp}] Disconnected: ${socket.id}`);

      if (connectedPartner) {
        removeConnection(socket.id, connectedPartner, activeConnections, users, io);
        io.to(connectedPartner).emit("peer-disconnected", { from: socket.id });
        console.log(`ℹ️ [${timestamp}] Notified partner ${connectedPartner} about disconnect`);
      }

      io.emit("user-disconnected", socket.id);
      await logToFirebase("DISCONNECT", logCtx);
      broadcastOnlineUsers(activeConnections, users, io);
      io.emit("stories-updated", getAllActiveStories(stories, persistentUsers, users));
    });
  });
}

// ==================== CLEANUP ROUTINES ====================
export function setupCleanup(io: Server) {
  setInterval(async () => {
    const now = Date.now();

    for (const [persistentUserId, userStories] of stories.entries()) {
      const activeStories = userStories.filter((story: any) => now - story.createdAt < STORY_EXPIRY);
      if (activeStories.length === 0) {
        stories.delete(persistentUserId);
      } else {
        stories.set(persistentUserId, activeStories);
      }
    }

    for (const [persistentUserId, userData] of persistentUsers.entries()) {
      if (now - (userData as any).lastSeen > USER_ID_EXPIRY) {
        persistentUsers.delete(persistentUserId);
        stories.delete(persistentUserId);
      }
    }

    for (const [connectionId, connection] of activeConnections.entries()) {
      if (now - (connection as any).timestamp > STALE_CONNECTION_TIMEOUT) {
        activeConnections.delete(connectionId);
        console.log(`[${new Date().toISOString()}] Stale connection cleaned up: ${connectionId}`);
      }
    }

    try {
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const tokensSnap = await dbf.collection("tokens").where("createdAt", "<", oneWeekAgo).get();
      tokensSnap.forEach(doc => doc.ref.delete());
    } catch (err) {
      console.error("Error cleaning old tokens:", err);
    }

    io.emit("stories-updated", getAllActiveStories(stories, persistentUsers, users));
  }, CLEANUP_INTERVAL);
}

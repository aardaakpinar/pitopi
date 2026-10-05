import { ERROR_CODES } from "../../../config/constants.js";
import type { RegisterOn, SocketContext } from "../guard.js";
import { parseCall, parseRelay, parseReject, parseTarget } from "../validators.js";
import type { HandlerDeps } from "./types.js";

/**
 * Key exchange signalling and ciphertext relay. The server never sees
 * plaintext, and it refuses to relay anything between sockets that are not in
 * an accepted call with each other.
 */
export function registerCallHandlers(ctx: SocketContext, on: RegisterOn, deps: HandlerDeps): void {
  const { socket } = ctx;
  const { io, presence } = deps;

  on("call-user", { auth: true, bucket: "signal" }, (payload) => {
    const call = parseCall(payload);
    if (!call) return;

    const result = presence.startCall(socket.id, call.targetId);
    if (result === "busy") {
      socket.emit("call-rejected", { reason: ERROR_CODES.BUSY });
      return;
    }
    if (result !== "ok") {
      socket.emit("call-rejected", { reason: ERROR_CODES.UNAVAILABLE });
      return;
    }
    io.to(call.targetId).emit("incoming-call", { from: socket.id, cryptoPublicKey: call.cryptoPublicKey });
    deps.broadcaster.presenceChanged();
  });

  on("call-rejected", { auth: true, bucket: "signal" }, (payload) => {
    const rejection = parseReject(payload);
    if (!rejection) return;
    if (!presence.declineCall(socket.id, rejection.targetId)) return;
    io.to(rejection.targetId).emit("call-rejected", { reason: rejection.reason });
    deps.broadcaster.presenceChanged();
  });

  on("send-answer", { auth: true, bucket: "signal" }, (payload) => {
    const answer = parseCall(payload);
    if (!answer) return;

    if (!presence.acceptCall(socket.id, answer.targetId)) {
      // Nobody is waiting for this answer (expired, cancelled or forged).
      socket.emit("call-rejected", { reason: ERROR_CODES.UNAVAILABLE });
      return;
    }
    io.to(answer.targetId).emit("call-answered", { from: socket.id, cryptoPublicKey: answer.cryptoPublicKey });

    const a = presence.get(socket.id);
    const b = presence.get(answer.targetId);
    deps.audit.log("CALL_CONNECTED", { user1: a?.persistentUserId, user2: b?.persistentUserId });
    deps.broadcaster.presenceChanged();
  });

  on("relay-message", { auth: true, bucket: "relay" }, (payload) => {
    const relay = parseRelay(payload);
    if (!relay || !presence.inActiveCall(socket.id, relay.targetId)) return;
    io.to(relay.targetId).emit("relay-message", { from: socket.id, envelope: relay.envelope });
  });

  on("connection-ended", { auth: true, bucket: "signal" }, (payload) => {
    const target = parseTarget(payload);
    if (!target || !presence.endCall(socket.id, target.targetId)) return;
    io.to(target.targetId).emit("chat-disconnected", { from: socket.id });
    deps.audit.log("CALL_ENDED", { socketId: socket.id });
    deps.broadcaster.presenceChanged();
  });
}

import { PENDING_CALL_TTL_MS } from "../config/constants.js";
import type { CallRecord, OnlineUser, OnlineUserView } from "../domain/types.js";
import type { Clock } from "./ports.js";

export type StartCallResult = "ok" | "self" | "offline" | "busy";

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * In-memory presence and call state machine:
 *   startCall -> pending -> acceptCall -> active -> endCall
 * Messages may only be relayed between sockets in an *active* call, which is
 * what stops a client from pushing traffic at arbitrary users.
 */
export class PresenceService {
  private readonly users = new Map<string, OnlineUser>();
  private readonly socketByAccount = new Map<string, string>();
  private readonly calls = new Map<string, CallRecord>();

  constructor(private readonly now: Clock = Date.now) {}

  // ---- users ----
  count(): number {
    return this.users.size;
  }

  get(socketId: string): OnlineUser | undefined {
    return this.users.get(socketId);
  }

  allOnline(): IterableIterator<OnlineUser> {
    return this.users.values();
  }

  /** Sockets that authenticated with one of the given session hashes. */
  socketsBySession(hashes: ReadonlySet<string>): string[] {
    const out: string[] = [];
    for (const user of this.users.values()) if (hashes.has(user.sessionHash)) out.push(user.socketId);
    return out;
  }

  /** Session hashes currently attached to a live socket of this account. */
  onlineSessionHashes(accountId: string): Set<string> {
    const out = new Set<string>();
    for (const user of this.users.values()) if (user.accountId === accountId) out.add(user.sessionHash);
    return out;
  }

  /**
   * Registers a user. If the same account was already online (another tab or
   * a stale socket), the older socket is dropped: last login wins. The caller
   * must disconnect `replacedSocketId` and notify `orphanedPartners`.
   */
  register(user: OnlineUser): { replacedSocketId: string | null; orphanedPartners: string[] } {
    const previous = this.socketByAccount.get(user.accountId);
    let replacedSocketId: string | null = null;
    let orphanedPartners: string[] = [];
    if (previous && previous !== user.socketId) {
      replacedSocketId = previous;
      orphanedPartners = this.remove(previous);
    }
    this.users.set(user.socketId, user);
    this.socketByAccount.set(user.accountId, user.socketId);
    return { replacedSocketId, orphanedPartners };
  }

  /** Removes a user and all of its calls; returns the partners to notify. */
  remove(socketId: string): string[] {
    const user = this.users.get(socketId);
    const partners = this.dropCallsOf(socketId);
    if (user) {
      this.users.delete(socketId);
      if (this.socketByAccount.get(user.accountId) === socketId) {
        this.socketByAccount.delete(user.accountId);
      }
    }
    return partners;
  }

  setHidden(socketId: string, hidden: boolean): void {
    const user = this.users.get(socketId);
    if (user) user.hidden = hidden;
  }

  setProfilePic(socketId: string, profilePic: string | null): void {
    const user = this.users.get(socketId);
    if (user) user.profilePic = profilePic;
  }

  listVisible(): OnlineUserView[] {
    const busy = this.busySockets();
    return Array.from(this.users.values())
      .filter((u) => !u.hidden)
      .map((u) => ({
        socketId: u.socketId,
        persistentUserId: u.persistentUserId,
        username: u.username,
        profilePic: u.profilePic,
        busy: busy.has(u.socketId),
      }));
  }

  // ---- calls ----
  private busySockets(): Set<string> {
    const busy = new Set<string>();
    for (const call of this.calls.values()) {
      busy.add(call.callerId);
      busy.add(call.calleeId);
    }
    return busy;
  }

  isBusy(socketId: string): boolean {
    for (const call of this.calls.values()) {
      if (call.callerId === socketId || call.calleeId === socketId) return true;
    }
    return false;
  }

  startCall(callerId: string, calleeId: string): StartCallResult {
    if (callerId === calleeId) return "self";
    if (!this.users.has(callerId) || !this.users.has(calleeId)) return "offline";
    if (this.isBusy(callerId) || this.isBusy(calleeId)) return "busy";
    this.calls.set(pairKey(callerId, calleeId), {
      callerId,
      calleeId,
      state: "pending",
      createdAt: this.now(),
    });
    return "ok";
  }

  /** Callee accepts a pending call made by `callerId`. */
  acceptCall(calleeId: string, callerId: string): boolean {
    const call = this.calls.get(pairKey(calleeId, callerId));
    if (!call || call.state !== "pending") return false;
    if (call.callerId !== callerId || call.calleeId !== calleeId) return false;
    call.state = "active";
    return true;
  }

  /** Callee declines a pending call made by `callerId`. */
  declineCall(calleeId: string, callerId: string): boolean {
    const call = this.calls.get(pairKey(calleeId, callerId));
    if (!call || call.state !== "pending") return false;
    if (call.callerId !== callerId || call.calleeId !== calleeId) return false;
    this.calls.delete(pairKey(calleeId, callerId));
    return true;
  }

  /** Ends a call (any state) between two sockets. */
  endCall(a: string, b: string): boolean {
    return this.calls.delete(pairKey(a, b));
  }

  inActiveCall(a: string, b: string): boolean {
    return this.calls.get(pairKey(a, b))?.state === "active";
  }

  private dropCallsOf(socketId: string): string[] {
    const partners: string[] = [];
    for (const [key, call] of this.calls) {
      if (call.callerId === socketId || call.calleeId === socketId) {
        partners.push(call.callerId === socketId ? call.calleeId : call.callerId);
        this.calls.delete(key);
      }
    }
    return partners;
  }

  /** Drops pending calls nobody answered; returns them so callers can be told. */
  expirePending(): CallRecord[] {
    const cutoff = this.now() - PENDING_CALL_TTL_MS;
    const expired: CallRecord[] = [];
    for (const [key, call] of this.calls) {
      if (call.state === "pending" && call.createdAt < cutoff) {
        expired.push(call);
        this.calls.delete(key);
      }
    }
    return expired;
  }
}

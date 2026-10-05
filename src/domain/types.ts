export interface UserRecord {
  /** Account id = scrypt hash of the key file token. Never sent to clients. */
  id: string;
  username: string;
  createdAt: number;
  profilePic: string | null;
  hidden: boolean;
}

/** What a client may learn about its own account. */
export interface PublicUser {
  username: string;
  profilePic: string | null;
  hidden: boolean;
}

export interface SessionRecord {
  accountId: string;
  expiresAt: number;
}

export interface OnlineUser {
  socketId: string;
  accountId: string;
  persistentUserId: string;
  username: string;
  profilePic: string | null;
  hidden: boolean;
}

export interface OnlineUserView {
  socketId: string;
  persistentUserId: string;
  username: string;
  profilePic: string | null;
  busy: boolean;
}

export type CallState = "pending" | "active";

export interface CallRecord {
  callerId: string;
  calleeId: string;
  state: CallState;
  createdAt: number;
}

export interface AuditEntry {
  event: string;
  timestamp: number;
  data: Record<string, unknown>;
}

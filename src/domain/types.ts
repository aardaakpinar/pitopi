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
  /** Creation time; sessions created before this field existed read as 0. */
  createdAt: number;
  /** Coarse, human-readable device label (e.g. "Chrome on Windows"). No IP is stored. */
  device: string;
  /** Stable random browser-install identifier used to replace duplicate logins. */
  deviceId?: string;
}

/** What a user may see about one of their own sessions. */
export interface SessionInfo {
  /** Opaque, non-secret handle (prefix of the stored token hash). */
  id: string;
  device: string;
  createdAt: number;
  expiresAt: number;
  current: boolean;
  online: boolean;
}

export interface OnlineUser {
  socketId: string;
  accountId: string;
  persistentUserId: string;
  /** Hash of the session token this socket authenticated with. */
  sessionHash: string;
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

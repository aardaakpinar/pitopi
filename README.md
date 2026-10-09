# Pitopi

A privacy-first chat where messages are encrypted in the browser before they leave it. No email, no phone number, no password: you sign in with a small key file.

## Story

Most chat apps start by asking who you are. Pitopi starts from the opposite question: what is the least a chat service needs to know about you? The answer turned out to be almost nothing. An account is a random key file that only you hold, and the server only relays messages it cannot read.

## Purpose

- Let two people talk without handing over personal information.
- Keep message content unreadable to the server, the database and the logs.
- Stay small and auditable: a TypeScript backend, a static frontend, no framework lock-in.

## Features

- **Key-file accounts**: sign up downloads a `.key` file; uploading it signs you in. Lose it and the account is gone, there is no recovery by design.
- **Unclaimed keys**: pending key registrations are deleted after one hour without a first login and removed immediately after that login; cleanup runs every five minutes.
- **Optional key-file password**: protect the key file with a password using PBKDF2 and AES-GCM in the browser. The server does not handle the password or change how authentication works.
- **End-to-end encrypted chat**: ECDH (P-256) key exchange, AES-GCM messages. The server relays ciphertext only, and only between two users who accepted a call.
- **Chat tools**: reply to, react to, edit, and delete messages; use optional read receipts, disappearing messages, and voice messages.
- **Safety number**: both sides see the same short code derived from their keys, available from the chat menu. Compare it through another channel to rule out a man-in-the-middle.
- **File sharing**: up to 10 MB, encrypted like messages; image metadata is stripped before sending.
- **Stories**: image stories that expire after 12 hours (max 5 per user), with view counts and visibility controls for everyone or selected people.
- **Profile and visibility**: profile picture, and an option to hide yourself from the online list.
- **Session management**: review and revoke active sessions; each account can have up to 10 sessions. Only a device label is stored, not an IP address.
- **Optional local chat history**: keep history on this device in IndexedDB, encrypted with AES-GCM using a key derived from your key file with HKDF. It is deleted on logout; disappearing messages are never stored.
- **Panic action**: available in Settings and the chat menu to clear local data and sign out.
- **Languages and UI**: Turkish, English, Russian, Azerbaijani; dark/light theme; installable as a PWA.

## Security

- **Sessions**: random, expiring tokens; only their hash is stored. The account id never leaves the server.
- **Input**: every socket payload is validated; images must be real raster data; the frontend never renders untrusted data as HTML; strict CSP, scripts from `self` only.
- **Abuse limits**: per-IP rate limit and brute-force ban (checked before any expensive work), per-socket event budgets, size limits, per-user story cap.
- **Web**: Helmet headers, no wildcard CORS, WebSocket origin check, POST-only state changes, and microphone access limited to same-origin pages.
- **Audit logs**: structured, sanitised and length-bounded; IP addresses are pseudonymised. Firebase Realtime Database audit entries are automatically deleted after 90 days (daily partitions can add up to one extra day). Existing date-partitioned logs are cleaned in batches after deployment; the cleanup cursor is stored under `LOG_META/retentionCursor`.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

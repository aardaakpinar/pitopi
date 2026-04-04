# Pitopi

![Status](https://img.shields.io/badge/status-active-brightgreen.svg) ![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?logo=node.js) ![License](https://img.shields.io/badge/license-GPLv3-blue.svg) ![Firebase](https://img.shields.io/badge/service-Firebase-orange.svg)

Pitopi is a privacy-first, peer-to-peer chat platform where every connection is direct, encrypted, and ephemeral. Users authenticate with a 96-byte key file instead of passwords or personal information, and the server merely coordinates signaling, logging, and housekeeping while all media flows directly through WebRTC.

## Features
- **Key-based sign-up/login**: `GET /signup` produces a downloadable 96-byte `.key` token; `POST /login` accepts that token via `multipart/form-data` to create or resume a user session.
- **WebRTC-powered calls**: Socket.IO handles signaling (`call-user`, `send-answer`, `send-ice-candidate`) so peers can instantly open an end-to-end encrypted channel.
- **Stories with expiration**: Upload, view, and delete short-lived stories that vanish after 12 hours; server-side storage tracks viewers and broadcasts totals in real time.
- **Security-first protections**: IP rate limiting, brute-force tracking, reserved-name enforcement, periodic cleanup of stale tokens/connections, and Firebase logging for every major event.
- **Profile & visibility controls**: Users can update profile pictures, toggle visibility, and the online roster reflects hidden/busy status immediately.
- **Open-source stack**: TypeScript backend, static `app/` frontend assets, and optional docs in `docs/`.

## Architecture overview
- `src/server.ts`: Express + Socket.IO server entry point that serves `app/`, loads auth routes, initializes Firebase, and wires socket event handlers.
- `src/auth`: Signup/login flow with token management, brute-force counters, rate limiting, and error logging helpers.
- `src/socket`: Socket.IO event handlers for auth, calls, stories, profile updates, cleanup, and Firebase logging hooks.
- `src/config`: Shared constants (timeouts, quotas, reserved names) and Firebase initialization.
- `src/utils`: Connection tracking, story aggregation, logging context helpers, and online user broadcasting.
- `app/`: Frontend UI (HTML/CSS/JS) that consumes Socket.IO events and delivers the user experience.
- `docs/`: Help and marketing assets for the static site.

## Requirements
1. Node.js 18+ (see `engines.node` in `package.json`).
2. Firebase service account credentials stored as `firebase-key.json` in the project root (never commit this file).
3. npm (or another Node package manager) for installing dependencies.

## Setup
```bash
git clone https://github.com/pitopichat/pitopi.git
cd pitopi
npm install
```
1. Place your Firebase service account JSON at `firebase-key.json` (keep this secret).
2. Optionally set `PORT` or other env vars before running the server (defaults to 3000).

## Development workflow
1. `npm run dev` – run `tsx` directly against `src/server.ts` for fast iterations.
2. `npm run watch` – `ts-node-dev` with automatic restarts on change.
3. `npm run build` – compile TypeScript to `dist/` and mirror static assets via `scripts/copy-app.js`.
4. `npm start` – run the compiled server from `dist/src/server.js` for production-like behavior.

## Key endpoints & events
- `GET /signup`: rate-limited generation of a `.key` token with 64 bytes of randomness + 32 bytes of salt.
- `POST /login`: accepts a 96-byte file upload, hashes it, and ensures the user record exists in Firestore.
- Socket.IO lifecycle events: `auth`, `stories-updated`, `call-user`, `send-answer`, `send-ice-candidate`, `connection-ended`, `update-profile-pic`, `ping`, `disconnect`, etc.
- Internal cleanup: tokens older than a week are pruned, stories expire after 12 hours, stale connections/timeouts cleaned hourly.

## Testing & quality
- `npm test` currently exits with an error placeholder (no automated tests yet). Add Jest/Mocha suites before relying on this command.

## Deployment notes
1. Run in a production environment with `NODE_ENV=production` and the Firebase credentials available.
2. Monitor the Firebase Realtime Database `LOG/...` tree because every event writes there; adjust logging frequency if needed.
3. Tokens and story data are periodically cleaned via `CLEANUP_INTERVAL` (see `src/socket/events.ts`); adjust those constants for heavier loads.
4. Ensure HTTPS (or a secure tunnel) in front of the server since it routes real user tokens.

## Contributing
1. Fork the repo, create a feature branch, implement your change, and open a Pull Request.
2. Keep TypeScript, modern JS, and Socket.IO idioms consistent with existing code.
3. When adding features touching Socket.IO events, update `src/socket/events.ts`, supporting `utils`, and Firebase logging.
4. Document any public API, route, or event change in `docs/` or a new markdown file.

## License
GPLv3 (GNU General Public License v3). See `LICENSE` for the full text and obligations.

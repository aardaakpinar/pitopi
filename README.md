# Pitopi

![Status](https://img.shields.io/badge/status-active-brightgreen.svg) ![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js) ![License](https://img.shields.io/badge/license-GPLv3-blue.svg)

A privacy-first chat where messages are encrypted in the browser before they leave it. No email, no phone number, no password: you sign in with a small key file.

## Story

Most chat apps start by asking who you are. Pitopi starts from the opposite question: what is the least a chat service needs to know about you? The answer turned out to be almost nothing. An account is a random key file that only you hold, and the server only relays messages it cannot read.

## Purpose

- Let two people talk without handing over personal information.
- Keep message content unreadable to the server, the database and the logs.
- Stay small and auditable: a TypeScript backend, a static frontend, no framework lock-in.

## Features

- **Key-file accounts**: sign up downloads a `.key` file; uploading it signs you in. Lose it and the account is gone, there is no recovery by design.
- **End-to-end encrypted chat**: ECDH (P-256) key exchange, AES-GCM messages. The server relays ciphertext only, and only between two users who accepted a call.
- **Safety number**: both sides see the same short code derived from their keys. Compare it through another channel to rule out a man-in-the-middle.
- **File sharing**: up to 10 MB, encrypted like messages; image metadata is stripped before sending.
- **Stories**: image stories that expire after 12 hours (max 5 per user), with view counts.
- **Profile and visibility**: profile picture, and an option to hide yourself from the online list.
- **Languages and UI**: Turkish, English, Russian, Azerbaijani; dark/light theme; installable as a PWA.

## Security

- **Sessions**: random, expiring tokens; only their hash is stored. The account id never leaves the server.
- **Input**: every socket payload is validated; images must be real raster data; the frontend never renders untrusted data as HTML; strict CSP, scripts from `self` only.
- **Abuse limits**: per-IP rate limit and brute-force ban (checked before any expensive work), per-socket event budgets, size limits, per-user story cap.
- **Web**: Helmet headers, no wildcard CORS, WebSocket origin check, POST-only state changes.
- **Logs**: sanitised and length-bounded; IP addresses are pseudonymised.

Limitations:

- The safety number only protects users who actually compare it.
- Presence, calls and stories live in memory, so run a single instance (moving them to Redis is needed to scale out).
- No account recovery.

## Setup

**Requirements:** Node.js 22+, a Firebase project (Firestore and Realtime Database).

```bash
git clone https://github.com/pitopichat/pitopi.git
cd pitopi
npm install
cp .env.example .env
```

**Configure** `.env` (never commit it):

| Variable                        | Description                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SERVER_SECRET`                 | Required in production, 32+ random characters (`openssl rand -hex 32`).                              |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account JSON (preferred), or set `FIREBASE_SERVICE_ACCOUNT_PATH` to a file outside the repo. |
| `FIREBASE_DATABASE_URL`         | Your Realtime Database URL.                                                                          |
| `TRUST_PROXY_HOPS`              | Reverse proxies in front of the app: `1` on Render/Heroku/Cloud Run, `0` if exposed directly.        |
| `ALLOWED_ORIGINS`               | Optional extra browser origins, comma separated.                                                     |
| `PORT`                          | Defaults to `3000`.                                                                                  |

**Lock down Firebase** (clients must never access the database directly; the server uses the Admin SDK):

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules,database --project <your-project-id>
```

**Run**

```bash
npm run dev     # builds CSS, then runs the server with auto-reload
npm run dev:css # optional, second terminal: rebuild CSS while editing markup
```

**Production**

```bash
npm run build   # Tailwind CSS + TypeScript + copy of app/ into dist/
NODE_ENV=production npm start
```

Serve it over HTTPS.

## License

GPL-3.0-only. See [LICENSE](LICENSE).

## Yeni özellikler

- **Yerel şifreli geçmiş (isteğe bağlı):** Ayarlar > "Sohbet geçmişini bu cihazda sakla". IndexedDB + AES-GCM; anahtar, anahtar dosyasından HKDF ile türetilir, çıkışta silinir. Kaybolan mesajlar asla kaydedilmez.
- **Anahtar dosyası parolası:** Ayarlar > "Anahtar dosyasını parolayla koru" (PBKDF2 + AES-GCM, tarayıcıda; sunucu aynı kaldı). Kayıt ekranında da isteğe bağlı.
- **Oturum yönetimi:** Ayarlar > "Aktif oturumlar" (cihaz etiketi tutulur, IP tutulmaz; hesap başına en fazla 10 oturum).
- **Hikaye görünürlüğü:** Herkes / seçili kişiler (sunucu yetkisiz kişiye görüntüyü vermez).
- **Sohbet:** yanıtlama, tepki, düzenleme, silme, okundu bilgisi (kapatılabilir), kaybolan mesajlar, sesli mesaj.
- **Panik:** Ayarlar veya sohbet menüsü; yerel veriyi siler ve oturumu kapatır.
- Güvenlik kodu artık sohbet menüsünde ("Güvenlik kodu").

Not: `npm run build:css` çalıştırın. Mikrofon için `Permissions-Policy` değeri `microphone=(self)` yapıldı.

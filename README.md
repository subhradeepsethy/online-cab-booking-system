# Cab System

Cab System is an Uber/Ola-style cab booking platform with rider, driver and admin apps. The repository is split into a React client (`frontend/`) and an Express + Socket.IO API (`backend/`).

## Features

- **Accounts**: riders and drivers sign up with an SMS-verified mobile number and a password, and can reset a forgotten password by SMS. Sessions are HttpOnly cookies. Admin accounts can't self-register.
- **Rider app** (`/rider`): Google Places search, current location, saved Home/Work places, upfront fares for Bike, Auto, Mini, Sedan and SUV, promo codes, ride now or schedule up to 7 days ahead, cash/UPI/card, live driver tracking, ride OTP, cancellation (with a fee once the driver is on the way), and driver rating.
- **Driver app** (`/driver`): document upload and verification (`/driver/documents`), online/offline toggle, live GPS sharing, requests matched to vehicle type with rider rating, accept/decline, navigate, OTP-verified start, complete, rate the rider, and an earnings page with a 7-day chart.
- **Admin console** (`/admin`): live KPIs and a 7-day revenue/trips chart, all rides with search and force-cancel, driver document review with approve/reject, and block/unblock for riders and drivers.
- **Real-time updates**: Socket.IO pushes ride, request and account changes instantly; screens fall back to polling if the socket drops.

Ride lifecycle: `scheduled →` `requested → accepted → arrived → in_progress → completed`, or `cancelled`. Scheduled rides are released to drivers 15 minutes before pickup. If a driver cancels, the request goes back to other drivers; unaccepted requests expire after 10 minutes.

Business rules:

- **Promo codes**: `WELCOME50` (50% off the first ride, up to ₹100), `RIDE20` (20% off, up to ₹75), `FLAT30` (₹30 off fares of ₹150+). Drivers always earn the full pre-discount fare.
- **Cancellation fee** (paid to the driver): free while searching and for 3 minutes after a driver accepts, then ₹25; ₹50 once the driver has arrived.
- **Driver approval**: new drivers upload a driving licence, RC and insurance (JPG/PNG/WEBP/PDF, max 3 MB), and an admin must approve them before they can go online. Replacing a document sends the account back for review.

Data is stored in a SQLite database at `backend/data/cab.sqlite` and uploaded documents in `backend/data/uploads/` (both ignored by git). A `db.json` from older versions is imported automatically on first start and kept as `db.json.migrated-*`. Delete the `data` folder to reset everything.

## Requirements

- Node.js 20.19 or newer (22 LTS recommended)
- npm 10 or newer

## Setup

```bash
cd backend
npm install
copy .env.example .env   # then set AUTH_SECRET to a long random string

cd ../frontend
npm install
copy .env.example .env
```

On macOS or Linux, use `cp` instead of `copy`.

### Backend environment

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `5000`). |
| `CORS_ORIGIN` | Web app origin (default `http://localhost:5173`). |
| `AUTH_SECRET` | Secret used to sign login sessions. Required in production; without it in development, everyone is logged out on each restart. |
| `DATA_DIR` | Folder for the SQLite database, uploads and backups (default `data`). |
| `SEED_DEMO_ACCOUNTS` | Create demo accounts on startup (default `true` outside production). |
| `REQUIRE_DRIVER_APPROVAL` | New drivers need admin approval before going online (default `true`). |
| `ADMIN_PHONE`, `ADMIN_PASSWORD` | Optional admin account created on startup (use this in production; password 12+ characters). |
| `TRUST_PROXY` | Number of reverse proxies in front of the API, so rate limits see real client IPs (default `0`). |
| `REQUIRE_PHONE_VERIFICATION` | Require an SMS code at sign-up (default `true`). |
| `SMS_PROVIDER` | `console` (development: codes are printed in the server log and shown on screen), `msg91` or `twilio` (production). See `.env.example` for their keys. |
| `STATIC_DIR` | Built website to serve from the API (default `../frontend/dist` in production). |

`CORS_ORIGIN` accepts a comma-separated list. `SEED_DEMO_ACCOUNTS` now defaults to `false`.

## Run Locally

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`. Port 5000 is the API only.

### Demo accounts

| Role | Mobile | Password |
| --- | --- | --- |
| Rider | `9000000001` | `demo1234` |
| Driver (Mini, pre-approved) | `9000000002` | `demo1234` |
| Admin (`/admin/login`) | `9000000000` | `admin1234567` |

Demo accounts exist only when `SEED_DEMO_ACCOUNTS=true` (local development). The server refuses to start in production with it enabled.

Rider, driver and admin sessions are stored separately, so you can test everything in one browser: log in as the rider in one tab and the driver in another, put the driver online, book a **Mini**, accept it, enter the OTP shown to the rider, and complete the trip. Watch it live from the admin console in a third tab. To try driver verification, sign up a new driver, upload documents, then approve them under **Admin → Drivers**.

## API Overview

| Method & path | Who | Purpose |
| --- | --- | --- |
| `POST /api/auth/otp` | public | Send an SMS code (`purpose`: `signup` or `reset`). |
| `POST /api/auth/register`, `POST /api/auth/login` | public | Create account (needs `otpCode`) / log in. Sets the session cookie. |
| `POST /api/auth/password/reset` | public | Set a new password with an SMS code; logs out every session. |
| `POST /api/auth/logout` | any | End all sessions and clear the cookie. |
| `GET /api/auth/me` | any | Current user. |
| `GET /api/rides/types` | public | Ride types, payment methods, promos, cancellation policy. |
| `POST /api/rides/estimate` | public (rider token optional) | Fare quotes, with `promoCode` applied. |
| `POST /api/rides` | rider | Request a ride (optional `scheduledFor`, `promoCode`). |
| `GET /api/rides/active`, `/upcoming`, `/`, `/:id` | rider/driver | Active ride, scheduled rides, history, one ride. |
| `POST /api/rides/:id/cancel` | rider/driver | Cancel (rider, fee may apply) or hand back to the pool (driver). |
| `POST /api/rides/:id/rate` | rider | Rate the driver 1–5. |
| `PUT`/`DELETE /api/me/places/{home,work}` | rider | Save or remove a place. |
| `PATCH /api/driver/availability`, `PUT /api/driver/location` | driver | Go online/offline, share location. |
| `PUT /api/driver/documents/:type`, `GET …/:type/file` | driver | Upload (`{ fileName, mimeType, dataBase64 }`) or view `license`, `rc`, `insurance`. |
| `GET /api/driver/requests`, `GET /api/driver/summary` | driver | Open requests, earnings with a 7-day series. |
| `POST /api/driver/rides/:id/{accept,decline,arrive,start,complete,rate}` | driver | Trip actions (`start` needs `{ otp }`, `rate` rates the rider). |
| `GET /api/admin/overview` | admin | KPIs and 7-day revenue/trips. |
| `GET /api/admin/rides`, `POST /api/admin/rides/:id/cancel` | admin | All rides (`status`, `q` filters), force-cancel. |
| `GET /api/admin/users?role=driver\|customer`, `PATCH /api/admin/users/:id` | admin | List users; `{ blocked }` or `{ approvalStatus, note }`. |
| `GET /api/admin/users/:id/documents/:type` | admin | View a driver's document. |

Browsers authenticate with the HttpOnly cookie for the role named in the `X-Session-Role` header; API clients can send `Authorization: Bearer <token>` (add `X-Auth-Mode: token` to login to receive one). Socket.IO uses the same cookie with `auth: { role }` (or `auth: { token }`) and emits `ride:changed`, `requests:changed`, `account:changed` and `admin:changed`; clients refetch over REST when they arrive.

## Security

What the app enforces:

- **Passwords**: scrypt (N=2^17, r=8, p=1) with per-user salts; older hashes are upgraded on login. Minimum 8 characters (12 for admins). Login timing doesn't reveal which numbers are registered.
- **Sessions**: HMAC-signed tokens in HttpOnly, `SameSite=Strict` cookies (`Secure` and `__Host-` in production), so page scripts never see them. Lifetimes are 7 days, or 12 hours for admins. Logout, password reset and blocking revoke all of a user's sessions server-side. CSRF is blocked by SameSite, a required custom header, and Origin checks.
- **Brute force**: per-IP limits on login/sign-up (20 per 15 min), per-account lockout after 5 wrong passwords, and 5 OTP attempts per ride. SMS codes are hashed, expire after 10 minutes and allow 5 tries, with a 60-second resend cooldown and 5 texts per hour per number. Booking and upload limits per account.
- **Access control**: every route checks the role from the database; users can only see their own rides and documents; admins can't self-register; phone numbers are shared only during an active trip; every admin action is recorded (`GET /api/admin/audit-log`).
- **Input handling**: lengths and types validated on every field, control characters stripped, prototype-pollution names rejected, uploads checked by file signature, 100 KB body limit (5 MB only for authenticated document uploads), fares computed server-side with client distances bounded by GPS geometry.
- **Headers**: Helmet on the API (strict CSP, HSTS, nosniff, `no-store` caching); a CSP meta tag in the production frontend build; `frontend/public/_headers` for hosts that support it.
- **Database**: SQLite with WAL journaling and full sync (crash-safe), a unique (role, phone) index, owner-only file permissions, and `npm run backup` for online backups.

Before going live, follow [DEPLOY.md](DEPLOY.md). In short:

1. Set `NODE_ENV=production`, a fresh `AUTH_SECRET`, `CORS_ORIGIN=https://your-site`, `ADMIN_PHONE`/`ADMIN_PASSWORD`, and `TRUST_PROXY` to match your host.
2. Start from an empty `backend/data` folder (the local one contains the demo accounts) and keep it out of any public web folder. Back it up regularly.
3. Serve both the site and the API over HTTPS only.
4. Restrict the Google Maps key (see below). A browser Maps key can't be hidden: anything a website uses is visible to its visitors. Google's restrictions are what stop others from using it.
5. If your host doesn't read `_headers`, add `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` in its settings.

## Google Maps

Set `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env` to enable address autocomplete, road distances for fares, and map routes. In Google Cloud, enable Maps JavaScript API, Places API, Geocoding API and Routes API. Then, under **APIs & Services → Credentials**, edit the key: set **Application restrictions → Websites** to your site (e.g. `https://cabs.example.com/*`, plus `http://localhost:5173/*` for development) and **API restrictions** to only those four APIs. Also set a daily quota cap so a leaked key can't run up a bill. Without a key the app still works: addresses are typed manually and distances are estimated.

## Verification

```bash
cd backend
npm test
npm run lint

cd ../frontend
npm run lint
npm run build
```

Keep secrets in local `.env` files only. Update the relevant `.env.example` and this README whenever configuration or development commands change.

# Deploying Cab System

In production a single Node service serves both the website and the API from one HTTPS address. Keeping one origin is what makes the secure session cookies (`SameSite=Strict`, `__Host-`) and real-time updates work without cross-site workarounds.

You need:

- A **persistent disk/volume**. The SQLite database (`cab.sqlite`) and uploaded driver documents live in `DATA_DIR`; without a persistent disk they are lost on every restart or redeploy.
- **One running instance**. Live updates and the in-memory working copy are per-process. Don't scale to multiple instances.
- An **SMS provider** for verification codes: MSG91 (common in India, requires DLT template registration) or Twilio.
- Your **Google Maps browser key**, restricted to your domain (see README → Google Maps).

## Option A: Render (simplest)

1. Push this project to a GitHub or GitLab repository. `.env` files and `backend/data` are git-ignored; keep it that way.
2. In Render, choose **New → Blueprint** and select the repository. Render reads `render.yaml` and creates one web service with a 1 GB disk mounted at `/var/data`. A disk needs a paid instance type; free instances lose data.
3. Fill in the values Render asks for:
   - `CORS_ORIGIN`: the site address, e.g. `https://cab-system.onrender.com` (or your own domain).
   - `ADMIN_PHONE` / `ADMIN_PASSWORD`: your admin login (password of 12+ characters).
   - `SMS_PROVIDER`: `msg91` with `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`, or `twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`.
   - `VITE_GOOGLE_MAPS_API_KEY`: your browser Maps key.
   - `AUTH_SECRET` is generated automatically. Never change it casually: doing so logs everyone out.
4. Deploy. The health check is `/api/health`. Open the site, log in at `/admin/login` with your admin number.
5. Custom domain (optional): add it under the service's **Settings → Custom Domains**, then update `CORS_ORIGIN` to it and add it to your Maps key's allowed websites.

## Option B: Any server with Docker

```bash
docker build -t cab-system --build-arg VITE_GOOGLE_MAPS_API_KEY=your_browser_key .
docker volume create cab-data
docker run -d --name cab-system --restart unless-stopped \
  -p 127.0.0.1:5000:5000 -v cab-data:/data \
  -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e CORS_ORIGIN=https://cabs.example.com \
  -e TRUST_PROXY=1 \
  -e ADMIN_PHONE=9xxxxxxxxx -e ADMIN_PASSWORD='a-long-admin-password' \
  -e SMS_PROVIDER=msg91 -e MSG91_AUTH_KEY=... -e MSG91_TEMPLATE_ID=... \
  cab-system
```

Save the generated `AUTH_SECRET` somewhere safe and reuse it when you recreate the container, or everyone is logged out. The container listens only on localhost; put an HTTPS reverse proxy in front. With [Caddy](https://caddyserver.com), which gets certificates automatically, the whole `Caddyfile` is:

```
cabs.example.com {
  reverse_proxy 127.0.0.1:5000
}
```

## Backups

- `npm run backup` (from the project root, or `docker exec cab-system npm run backup`) writes a consistent copy of the database to `DATA_DIR/backups/` and keeps the last 14. It is safe while the server runs. Schedule it daily (Render Cron Job, or `cron` on a server).
- Copy `DATA_DIR/backups` and `DATA_DIR/uploads` off the server regularly, e.g. to cloud storage. A backup on the same disk doesn't survive losing that disk.
- To restore: stop the service, replace `cab.sqlite` with a backup copy (delete `cab.sqlite-wal` and `cab.sqlite-shm`), start the service.

## The server refuses to start?

That's the production safety check. The log lists what to fix, typically a short `AUTH_SECRET`, a missing or non-https `CORS_ORIGIN`, `SEED_DEMO_ACCOUNTS=true`, or `SMS_PROVIDER=console`.

## Moving your local data

Don't upload your local `backend/data`: it contains the demo accounts with public passwords. Start production with an empty disk and create real accounts there.

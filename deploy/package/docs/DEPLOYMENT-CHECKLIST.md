# RMUDTS — Deployment checklist

Use this list for every production deployment. Tick each item only after you
have seen the result yourself; the installer's report is evidence, not a
substitute for the final checks in section 8.

Server values used below: replace `domain.com`, `api.domain.com` and
`CPANEL_USER` with your own.

---

## 1. Before you upload

- [ ] cPanel account exists, with Terminal or Cron access (Terminal is needed
      once for `npm ci`).
- [ ] `domain.com` resolves to the account and AutoSSL is active.
- [ ] The subdomain `api.domain.com` exists in cPanel → Domains.
- [ ] PHP 8.1 or newer is selected for the domain (MultiPHP Manager).
- [ ] MySQL database and user exist; the user is attached to the database with
      ALL PRIVILEGES. Note the exact prefixed names.
- [ ] You know the system email address (it must be a mailbox on this host).
- [ ] You have `RMUDTS_v1.0.zip` from the release build.
- [ ] `client/build/index.html` exists in the release that produced the ZIP
      (the packager refuses to build without it).

## 2. Upload and extract

- [ ] Upload the ZIP to `public_html/`.
- [ ] Extract it **inside** `public_html/`, so `public_html/install/index.php`
      and `public_html/index.php` exist.
- [ ] Delete the ZIP from `public_html/` after extraction.
- [ ] Confirm there is no `public_html/server`, `public_html/rmudts-app`,
      `public_html/rmudts-config` or `.env` file. The installer creates those
      outside the web root.

## 3. Run the wizard

- [ ] Open `https://domain.com/install/`.
- [ ] Step 1 Welcome — read the lock-file rule.
- [ ] Step 2 Requirements — every required check passes. Warnings may be
      accepted only after reading them.
- [ ] Step 3 Storage — the layout is outside `public_html`; create the folders.
- [ ] Step 4 Database — "Test Connection" succeeds with the cPanel names.
- [ ] Step 5 Provisioning — all six stages pass (`connect`, `tables`,
      `indexes`, `relationships`, `defaults`, `verify`).
- [ ] Step 6 Application — the URL is the real HTTPS address; the API URL is
      the API subdomain; timezone and system email are correct.
- [ ] Step 7 Administrator — the first super administrator is created; the
      password is stored in a password manager.
- [ ] Step 8 Security — keys are generated, and the checklist has no failure.
- [ ] Step 9 Summary — download the installation report and keep it with the
      handover notes.
- [ ] Step 10 Complete — `installed.lock` exists and the wizard refuses to run
      again.

## 4. cPanel Node.js application (administrator step)

The installer cannot create this application through an API. Complete it by
hand:

- [ ] cPanel → Setup Node.js App → Create Application.
- [ ] Node.js version: 20 LTS (18 minimum).
- [ ] Application mode: Production.
- [ ] Application root: `rmudts-app`.
- [ ] Application URL: `api.domain.com`.
- [ ] Startup file: `server.js`.
- [ ] Create, then open Terminal and run:

      cd /home/CPANEL_USER/rmudts-app
      npm ci --omit=dev

- [ ] Press Restart (or `touch rmudts-app/tmp/restart.txt`).
- [ ] Confirm `rmudts-app/.env` and `rmudts-config/.env` exist and are 600.
- [ ] Do not add `PORT` to `.env` or to the cPanel variable form.

## 5. Files that must not be public

Check each URL in a private browser window; all must return 403, 404 or a
redirect to the application — never a file download:

- [ ] `https://domain.com/.env`
- [ ] `https://domain.com/rmudts-config/.env`
- [ ] `https://domain.com/rmudts-config/config.php`
- [ ] `https://domain.com/rmudts-app/.env`
- [ ] `https://domain.com/database/schema.sql`
- [ ] `https://domain.com/server/server.js`
- [ ] `https://domain.com/install/.install-state.json`
- [ ] `https://domain.com/rmudts-logs/`
- [ ] `https://domain.com/rmudts-uploads/`

## 6. Frontend checks

- [ ] `https://domain.com/` redirects to `https://domain.com/rmudts/` (or serves
      the SPA directly when the front controller handles it).
- [ ] `https://domain.com/rmudts/` renders the sign-in page.
- [ ] `https://domain.com/rmudts/manifest.json` returns 200 and JSON.
- [ ] `https://domain.com/rmudts/runtime-config.js` returns 200 and defines
      `window.RMUDTS_CONFIG` with the API and Socket URLs.
- [ ] A deep link such as `/rmudts/dashboard` survives a browser refresh.
- [ ] A missing bundle (`/rmudts/static/js/does-not-exist.js`) returns 404, not
      the HTML shell.
- [ ] Browser console has no CORS, mixed-content or 404 errors.

## 7. API and realtime checks

- [ ] `https://api.domain.com/` returns JSON (not an Apache page).
- [ ] `https://api.domain.com/api/health` returns 200 with
      `"database":"connected"`.
- [ ] `https://api.domain.com/socket.io/?EIO=4&transport=polling` returns a
      handshake beginning with `0{`.
- [ ] Sign in with the administrator account works.
- [ ] A record can be created and its attachment uploaded.
- [ ] The Socket.IO connection appears in the browser Network tab (polling is
      acceptable when WebSockets are blocked).
- [ ] Two browsers signed in as different users receive live updates.

## 8. Final acceptance

- [ ] `/install/` shows "RMUDTS is already installed." and redirects to the app.
- [ ] `/install/upgrade.php` asks for the upgrade key; the key lives in
      `rmudts-config/upgrade.key` (outside `public_html`).
- [ ] The installation report contains no password, JWT secret, encryption key
      or API token.
- [ ] `rmudts-config/.env` is 600; `rmudts-config` is 700.
- [ ] `rmudts-app/node_modules` exists and `server.js` is the startup file.
- [ ] `installed.lock` exists in `install/` (or `rmudts-config/` if `install/`
      was read-only).
- [ ] `install/.install-state.json` does not exist.
- [ ] The database contains the 14 expected tables and the seeded reference
      rows.
- [ ] A schema snapshot exists in `rmudts-backups/manual/`.
- [ ] The newest install log exists in `rmudts-logs/installer/`.

## 9. Handover

- [ ] Give the administrator: the application URL, the username (not the
      password), the location of `rmudts-config/`, and the installation report.
- [ ] Schedule cPanel backups of `rmudts-uploads`, `rmudts-backups` and the
      database.
- [ ] Record the Node.js version and the date of this deployment.
- [ ] Keep `RMUDTS_v1.0.zip` and its `checksums.json` for the next upgrade.

# RMUDTS — Troubleshooting guide

Every symptom below is written for cPanel shared hosting. Work from the top of
the list: the first three checks (files published, `.htaccess`, permissions)
explain most failures.

Before changing anything, collect three facts: the exact URL and HTTP status
(browser → Developer tools → Network), the newest
`rmudts-logs/installer/installation-report-*.txt`, and the application log from
**cPanel → Setup Node.js App**.

Never paste `.env`, `config.php`, `installed.lock`, an SQL dump or a stack trace
into a public forum. The installation report contains no secrets and is safe to
share.

---

## 1. Blank or white React page

- A `ChunkLoadError` or a 404 on `/static/js/*` means the bundles are missing or
  have the wrong public path — see items 2 and 4.
- A JavaScript error mentioning an undefined component means the build came from
  the wrong source. Rebuild with `cd client && PUBLIC_URL=/rmudts/ npm run
  build`, then repackage.
- A CORS error means `CLIENT_ORIGIN` does not match the browser origin. Edit
  `rmudts-config/.env` and `rmudts-app/.env`, then restart the application.
- With no console error, open `https://domain.com/rmudts/runtime-config.js`. It
  must define `window.RMUDTS_CONFIG`. A 404 or HTML response means the file was
  not published — re-run the summary step or the upgrade in config mode.

## 2. Incorrect /rmudts/ asset paths

`index.html` requests `/static/js/...` at the domain root instead of
`/rmudts/static/js/...`. The React build must be compiled with
`PUBLIC_URL=/rmudts/`. The archive ships such a build. Rebuild, republish the
frontend, and hard-refresh (Ctrl/Cmd+Shift+R).

## 3. manifest.json returns 403 or 404

- **404:** `public_html/rmudts/manifest.json` is missing — the build was copied
  incompletely. Publish the frontend again.
- **403:** a `<FilesMatch>`/`Require all denied` rule is too broad. It may block
  `.env`, `.lock`, `.sql`, `.log` and dotfiles, not `.json`.
- HTML instead of JSON means the request fell through to the SPA; confirm the
  `RewriteCond %{REQUEST_FILENAME} -f` line exists in the frontend `.htaccess`.

## 4. JavaScript bundles returning 404

- Confirm the file exists under `public_html/rmudts/static/js/`.
- Bundle names are content-hashed. A new build removes the old names on purpose;
  a cached `index.html` can still point at them. Serve `index.html` with
  `no-cache` (the shipped `.htaccess` does) and refresh.
- A 403 rather than 404 means wrong modes: folders 755, files 644.

## 5. React Router refresh returns 404

Navigating inside the app works but refreshing `/rmudts/dashboard` shows
Apache's 404. `mod_rewrite` is not sending unknown paths to `index.html`.
Confirm the `RewriteBase /rmudts/` block in `public_html/rmudts/.htaccess` and
that the domain's document root is `public_html` with `AllowOverride` enabled.

## 6. API subdomain returns 403

- The subdomain's document root points at `public_html` instead of the Node.js
  application, or an `index.php`/`.htaccess` was left in `rmudts-app`. That
  folder must contain only the backend.
- Recreate the subdomain in cPanel with the correct root, attach the Node.js
  application, and check folder modes (755/644, `.env` 600).

## 7. API subdomain returns 500 or 503

- **503:** Passenger cannot start the app. Usual causes: wrong startup file
  (must be `server.js`), missing dependencies (`npm ci --omit=dev`), or Node.js
  older than 18.
- **500:** the app started and threw. Confirm `rmudts-config/.env` and
  `rmudts-app/.env` exist, are readable, and contain `DB_*`.
- Always press **Restart** after changing `.env`; Passenger caches the
  environment of a running application.

## 8. Node.js application not starting

1. Open cPanel → Setup Node.js App → the application log.
2. `Cannot find module 'express'` → dependencies not installed.
3. `Cannot find module '.../server.js'` → wrong application root or startup
   file.
4. `EACCES` → the application user cannot read `rmudts-config` or write
   `rmudts-uploads`, `rmudts-logs`, `rmudts-data`.
5. `EADDRINUSE` under Passenger means a second copy was started by hand; stop it
   and restart the cPanel application.

## 9. Incorrect startup filename

The only correct value is `server.js`. `app.js`, `index.js` and `src/server.js`
produce 503. The installer copies `server/server.js` to `rmudts-app/server.js`;
if it is missing, the copy step failed — re-run the summary/finish step.

## 10. npm dependencies not installed

In cPanel → Terminal:

```
cd /home/CPANEL_USER/rmudts-app
npm ci --omit=dev
```

`npm ci` requires `package-lock.json`; without it use `npm install --omit=dev`.
Never copy `node_modules` from Windows: `sharp` and `bcrypt` are
platform-specific. The archive deliberately excludes `node_modules`.

## 11. Database access denied

`SQLSTATE[HY000] [1045] Access denied for user ...`

- cPanel prefixes both names: `account_rmudts` and `account_rmudts_user`.
- Add the user to the database in **MySQL Databases** with ALL PRIVILEGES.
- Shared hosting uses `DB_HOST=localhost`; a managed host may need a hostname.
- A password containing spaces or `#` must be quoted in `.env`. Regenerate the
  file through the installer or the upgrade in config mode after editing by hand.

## 12. Missing environment variables

- The backend reads `.env` from its working directory (`rmudts-app/.env`); the
  installer also writes `rmudts-config/.env`. Both must exist and match.
- Values containing a space or `#` must be wrapped in double quotes.
- `PORT` must not be set: Passenger supplies it. A fixed port makes the app bind
  the wrong socket and the health check fails.
- Do not duplicate cPanel variables with different values; the `.env` file wins
  because the backend loads it with `override: true`.

## 13. Socket.IO returning 404

Open `https://api.domain.com/socket.io/?EIO=4&transport=polling`. It must return
a handshake beginning with `0{`. A 404 means the request never reached Node: the
subdomain is not attached to the application, or a proxy intercepts
`/socket.io`.

## 14. Socket.IO client connecting to the wrong origin

The SPA reads `SOCKET_URL` from `rmudts/runtime-config.js`. If it points at the
frontend domain, the socket talks to PHP (400 on upgrade, 404 on polling). Edit
`rmudts-config/.env`, re-run the summary step or the config upgrade so
`runtime-config.js` is rewritten, then hard-refresh.

## 15. Mismatched Socket.IO paths

The default path is `/socket.io`. If `SOCKET_PATH` differs between `.env` and
`runtime-config.js`, clients connect to a path the server does not serve. Keep
both at `/socket.io` unless the host proxy requires another value, and change
both together.

## 16. WebSocket upgrade failure

Some shared hosts block WebSocket upgrades at the proxy. Socket.IO is configured
with `transports: ["polling", "websocket"]`, so it falls back to long polling and
the application keeps working. Enable the host's proxy for the API subdomain if
true WebSockets are required.

## 17. CORS errors

The backend allows exactly the origins in `CLIENT_ORIGIN` (comma-separated):

```
CLIENT_ORIGIN=https://domain.com,https://www.domain.com
```

Use origins only — scheme and host, no path, no trailing slash. `http://` and
`https://` are different origins. Restart the application after editing.

## 18. Mixed-content HTTP/HTTPS errors

All URLs must be `https://`; an HTTPS page cannot call an HTTP API. Correct
`APP_URL`, `CLIENT_URL`, `CLIENT_ORIGIN`, `API_URL` and `SOCKET_URL`, re-run the
configuration step, and confirm `runtime-config.js` shows `https://`. Enable
AutoSSL for the domain and the API subdomain.

## 19. File permission errors

```
find /home/CPANEL_USER/public_html/rmudts -type d -exec chmod 755 {} +
find /home/CPANEL_USER/public_html/rmudts -type f -exec chmod 644 {} +
chmod 700 /home/CPANEL_USER/rmudts-config /home/CPANEL_USER/rmudts-data \
  /home/CPANEL_USER/rmudts-logs /home/CPANEL_USER/rmudts-uploads \
  /home/CPANEL_USER/rmudts-backups /home/CPANEL_USER/rmudts-restore \
  /home/CPANEL_USER/rmudts-app
chmod 600 /home/CPANEL_USER/rmudts-config/.env \
  /home/CPANEL_USER/rmudts-config/config.php
```

Never use 777. The installer writes the right modes; File Manager uploads and
repair scripts are what usually reset them.

## 20. cPanel Passenger environment-variable issues

- Passenger ignores `export` from a terminal session.
- Do not set `PORT` in `.env` or in cPanel's variable form; it conflicts with the
  port Passenger assigns.
- If the host requires variables in the cPanel form, add the same names and
  values — without `PORT`.
- `NODE_ENV` must be `production`; `development` prints stack traces and is
  slower.

## 21. Restart versus redeploy

- **Restart** (cPanel button or `touch rmudts-app/tmp/restart.txt`) reloads the
  Node process. Required after any `.env` or code change.
- **Redeploy** is needed only when `package.json` changed: `npm ci --omit=dev`,
  then restart.
- New frontend files need no restart, only a browser refresh (hashed bundles).
- `config.php` is read per request; no restart is needed after the installer
  rewrites it.

---

## Still stuck?

1. Open the newest `rmudts-logs/installer/installation-report-*.txt`.
2. Check, in order: `https://domain.com/rmudts/` (frontend),
   `https://api.domain.com/` (API), `https://api.domain.com/api/health`
   (database), then the Socket.IO handshake from item 13.
3. If the frontend loads but the API does not, the problem is in cPanel's
   Node.js application, not in the React build.

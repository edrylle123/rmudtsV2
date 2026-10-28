# RMUDTS — Installation guide (cPanel)

RMUDTS is a records-management / document-tracking system: a React single-page
application, an Express + MySQL backend, and a PHP front controller that ties
them together on ordinary shared hosting.

This guide installs it from the release archive **`RMUDTS_v1.0.zip`** onto a
cPanel account, using the built-in installation wizard. No command line is
required, though cPanel → *Terminal* makes one step faster.

---

## 1. What you need before you start

| Requirement | Why | Where |
|---|---|---|
| cPanel account with **PHP 8.1+** | The wizard and front controller are PHP | cPanel → *MultiPHP Manager* |
| PHP extensions: `pdo`, `pdo_mysql`, `json`, `session`, `openssl`, `mbstring`, `fileinfo`, `zip`, `curl` | Database access, key generation, uploads | cPanel → *Select PHP Version* → Extensions |
| **Node.js 18+** and npm | Runs the backend API | cPanel → *Setup Node.js App* |
| A MySQL database + user | Application data | cPanel → *MySQL Databases* |
| ~300 MB free disk space | Frontend, backend, dependencies | — |

> **Check first:** extract the archive, open `https://your-domain/install` and
> let step 2 (*Requirements Check*) tell you exactly what is missing. It is
> read-only and safe to run at any time.

---

## 2. Upload and extract

1. In **cPanel → File Manager**, open `public_html` (or the document root of the
   domain the application should answer on).
2. Upload **`RMUDTS_v1.0.zip`**.
3. Right-click the archive → **Extract** → extract into `public_html`.
4. Delete the archive afterwards (it is not needed, and it keeps a copy of the
   backend source in the web root).

After extraction `public_html` contains:

```
public_html/
├── index.php          bootstrap → sends you to the wizard
├── .htaccess          pre-install safety rules
├── install/           the installation wizard
├── client/            built React frontend
├── server/            Express backend (moved out of the web root by the wizard)
├── database/schema.sql    imported by the wizard (also copied to ./schema.sql
│                          at the root for manual phpMyAdmin imports)
├── schema.sql
├── config/ storage/ backup/ logs/ uploads/ restore/   package placeholders
└── docs/              this guide
```

---

## 3. Run the wizard

Open:

```
https://your-domain/install
```

The wizard has ten steps, a progress percentage and Previous / Next / Cancel
controls. Nothing is written to your database or filesystem until a step says
so, and step 1 shows you exactly what will happen.

### Step 1 — Welcome
Lists what the wizard will configure. Press **Start Installation**.

### Step 2 — Requirements check
Verifies PHP version, extensions, Node.js/npm, write permissions, disk space and
package integrity. Every row is **PASS**, **WARNING** or **FAIL**; failures marked
with `*` stop the installation until they are fixed.

### Step 3 — File storage configuration
Confirms where each part of the system lives. The recommended layout keeps
everything sensitive outside the web root:

```
public_html/rmudts              compiled React build (the public site)
/home/<account>/rmudts-app       Node.js backend
/home/<account>/rmudts-config    .env, config.php, installed.lock copy
/home/<account>/rmudts-data      application data (tmp, cache, exports, imports)
/home/<account>/rmudts-logs      logs
/home/<account>/rmudts-uploads   user uploads
/home/<account>/rmudts-backups   backups
/home/<account>/rmudts-restore   restore staging
```

Press **Verify write permissions** to test every path, then **Create folders and
continue**. The wizard refuses any path that would place configuration, logs,
uploads or backups inside `public_html`, creates the folders, and writes a
protection file into each one.

### Step 4 — Database configuration
Enter the **host** (`localhost` on almost every cPanel host), **port** (`3306`),
**database name**, **MySQL username** and **password**. cPanel prefixes database
and user names with your account name, for example `myaccount_rmudts`.

Press **Test Connection** to verify, in one pass:

- the MySQL server is reachable,
- the credentials are valid,
- the database exists (or can be created),
- the account has the privileges the schema import needs.

### Step 5 — Database provisioning
**Test Connection & Provision** imports `database/schema.sql` and reports real
progress stage by stage:

```
Connecting…  →  Creating Tables…  →  Creating Indexes…  →  Creating
Relationships…  →  Loading Defaults…  →  Completed.
```

Every statement is idempotent (`CREATE TABLE IF NOT EXISTS`, upsert seed data).
Nothing is ever dropped, so the step is safe to re-run after a network blip.

### Step 6 — Application configuration
Application name, site URL, frontend/API URLs, system email, timezone,
environment and the loopback port for the backend. The wizard writes:

- `<backend>/.env` and `<config>/.env` — what the Node.js backend reads (mode `0600`)
- `<config>/config.php` — what the PHP front controller reads (mode `0600`, **no**
  database password: the front controller proxies to the backend over loopback)

### Step 7 — Administrator account
Creates the initial **super administrator** (first name, last name, username,
email, password + confirmation). The password is checked against a live policy
(10+ characters, upper, lower, digit, symbol, not a common password) and stored
as a **bcrypt hash, cost 12** — the same format the backend verifies.

### Step 8 — Security configuration
Generates the application key, encryption key, JWT secret, refresh-token secret,
API token and CSRF secret with `random_bytes()`, then applies:

- **Directory protection** — `Options -Indexes`, `IndexIgnore *`
- **Environment protection** — `.env`, `installed.lock`, `*.sql`, logs and editor
  backups blocked by rewrite rules and `FilesMatch`
- **Configuration protection** — private folders denied with `Require all denied`
- **Upload restrictions** — executable extensions denied, documents served as
  `text/plain`, `X-Content-Type-Options: nosniff`
- **Session security** — HttpOnly, SameSite=Lax, strict mode, HTTPS-only cookies

Secrets are shown redacted (first and last four characters) and written to `.env`
with mode `0600`.

### Step 9 — Installation summary
One review screen: requirements, storage, database, configuration, administrator
and security. **Download Installation Report** produces a plain-text report with
no secrets — useful for support tickets.

### Step 10 — Complete
Pressing **Finish installation** performs the final, irreversible work:

1. seeds system settings into `app_settings`;
2. writes the final `.env` and `config.php`;
3. publishes the frontend into the web root and writes `index.php`
   (front controller), `api/`, `js/`, `css/`, `assets/`;
4. copies the backend into `rmudts-app` and runs `npm install --omit=dev`
   (skipped with a clear warning if the host disables shell functions);
5. saves a schema snapshot into `rmudts-backups/manual/`;
6. writes the installation log and report into `rmudts-logs/installer/`;
7. **writes `installed.lock`** — from this moment the wizard is disabled.

---

## 4. Start the backend service

The website is live after step 10, but the API needs a running Node.js process:

1. **cPanel → Setup Node.js App → Create Application**
2. Application root: the folder reported in step 10 (for example
   `/home/<account>/rmudts-app`)
3. Application URL: your domain
4. Application startup file: `server.js`
5. Node.js version: **18 or newer**
6. Press **Create**, then **Run NPM Install** if the wizard could not, then **Restart**

Confirm the whole chain with:

```
https://your-domain/_rmudts/health
```

A healthy system answers with `"alive": true` and the port it detected. If it
reports `false`, the backend is not running — start it as above.

Uploads, API calls (`/login`, `/records`, `/api/notifications`, …) and document
previews are all proxied from the front controller to `127.0.0.1:<port>`, so the
Node process never has to be exposed to the internet.

---

## 5. After installation

- Sign in at your domain with the administrator username and password from step 7.
- Keep `install/installed.lock` in place. It is what prevents reinstallation.
- Back up `rmudts-uploads` and `rmudts-backups` (cPanel → *Backup Wizard*).
- Keep `rmudts-config` private: it holds `.env`, `config.php` and the install report.

### Upgrade or repair an installed copy

When a new release arrives, do **not** delete `installed.lock`: that re-opens the
wizard, which installs from scratch and replaces the administrator account.
Installed copies are updated through upgrade mode instead.

1. In cPanel → File Manager, extract the new `RMUDTS_v*.zip` **over** the existing
   `public_html` tree (the package only contains the wizard, the frontend build,
   the backend and `schema.sql`; your configuration and data live elsewhere).
2. Open:

   ```
   https://your-domain/install/upgrade
   ```

3. The first time the page is opened it creates an **upgrade key** at
   `rmudts-config/upgrade.key` (mode `0600`, outside the web root). Open that
   file in File Manager, copy its 48-character contents, and paste them into the
   page to unlock upgrade mode. Five wrong keys lock the form for 15 minutes.
4. Review the preflight table (installed version, package version, database,
   schema drift, accounts and records) and press **Run upgrade**.

What the run does, in order:

| Step | Effect |
|---|---|
| Data backup | Writes `rmudts-backups/manual/pre-upgrade-<timestamp>.sql` — structure **and every row**. If it cannot be written the run stops without changing anything. |
| Storage and protection | Recreates missing folders, `.htaccess` files, `index.html` guards and permissions. |
| Schema migration | Adds the tables, columns and indexes declared by the new `schema.sql`, records the release in `schema_migrations` and runs any pending data migrations. Nothing is dropped, truncated or renamed. |
| Application code | Copies the new backend into `rmudts-app` (keeping `node_modules`), replaces the frontend build in the web root — including deleting the previous release's hashed bundles — and rebuilds the front controller. |
| Configuration | Rewrites `.env` and `config.php` from the values already in place. Secrets are **not** rotated; keys the package does not know are kept verbatim. |
| Verification | Compares every table's row count and the account count with the values from before the run, and fails loudly if anything went down. |
| Installation record | Stamps the new version, `previous_version` and `upgraded_at` into `installed.lock`. |

5. Restart the service in **cPanel → Setup Node.js App → Restart**, then sign in
   with your existing account.

The frontend step replaces the build folder rather than piling a second copy on
top of it: files the new release no longer ships (`static/js/main.<oldhash>.js`
and friends) are deleted, while `install/`, `index.php` and anything that is not
part of the build are left alone. After publishing, every `static/`, `assets/`,
`js/`, `css/` and `media/` file named by the new `index.html` is checked to
exist; a build that is missing pieces is reported as a failure instead of being
served. The step message states how many files were published and how many stale
ones were removed, and the same figures appear in the upgrade report.

Every run writes a report to `rmudts-logs/installer/upgrade-report-*.txt` and a
secret-free summary to `rmudts-config/last-upgrade.json`.

**Repair** uses the same page: choose *Repair* instead of *Upgrade* when the
version is unchanged and something is missing or broken (a deleted front
controller, a folder that lost its protection file, a column that an interrupted
import never created). It runs the same backup, storage, schema and
configuration steps but does not treat the package as a new version.

> The upgrade never creates, replaces, re-roles or deletes an account, and never
> rotates the encryption or JWT keys, so existing sessions and stored files keep
> working.

### Reinstalling

A clean reinstall is the last resort — it replaces the administrator account and
configuration files. Only a system administrator should do this:

1. Back up the database and `rmudts-uploads` first.
2. cPanel → File Manager → `install/`
3. Delete `installed.lock` (and `.install-state.json` if present)
4. Open `/install` again

Provisioning never drops tables, but the administrator account and configuration
files are replaced — back up first.

---

## 6. Troubleshooting

`docs/TROUBLESHOOTING.md` covers every symptom in detail (blank React page,
asset paths, 403/404/500/503, manifest.json, Socket.IO, CORS, mixed content,
permissions, Passenger variables, restart versus redeploy).
`docs/DEPLOYMENT-CHECKLIST.md` is the production sign-off list. The table below
is the quick reference.

| Symptom | Cause and fix |
|---|---|
| “Application service unavailable” | The Node.js app is not running. Start/restart it in **Setup Node.js App**. Do **not** set `PORT` in `.env`: Passenger assigns it. |
| `/install` shows “RMUDTS is already installed.” | `installed.lock` exists. Use `/install/upgrade` to update or repair this copy; delete the lock only for a clean reinstall. |
| Upgrade page says “That key does not match” | Copy the contents of `rmudts-config/upgrade.key` again — it must match exactly. Delete the file to disable upgrade mode; it is re-created on the next visit. |
| Upgrade stopped at “Data backup” | The database is unreachable or `rmudts-backups` is not writable. Nothing was changed. Fix it and run again. |
| Upgrade reports “The frontend build is incomplete” | The extracted archive is missing build files. Re-extract the release ZIP over `public_html` and run the upgrade (or *Repair*) again — the message lists the missing paths. |
| After upgrading, the API still behaves like the old version | The Node.js process is still running the old code: **Setup Node.js App → Restart**. |
| “Cannot write to …” during step 3 | Set the folder to `755` (some hosts `775`) in File Manager, then re-run the step. |
| Database provisioning fails at `Creating Tables…` | The MySQL user lacks `CREATE`/`ALTER`. Add the user to the database with **ALL PRIVILEGES** in *MySQL Databases*. |
| Database provisioning fails at `Creating Relationships…` | Tables must be InnoDB; MyISAM tables ignore foreign keys. Import on a clean database. |
| 500 error on every page after installing | Check `rmudts-logs/` and the cPanel error log; usually a wrong `config.php` path — re-run the wizard. |
| Realtime notifications do not update live | PHP cannot tunnel the WebSocket upgrade; Socket.IO falls back to long-polling automatically. Expose the Node port with cPanel's own reverse proxy if you need true WebSockets. |
| Login says “Cannot reach the server” | The front controller could not reach the backend. Check `https://api.domain.com/api/health` (or `/_rmudts/health` when the PHP proxy is used), then the Node.js app log in *Setup Node.js App*. |

---

## 7. Reference: what the installer writes

```
public_html/
├── index.php            front controller (serves the SPA / proxies the API)
├── .htaccess            rewrite, redirect to /rmudts/, listing and MIME protection
├── rmudts/              React single-page application (index.html, static/,
│                        manifest.json, runtime-config.js, .htaccess)
└── install/             wizard, upgrade.php + installed.lock (lock disables the wizard)

/home/<account>/
├── rmudts-app/          Express backend + node_modules + .env (0600)
├── rmudts-config/       .env, config.php, storage.json, install-summary.json,
│                        last-upgrade.json, upgrade.key (all 0600)
├── rmudts-data/         tmp/, cache/, exports/, imports/
├── rmudts-logs/         error/, access/, installer/, database/
├── rmudts-uploads/      documents/, attachments/, routing-slips/, avatars/, tmp/
├── rmudts-backups/      daily/, weekly/, manual/
└── rmudts-restore/      incoming/
```

Every private folder carries its own `.htaccess` (`Require all denied`) so the
layout stays safe even if it is later moved inside the web root by mistake.

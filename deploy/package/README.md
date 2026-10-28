# RMUDTS v1.0 — release archive

**Records Management Unit — Document Tracking System**
React frontend · Node.js/Express backend · MySQL database · PHP front controller

This archive is a complete, one-click deployment package for cPanel hosting.

```
RMUDTS_v1.0.zip
├── index.php              bootstrap: sends you to the installer
├── .htaccess              pre-install web-root protection
├── VERSION                release marker
├── checksums.json         SHA-256 of every shipped file (integrity check)
├── install/               ten-step installation wizard (Moodle-style)
├── database/schema.sql    full schema + default records (never drops data)
├── schema.sql             the same file at the root, for manual phpMyAdmin imports
├── client/                built React single-page application (published to /rmudts/)
├── server/                Express backend (copied out of the web root on install)
├── templates/             env examples, frontend .htaccess, cPanel setup sheet
├── config/ storage/ backup/ logs/ uploads/ restore/
└── docs/                  INSTALL.md · TROUBLESHOOTING.md · DEPLOYMENT-CHECKLIST.md
```

## Install in three moves

1. Upload `RMUDTS_v1.0.zip` to `public_html` and **Extract** it there.
2. Open `https://your-domain/install`.
3. Follow the ten steps: requirements → storage → database → provisioning →
   configuration → administrator → security → summary → complete.

The wizard creates the application folders outside `public_html`, imports the
schema, writes `.env` and `config.php` with mode `0600`, generates all keys,
hardens the web root with `.htaccess` rules, creates the super administrator and
finishes by writing `install/installed.lock`.

Once `installed.lock` exists the installer is disabled and says
**“RMUDTS is already installed.”** Only a system administrator who deletes the
lock file can re-open it.

## Upgrading or repairing an installed copy

Do **not** delete the lock file to apply a new release — that starts the wizard
over and replaces the administrator account. Instead upload the new package over
the existing one, open

```
https://your-domain/install/upgrade
```

and paste the upgrade key from `rmudts-config/upgrade.key` (created the first
time the page is opened). Upgrade mode:

- writes a **full data backup** of every table (rows included) before changing
  anything, and refuses to start if it cannot;
- adds the tables, columns and indexes the new `schema.sql` declares and runs
  the pending data migrations — it never drops, truncates or renames anything;
- copies the new backend and replaces the frontend build (old hashed bundles are
  deleted, and the published `index.html` is checked against the files on disk);
- rebuilds the front controller;
- rewrites `.env` and `config.php`, preserving every key and secret;
- verifies row counts and account counts afterwards and records the new version
  in `installed.lock`.

Use **Repair** for the same version when something is missing or broken: missing
folders, protection files, schema objects or configuration are restored without
changing the version.

Finally restart the application in *cPanel → Setup Node.js App → Restart* so the
new backend code is loaded.

## What the installer leaves you with

| Part | Location |
|---|---|
| Frontend (React build) | `public_html/rmudts/` — served at `https://domain.com/rmudts/` |
| Web root entry | `public_html/index.php` (front controller) + `public_html/.htaccess` |
| Backend | `/home/<account>/rmudts-app` (started from *Setup Node.js App*) |
| Configuration (`0600`) | `/home/<account>/rmudts-config` (`config.php`) and `rmudts-app/.env` |
| Data, cache, temp | `/home/<account>/rmudts-data` |
| Logs | `/home/<account>/rmudts-logs` |
| Uploads | `/home/<account>/rmudts-uploads` |
| Backups | `/home/<account>/rmudts-backups` |

## Health check

```
https://your-domain/_rmudts/health
```

Reports the installed version, the PHP version, the backend endpoint and whether
the Node.js service is answering.

## Support

The installation report — `rmudts-logs/installer/installation-report-*.txt`, also
downloadable at the end of step 9 — contains everything needed to diagnose a
failed installation. It deliberately contains **no passwords and no keys**.

Upgrades write `rmudts-logs/installer/upgrade-report-*.txt` (and
`repair-report-*.txt`) next to it, plus a secret-free summary in
`rmudts-config/last-upgrade.json`.

See `docs/INSTALL.md` for the full guide and hosting requirements,
`docs/TROUBLESHOOTING.md` for the symptom-by-symptom guide (blank page, asset
paths, 403/404/500/503, Socket.IO, CORS, permissions, Passenger) and
`docs/DEPLOYMENT-CHECKLIST.md` for the production sign-off list.

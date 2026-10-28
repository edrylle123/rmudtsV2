<?php
/**
 * RMUDTS — upgrade / repair screen.
 * ---------------------------------------------------------------------------
 * Two states:
 *
 *   locked    the key from the private configuration folder is required;
 *   unlocked  the preflight report, the options, and the results of a run.
 *
 * @var array $ctx
 * @var array{path:string,created:bool,key:string} $keyFile
 * @var bool  $authorised
 * @var array|null $flash
 * @var array|null $result
 * @var array $plan
 * @var array{installed:string,package:string,state:string} $version
 * @var array $last
 * @var string $csrf
 */

declare(strict_types=1);

use Rmudts\Installer\Installer;
use Rmudts\Installer\Support;

require_once __DIR__ . DIRECTORY_SEPARATOR . 'partials.php';

$paths = (array) $ctx['paths'];
$defaultMode = $version['state'] === 'newer' ? 'upgrade' : 'repair';
$needsPassword = ((string) ($ctx['db']['pass'] ?? '')) === '' || $ctx['env_file'] === null;
$appUrl = (string) ($ctx['app']['url'] ?? '');

$statusText = match ($version['state']) {
    'newer' => 'A newer release is in this package — this is an upgrade.',
    'same'  => 'The package matches the installed version — this is a repair.',
    default => 'The package is older than the installed copy. Upgrading to an older release is not supported.',
};
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>RMUDTS — Upgrade and repair</title>
  <link rel="stylesheet" href="assets/css/installer.css">
</head>
<body class="wizard upgrade">
<a class="skip" href="#upgrade-main">Skip to content</a>

<header class="topbar">
  <div class="topbar-brand">
    <span class="logo" aria-hidden="true">RM</span>
    <div>
      <h1>RMUDTS Upgrade &amp; Repair</h1>
      <p>Records Management Unit — Document Tracking System <span class="version">installer v<?= h(Installer::VERSION) ?></span></p>
    </div>
  </div>
  <div class="topbar-meta">
    <span>Installed: v<?= h($version['installed'] !== '' ? $version['installed'] : 'unknown') ?></span>
    <span>Package: v<?= h($version['package']) ?></span>
    <span><?= $authorised ? 'Unlocked' : 'Locked' ?></span>
  </div>
</header>

<main class="content" id="upgrade-main">
  <?= message_box($flash) ?>

  <?php if (!$authorised): ?>

    <div class="hero">
      <h2>Upgrade or repair this installation</h2>
      <p class="lead">
        This copy is already installed, so the setup wizard stays disabled. Upgrade mode updates the
        application files, migrates the database schema and regenerates the configuration of
        <strong>this</strong> installation — without touching a single record or account.
      </p>
      <p class="muted"><?= h($statusText) ?></p>
    </div>

    <div class="grid-2">
      <section class="card">
        <h2>What an upgrade does</h2>
        <ul class="checklist">
          <li><span class="tick">&#10003;</span> Writes a <strong>full data backup</strong> of every table (rows included) before changing anything</li>
          <li><span class="tick">&#10003;</span> Adds missing tables, columns and indexes from the new <code>schema.sql</code> — never drops one</li>
          <li><span class="tick">&#10003;</span> Runs the ordered data migrations recorded in <code>schema_migrations</code></li>
          <li><span class="tick">&#10003;</span> Copies the new backend and publishes the new frontend build</li>
          <li><span class="tick">&#10003;</span> Rewrites <code>.env</code> and <code>config.php</code>, keeping every key and secret</li>
          <li><span class="tick">&#10003;</span> Re-checks row counts afterwards and fails loudly if anything went missing</li>
        </ul>
      </section>

      <section class="card">
        <h2>What it never does</h2>
        <ul class="checklist checklist-plain">
          <li>Never creates, replaces, re-roles or deletes an account — your existing sign-ins keep working</li>
          <li>Never drops, truncates or renames a table, column or row</li>
          <li>Never rotates the application, encryption, JWT or refresh secrets automatically</li>
          <li>Never touches uploads, backups or anything outside the configured folders</li>
          <li>Never removes <code>installed.lock</code> — the copy stays locked to visitors</li>
        </ul>
      </section>
    </div>

    <section class="card">
      <h2>Unlock with the upgrade key</h2>
      <p>
        To prove this is the administrator and not a visitor, open the file below in
        <strong>cPanel → File Manager</strong> and paste its contents. It is 48 characters and lives
        outside the web root, so it can never be fetched over HTTP.
      </p>
      <div class="kv">
        <div><span>Key file</span><strong><code><?= h(Support::path($keyFile['path'])) ?></code></strong></div>
        <div><span>Status</span><strong>
          <?php if (!$keyFile['created'] && $keyFile['key'] === ''): ?>
            <?= chip('fail', 'NOT WRITABLE') ?> the configuration folder is not writable, so no key could be created
          <?php elseif ($keyFile['created']): ?>
            <?= chip('pass', 'CREATED') ?> a new key was created just now
          <?php else: ?>
            <?= chip('pass', 'READY') ?> created earlier
          <?php endif; ?>
        </strong></div>
      </div>

      <?php if ($keyFile['key'] === ''): ?>
        <p class="banner banner-fail">
          <strong>Cannot start:</strong> the key could not be written. Make
          <code><?= h(Support::path(dirname($keyFile['path']))) ?></code> writable (755, or 775 on some hosts) and reload this page.
        </p>
      <?php else: ?>
        <form method="post" class="wizard-form" autocomplete="off">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
          <input type="hidden" name="action" value="authorize">
          <?= field([
              'name'        => 'key',
              'type'        => 'password',
              'label'       => 'Upgrade key',
              'required'    => true,
              'placeholder' => 'paste the 48-character key',
              'hint'        => 'Exactly as it appears in ' . Support::path($keyFile['path']) . ' — it is not case sensitive in any way you can see, so paste rather than retype.',
              'autocomplete' => 'off',
          ]) ?>
          <div class="inline-actions">
            <button class="btn btn-primary" type="submit" name="action" value="authorize">Unlock upgrade mode</button>
            <a class="btn btn-secondary" href="<?= h($appUrl !== '' ? $appUrl : '../') ?>">Open the application</a>
            <a class="btn btn-ghost" href="index.php">Installation record</a>
          </div>
          <p class="muted small">
            Five failed attempts lock the form for 15 minutes. Delete
            <code><?= h(Support::path($keyFile['path'])) ?></code> to disable upgrade mode entirely; it is
            re-created the next time this page is opened.
          </p>
        </form>
      <?php endif; ?>
    </section>

  <?php else: ?>

    <div class="hero">
      <h2><?= h($defaultMode === 'upgrade' ? 'Upgrade to v' . Installer::VERSION : 'Repair this installation') ?></h2>
      <p class="lead"><?= h($statusText) ?></p>
      <p class="muted">
        A full backup is written to <code><?= h(Support::path((string) $paths['backups'])) ?>/manual</code> before
        anything changes. If the backup cannot be written, the upgrade stops without making a change.
      </p>
    </div>

    <section class="card">
      <h2>Preflight</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th class="col-status">Status</th><th>Check</th><th>Detail</th></tr></thead>
          <tbody>
            <?php foreach ($plan as $row): ?>
              <?= status_row((string) $row['label'], (string) $row['level'], (string) $row['note']) ?>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>

    <?php if ($result !== null): ?>
      <?php
      $before = (array) ($result['before']['counts'] ?? []);
      $after = (array) ($result['after']['counts'] ?? []);
      $tables = array_unique(array_merge(array_keys($before), array_keys($after)));
      sort($tables);
      ?>
      <section class="card" id="upgrade-results">
        <h2><?= $result['ok'] ? 'Upgrade finished' : 'Upgrade finished with items to review' ?></h2>
        <div class="stat-strip">
          <div class="stat <?= $result['ok'] ? 'stat-pass' : 'stat-warn' ?>">
            <span class="stat-number"><?= h($result['ok'] ? 'OK' : 'CHECK') ?></span>
            <span class="stat-label">Result</span>
          </div>
          <div class="stat">
            <span class="stat-number">v<?= h((string) ($result['before']['version'] ?? '?') ?: '?') ?> &rarr; v<?= h(Installer::VERSION) ?></span>
            <span class="stat-label">Version</span>
          </div>
          <div class="stat">
            <span class="stat-number"><?= (int) array_sum($after) ?></span>
            <span class="stat-label">Rows in database</span>
          </div>
          <div class="stat">
            <span class="stat-number"><?= (int) ($after['users'] ?? 0) ?></span>
            <span class="stat-label">Accounts intact</span>
          </div>
        </div>

        <div class="console" id="upgrade-console">
          <?php foreach ((array) $result['steps'] as $step): ?>
            <div class="console-line console-<?= h((string) $step['level']) ?>">
              <strong><?= h((string) $step['label']) ?></strong> — <?= h((string) $step['message']) ?>
            </div>
          <?php endforeach; ?>
        </div>

        <h3>Data preservation</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Table</th><th class="col-num">Before</th><th class="col-num">After</th><th class="col-status">Result</th></tr></thead>
            <tbody>
              <?php foreach ($tables as $table): ?>
                <?php
                $b = $before[$table] ?? null;
                $a = $after[$table] ?? null;
                $lost = ($b !== null && $a !== null && (int) $a < (int) $b);
                ?>
                <tr class="<?= $lost ? 'row-fail' : 'row-pass' ?>">
                  <td><code><?= h((string) $table) ?></code></td>
                  <td class="col-num"><?= $b === null ? '—' : (int) $b ?></td>
                  <td class="col-num"><?= $a === null ? '—' : (int) $a ?></td>
                  <td class="col-status"><?= $lost ? chip('fail', 'ROWS LOST') : chip('pass', 'KEPT') ?></td>
                </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>

        <div class="kv">
          <div><span>Backup</span><strong><code><?= h(Support::path((string) ($result['backup'] ?? '—'))) ?></code></strong></div>
          <div><span>Report</span><strong><code><?= h(Support::path((string) ($result['report_path'] ?? '—'))) ?></code></strong></div>
          <div><span>Lock files</span><strong><code><?= h(implode(', ', array_map(static fn(string $f): string => Support::path($f), (array) $result['lock_files']))) ?></code></strong></div>
        </div>

        <p class="banner banner-info">
          <strong>Next:</strong> restart the Node.js application in <strong>cPanel → Setup Node.js App →
          Restart</strong> so the new backend code is loaded, then open the application and sign in with an
          existing account.
        </p>
      </section>
    <?php endif; ?>

    <?php if ($last !== []): ?>
      <section class="card card-quiet">
        <h2>Last recorded run</h2>
        <div class="kv">
          <div><span>Mode</span><strong><?= h((string) ($last['mode'] ?? '—')) ?></strong></div>
          <div><span>Versions</span><strong>v<?= h((string) ($last['from_version'] ?? '?')) ?> &rarr; v<?= h((string) ($last['to_version'] ?? '?')) ?></strong></div>
          <div><span>Finished</span><strong><?= h((string) ($last['finished_at'] ?? '—')) ?></strong></div>
          <div><span>Backup</span><strong><code><?= h(Support::path((string) ($last['backup'] ?? '—'))) ?></code></strong></div>
          <div><span>Report</span><strong><code><?= h(Support::path((string) ($last['report'] ?? '—'))) ?></code></strong></div>
        </div>
      </section>
    <?php endif; ?>

    <form method="post" class="wizard-form" id="form-upgrade" autocomplete="off">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <input type="hidden" name="action" value="run">

      <section class="card">
        <h2>What to run</h2>
        <div class="field">
          <label><input type="radio" name="mode" value="upgrade" <?= $defaultMode === 'upgrade' ? 'checked' : '' ?>>
            <strong>Upgrade</strong> — this package holds newer code</label>
          <p class="hint">Copies the new code, migrates the schema, regenerates the configuration and records the new version.</p>
        </div>
        <div class="field">
          <label><input type="radio" name="mode" value="repair" <?= $defaultMode === 'repair' ? 'checked' : '' ?>>
            <strong>Repair</strong> — same version, something is missing or broken</label>
          <p class="hint">Restores missing files, folders and protection, re-applies the schema and rewrites the configuration. Nothing is removed.</p>
        </div>

        <h3>Steps to run</h3>
        <ul class="checklist checklist-plain">
          <li><label><input type="checkbox" name="schema" value="1" checked> <strong>Migrate the database schema</strong> — add missing tables, columns and indexes; run pending data migrations</label></li>
          <li><label><input type="checkbox" name="config" value="1" checked> <strong>Regenerate the configuration</strong> — .env and config.php, keeping every secret</label></li>
          <li><label><input type="checkbox" name="code" value="1" checked> <strong>Update the application files</strong> — backend, frontend build and front controller</label></li>
          <li><label><input type="checkbox" name="deps" value="1" <?= $defaultMode === 'upgrade' ? 'checked' : '' ?>> <strong>Install backend dependencies</strong> — runs <code>npm install --omit=dev</code> (slower; untick when node_modules is current)</label></li>
        </ul>

        <?php if ($needsPassword): ?>
          <h3>Database password</h3>
          <p class="muted small">
            No database password was found in <code>.env</code>, so it cannot be reused. Enter it once here:
            it is written to the new <code>.env</code> and never stored in the wizard state or the report.
          </p>
          <?= field([
              'name'         => 'password',
              'type'         => 'password',
              'label'        => 'MySQL password',
              'placeholder'  => 'database password',
              'autocomplete' => 'off',
              'hint'         => 'Only needed because DB_PASS is empty in the configuration file.',
          ]) ?>
        <?php endif; ?>

        <div class="inline-actions">
          <button class="btn btn-primary" type="submit" id="btn-run-upgrade">
            <?= $defaultMode === 'upgrade' ? 'Run upgrade' : 'Run repair' ?>
          </button>
          <a class="btn btn-secondary" href="<?= h($appUrl !== '' ? $appUrl : '../') ?>">Open the application</a>
        </div>
        <p class="muted small">
          The page waits while the upgrade runs. Do not close the tab: a backup of every table is
          written first, and the run is allowed to finish even if the browser disconnects.
        </p>
      </section>
    </form>

    <form method="post" class="inline-actions" id="form-lock">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
      <button class="btn btn-link" type="submit" name="action" value="revoke">Lock upgrade mode</button>
      <span class="muted small">Ends this browser session's access. The key file is unchanged.</span>
    </form>

    <script>
      (function () {
        var form = document.getElementById('form-upgrade');
        var button = document.getElementById('btn-run-upgrade');
        if (!form || !button) return;
        form.addEventListener('submit', function (event) {
          var mode = (form.querySelector('input[name="mode"]:checked') || {}).value || 'upgrade';
          var message = mode === 'repair'
            ? 'Repair this installation?\n\nA full data backup is written first. Missing files, folders and schema objects are restored; nothing is dropped and no account is touched.'
            : 'Upgrade this installation?\n\nA full data backup is written first, then the code, schema and configuration are updated. Existing records and accounts are preserved.';
          if (!window.confirm(message)) {
            event.preventDefault();
            return;
          }
          button.disabled = true;
          button.innerHTML = 'Running… this can take a minute';
        });
      })();
    </script>

  <?php endif; ?>
</main>

<footer class="footer">
  <span>RMUDTS v<?= h(Installer::VERSION) ?> — upgrade and repair</span>
  <span>Never delete <code>installed.lock</code> to upgrade: use this page.</span>
</footer>
</body>
</html>

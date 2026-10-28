<?php
/**
 * RMUDTS is already installed.
 * ---------------------------------------------------------------------------
 * Rendered instead of the wizard whenever installed.lock exists. The installer
 * is disabled — this is the reinstallation guard, and the only way past it is
 * for a system administrator to delete the lock file by hand.
 */

declare(strict_types=1);

use Rmudts\Installer\Installer;
use Rmudts\Installer\Lock;
use Rmudts\Installer\Support;
use Rmudts\Installer\Upgrader;

require_once __DIR__ . DIRECTORY_SEPARATOR . 'partials.php';

$lock = Lock::read();
$lockPath = (string) ($lock['_path'] ?? (Lock::path() ?? ''));
$installedAt = (string) ($lock['installed_at'] ?? '');
$version = (string) ($lock['version'] ?? Installer::VERSION);
$appUrl = (string) ($lock['app_url'] ?? '');

// Upgrade mode is the supported alternative to deleting the lock: it updates
// this copy in place and never re-runs the wizard.
$packageVersion = Installer::VERSION;
$compare = version_compare($packageVersion, $version);
$upgradeState = $compare > 0 ? 'newer' : ($compare < 0 ? 'older' : 'same');
$upgradeNote = match ($upgradeState) {
    'newer' => 'This package holds v' . $packageVersion . ' — newer than the installed v' . $version . '.',
    'same'  => 'This package is the same version (v' . $packageVersion . '), so upgrade mode works as a repair.',
    default => 'This package (v' . $packageVersion . ') is older than the installed v' . $version . '.',
};
$upgradeKeyPath = Upgrader::keyFile(Upgrader::detectPaths());
// The installation is complete, so the visitor belongs in the application:
// this screen states why the wizard is gone, then hands over on its own.
$redirectTarget = $appUrl !== '' ? $appUrl : '../';
$redirectAfter = 10;
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>RMUDTS is already installed</title>
  <meta http-equiv="refresh" content="<?= (int) $redirectAfter ?>;url=<?= h($redirectTarget) ?>">
  <link rel="stylesheet" href="assets/css/installer.css">
</head>
<body class="wizard locked">
<header class="topbar">
  <div class="topbar-brand">
    <span class="logo" aria-hidden="true">RM</span>
    <div>
      <h1>RMUDTS Installation Wizard</h1>
      <p>Records Management Unit — Document Tracking System <span class="version">v<?= h(Installer::VERSION) ?></span></p>
    </div>
  </div>
  <div class="topbar-meta"><span>Installer disabled</span></div>
</header>

<main class="content content-locked">
  <div class="banner banner-warn">
    <strong>RMUDTS is already installed.</strong>
    The installation wizard is disabled to protect the running system.
    Redirecting to the application in <span id="redirect-countdown"><?= (int) $redirectAfter ?></span> seconds…
  </div>

  <section class="card">
    <h2>Installation record</h2>
    <div class="kv">
      <div><span>Product</span><strong><?= h((string) ($lock['product'] ?? 'RMUDTS')) ?> v<?= h($version) ?></strong></div>
      <div><span>Installed at</span><strong><?= h($installedAt !== '' ? (date('j F Y \a\t H:i', strtotime($installedAt) ?: time()) . ' (' . $installedAt . ')') : 'unknown') ?></strong></div>
      <div><span>Application URL</span><strong><?= h($appUrl !== '' ? $appUrl : 'not recorded') ?></strong></div>
      <div><span>Administrator</span><strong><?= h((string) ($lock['admin'] ?? 'not recorded')) ?></strong></div>
      <div><span>Environment</span><strong><?= h((string) ($lock['environment'] ?? 'production')) ?></strong></div>
      <div><span>Database</span><strong><?= h((string) ($lock['database'] ?? 'not recorded')) ?></strong></div>
      <div><span>Lock file</span><strong><code><?= h(Support::path($lockPath)) ?></code></strong></div>
      <?php if (!empty($lock['report'])): ?>
        <div><span>Installation report</span><strong><code><?= h(Support::path((string) $lock['report'])) ?></code></strong></div>
      <?php endif; ?>
    </div>
    <p class="muted small"><?= h(Lock::message()) ?></p>
  </section>

  <section class="card">
    <h2>What would you like to do?</h2>
    <div class="inline-actions">
      <a class="btn btn-primary" href="<?= h($redirectTarget) ?>">Go to RMUDTS now</a>
      <a class="btn btn-secondary" href="upgrade.php">Upgrade or repair this copy</a>
      <a class="btn btn-ghost" href="../_rmudts/health">Check system health</a>
    </div>
    <p class="muted small">
      The redirect is automatic; this page stays reachable at
      <code>/install</code> whenever you need the installation record below.
    </p>
  </section>

  <section class="card">
    <h2>Upgrade or repair this copy</h2>
    <p>
      <?= h($upgradeNote) ?>
      Upgrade mode updates the application files, migrates the database schema and regenerates the
      configuration of this installation. It writes a full data backup first and never touches your
      records or accounts — unlike deleting <code>installed.lock</code>, which starts the wizard over.
    </p>
    <div class="kv">
      <div><span>Installed version</span><strong>v<?= h($version) ?><?= !empty($lock['upgraded_at']) ? ' (upgraded ' . h((string) $lock['upgraded_at']) . ')' : '' ?></strong></div>
      <div><span>Package version</span><strong>v<?= h($packageVersion) ?> — <?= h($upgradeState === 'newer' ? 'newer, upgrade available' : ($upgradeState === 'same' ? 'same version, repair only' : 'older, keep the installed copy')) ?></strong></div>
      <div><span>Upgrade key</span><strong><code><?= h(Support::path($upgradeKeyPath)) ?></code></strong></div>
    </div>
    <div class="inline-actions">
      <a class="btn btn-primary" href="upgrade.php">Open upgrade &amp; repair</a>
    </div>
    <p class="muted small">
      The key file is created the first time the upgrade page is opened. Paste its contents there to
      unlock upgrade mode; five wrong keys lock the form for 15 minutes.
    </p>
  </section>

  <section class="card card-quiet">
    <h2>Reinstalling (system administrators only)</h2>
    <ol class="tight">
      <li>In <strong>cPanel → File Manager</strong>, open the <code>install</code> folder.</li>
      <li>Delete <code>installed.lock</code> (and, if present, <code>.install-state.json</code>).</li>
      <li>Reload this page — the wizard starts again.</li>
    </ol>
    <p class="banner banner-fail">
      <strong>Before you do that:</strong> reinstalling re-runs the setup wizard. Back up your
      database and the uploads folder first. Provisioning never drops tables, but the
      administrator account and configuration files will be replaced.
    </p>
    <p class="muted small">
      If the lock file cannot be deleted, ask your hosting provider or check file ownership in
      cPanel → File Manager (it must be writable by your account).
    </p>
  </section>
</main>

<footer class="footer">
  <span>RMUDTS v<?= h(Installer::VERSION) ?> installer</span>
  <span>Locked by <code>installed.lock</code> — remove it manually only to reinstall.</span>
</footer>

<script>
  // Visible countdown for the meta-refresh above; the redirect itself does not
  // depend on JavaScript.
  (function () {
    var node = document.getElementById('redirect-countdown');
    if (!node) return;
    var left = <?= (int) $redirectAfter ?>;
    var timer = setInterval(function () {
      left -= 1;
      node.textContent = String(Math.max(0, left));
      if (left <= 0) clearInterval(timer);
    }, 1000);
  })();
</script>
</body>
</html>

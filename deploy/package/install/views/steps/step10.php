<?php
/**
 * Step 10 — Complete.
 *
 * The wizard state is deleted when the installation finishes, so this view
 * renders from the secret-free summary the installer stores in the private
 * configuration folder (install-summary.json). If that file is missing, the
 * lock file itself still proves the installation finished.
 *
 * @var int $step
 * @var array $paths
 * @var array $result
 */

declare(strict_types=1);

use Rmudts\Installer\Installer;
use Rmudts\Installer\Lock;
use Rmudts\Installer\Support;

$summaryFile = rtrim((string) ($paths['config'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'install-summary.json';
$summary = Support::readJson($summaryFile);
if ($summary === [] && !empty($result['data'])) {
    $summary = (array) $result['data'];
}
$lock = Lock::read();
$app = (array) ($summary['app'] ?? []);
$admin = (array) ($summary['admin'] ?? []);
$reportFile = (string) ($summary['report'] ?? '');
$lockFiles = (array) ($summary['lock_files'] ?? []);
$appUrl = (string) ($app['url'] ?? '');
$port = (int) ($summary['port'] ?? Installer::backendPort());
?>
<div class="done-hero">
  <div class="done-mark" aria-hidden="true">&#127881;</div>
  <h2>RMUDTS Installation Completed Successfully</h2>
  <p class="lead">
    <?= h((string) ($app['name'] ?? 'RMUDTS')) ?> is installed at
    <a href="<?= h($appUrl !== '' ? $appUrl : '/') ?>"><?= h($appUrl !== '' ? $appUrl : 'this domain') ?></a>.
  </p>
</div>

<section class="card">
  <h2>Installation summary</h2>
  <ul class="checklist">
    <li><span class="tick">&#10003;</span> Application installed — frontend published, backend copied out of the web root</li>
    <li><span class="tick">&#10003;</span> Database connected — <code><?= h((string) ($summary['database']['name'] ?? '—')) ?></code> on <?= h((string) ($summary['database']['host'] ?? '—')) ?> as <?= h((string) ($summary['database']['user'] ?? '—')) ?></li>
    <li><span class="tick">&#10003;</span> Database provisioned — tables, indexes, relationships and default records</li>
    <li><span class="tick">&#10003;</span> Storage configured — data, logs, uploads and backups outside <code>public_html</code></li>
    <li><span class="tick">&#10003;</span> Security applied — keys generated, directory and upload protection written</li>
    <li><span class="tick">&#10003;</span> Administrator created — <?= h((string) ($admin['idnumber'] ?? '—')) ?> (super_admin)</li>
  </ul>

  <div class="table-wrap">
    <table class="table">
      <tbody>
        <tr><td>Installation lock</td><td><code><?= h(Support::path((string) ($lockFiles[0] ?? (Lock::path() ?? '')))) ?></code> <?= chip('pass', 'WRITTEN') ?></td></tr>
        <tr><td>Installed at</td><td><?= h((string) ($lock['installed_at'] ?? $summary['installed_at'] ?? '')) ?></td></tr>
        <tr><td>Version</td><td>RMUDTS v<?= h((string) ($lock['version'] ?? Installer::VERSION)) ?></td></tr>
        <tr><td>Installation report</td><td><code><?= h(Support::path($reportFile)) ?></code> — open or download it from cPanel → File Manager</td></tr>
        <tr><td>Backend service</td><td>127.0.0.1:<?= (int) $port ?> (<code>server.js</code>)</td></tr>
        <tr><td>Web root</td><td><code><?= h(Support::path((string) ($paths['public_root'] ?? ''))) ?></code></td></tr>
        <tr><td>Configuration</td><td><code><?= h(Support::path((string) ($paths['config'] ?? ''))) ?></code></td></tr>
        <tr><td>Logs</td><td><code><?= h(Support::path((string) ($paths['logs'] ?? ''))) ?></code></td></tr>
      </tbody>
    </table>
  </div>
</section>

<?php if (!empty($summary['messages'])): ?>
  <details class="card card-quiet">
    <summary>Installer activity (<?= count((array) $summary['messages']) ?> entries)</summary>
    <ul class="tight">
      <?php foreach ((array) $summary['messages'] as $message): ?>
        <li><?= h((string) $message) ?></li>
      <?php endforeach; ?>
    </ul>
  </details>
<?php endif; ?>

<?php $cpanel = (array) ($summary['cpanel'] ?? []); ?>
<?php if (!empty($cpanel['values'])): ?>
  <section class="card">
    <h2>cPanel Node.js application — values to enter</h2>
    <p class="card-desc">
      The wizard cannot create this application for you: cPanel exposes no API for it on shared
      hosting. Everything else is ready — enter these exact values in
      <strong>cPanel → Setup Node.js App</strong>.
    </p>
    <div class="table-wrap">
      <table class="table">
        <tbody>
          <?php foreach ((array) $cpanel['values'] as $label => $value): ?>
            <tr><td><?= h((string) $label) ?></td><td><code><?= h((string) $value) ?></code></td></tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <?php if (!empty($cpanel['commands'])): ?>
      <h3>Commands (cPanel → Terminal)</h3>
      <pre class="console"><?= h(implode("\n", (array) $cpanel['commands'])) ?></pre>
    <?php endif; ?>
    <details>
      <summary>All cPanel steps (<?= count((array) ($cpanel['steps'] ?? [])) ?>)</summary>
      <ol class="tight">
        <?php foreach ((array) ($cpanel['steps'] ?? []) as $item): ?>
          <li><strong><?= h((string) ($item['title'] ?? '')) ?></strong><br><?= (string) ($item['body'] ?? '') ?></li>
        <?php endforeach; ?>
      </ol>
    </details>
    <?php if (!empty($cpanel['file'])): ?>
      <p class="muted small">
        A printable copy is kept at <code><?= h(Support::path((string) $cpanel['file'])) ?></code> — it contains no passwords or keys.
      </p>
    <?php endif; ?>
  </section>
<?php endif; ?>

<section class="card">
  <h2>Start the application service</h2>
  <p>
    The website is already serving, but the Node.js API needs to be running. In
    <strong>cPanel → Setup Node.js App</strong>:
  </p>
  <ol class="tight">
    <li>Application root: <code><?= h(Support::path((string) ($paths['app_root'] ?? ''))) ?></code></li>
    <li>Application startup file: <code>server.js</code></li>
    <li>Node.js version: <strong>18 or newer</strong></li>
    <li>Press <em>Create</em>, then <em>Run NPM Install</em> if the wizard could not run it, then <em>Restart</em>.</li>
  </ol>
  <?php $healthUrl = rtrim((string) ($app['api_url'] ?? ''), '/') . '/api/health'; ?>
  <p class="muted small">
    Check <?php if ($healthUrl !== '/api/health'): ?><a href="<?= h($healthUrl) ?>"><code><?= h($healthUrl) ?></code></a><?php else: ?><code>/api/health</code> on the API subdomain<?php endif; ?>
    to confirm the backend answers and can reach MySQL. It reports the database state, never a password.
  </p>
</section>

<section class="card">
  <h2>Next steps</h2>
  <ul class="tight">
    <li>Sign in at <a href="<?= h($appUrl !== '' ? $appUrl : '/') ?>"><?= h($appUrl !== '' ? $appUrl : 'the site') ?></a> with username <strong><?= h((string) ($admin['idnumber'] ?? '—')) ?></strong>.</li>
    <li>Change nothing inside <code>install/</code>: <code>installed.lock</code> keeps the wizard disabled.</li>
    <li>To reinstall, delete <code>installed.lock</code> in cPanel → File Manager and open <code>/install</code> again.</li>
    <li>Schedule backups of your uploads and backups folders (cPanel → Backup Wizard).</li>
    <li>Keep <code><?= h(Support::path((string) ($paths['config'] ?? ''))) ?></code> out of any archive you share publicly — it holds the application keys.</li>
  </ul>
  <div class="inline-actions">
    <a class="btn btn-primary" href="<?= h($appUrl !== '' ? $appUrl : '../') ?>">Open RMUDTS</a>
    <a class="btn btn-secondary" href="<?= h(rtrim((string) ($app['api_url'] ?? ''), '/') . '/api/health') ?>">Check system health</a>
  </div>
  <p class="muted small">
    The installation report is kept with your logs:
    <code><?= h(Support::path($reportFile)) ?></code>.
  </p>
</section>

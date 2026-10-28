<?php
/**
 * Step 9 — Installation summary.
 *
 * @var int $step
 * @var string $csrf
 * @var array $paths
 * @var array $app
 * @var array $db
 * @var array $admin
 * @var array $secrets
 * @var array $security
 * @var array $frontend
 * @var array $backend
 * @var array $provision
 * @var int $port
 */

declare(strict_types=1);

use Rmudts\Installer\Database;
use Rmudts\Installer\Lock;
use Rmudts\Installer\Requirements;
use Rmudts\Installer\Security;
use Rmudts\Installer\State;
use Rmudts\Installer\Storage;
use Rmudts\Installer\Support;

$requirements = Requirements::summarise(Requirements::all($paths));
$checklist = (array) ($security['checklist'] ?? Security::checklist($paths, $secrets));
$storageRows = Storage::overview($paths);
?>
<p class="lead">
  This is the last review before <code>installed.lock</code> is written. The final button also
  publishes the frontend, copies the backend out of the web root, installs its dependencies and
  saves a schema snapshot into the backup folder.
</p>

<section class="card">
  <h2>System requirements</h2>
  <p>
    <?= chip($requirements['ok'] ? 'pass' : 'fail', $requirements['ok'] ? 'PASS' : 'FAIL') ?>
    <?= (int) $requirements['counts']['pass'] ?> passed,
    <?= (int) $requirements['counts']['warn'] ?> warning(s),
    <?= (int) $requirements['counts']['fail'] ?> failed.
  </p>
</section>

<section class="card">
  <h2>Storage locations</h2>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th class="col-status">Status</th><th>Location</th><th>Path</th><th class="col-num">Entries</th><th class="col-num">Size</th></tr></thead>
      <tbody>
        <?php foreach ($storageRows as $row): ?>
          <tr>
            <td class="col-status"><?= $row['exists'] ? ($row['writable'] ? chip('pass', 'READY') : chip('fail', 'READ-ONLY')) : chip('warn', 'MISSING') ?></td>
            <td><?= h((string) $row['label']) ?></td>
            <td><code><?= h(Support::path((string) $row['path'])) ?></code></td>
            <td class="col-num"><?= (int) $row['entries'] ?></td>
            <td class="col-num"><?= h(Support::bytes((int) $row['bytes'])) ?></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<section class="card">
  <h2>Database</h2>
  <div class="kv">
    <div><span>Connection</span><strong><?= h((string) ($db['user'] ?? '—')) ?>@<?= h((string) ($db['host'] ?? '—')) ?>:<?= h((string) ($db['port'] ?? '—')) ?></strong></div>
    <div><span>Database</span><strong><?= h((string) ($db['name'] ?? '—')) ?></strong></div>
    <div><span>Provisioned</span><strong><?= State::has('db_provisioned') ? 'yes (' . h((string) State::get('provisioned_at')) . ')' : 'no' ?></strong></div>
  </div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th class="col-status">Status</th><th>Stage</th><th>Result</th></tr></thead>
      <tbody>
        <?php foreach (Database::STAGES as $stage => $label): ?>
          <?php $entry = $provision[$stage] ?? null; ?>
          <?= status_row($label, $entry === null ? 'warn' : (string) $entry['level'], $entry === null ? 'Not run' : (string) $entry['message']) ?>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<section class="card">
  <h2>Configuration</h2>
  <div class="kv">
    <div><span>Application</span><strong><?= h((string) ($app['name'] ?? '—')) ?></strong></div>
    <div><span>URL</span><strong><?= h((string) ($app['url'] ?? '—')) ?></strong></div>
    <div><span>Environment</span><strong><?= h((string) ($app['env'] ?? '—')) ?></strong></div>
    <div><span>Timezone</span><strong><?= h((string) ($app['timezone'] ?? '—')) ?></strong></div>
    <div><span>System email</span><strong><?= h((string) ($app['system_email'] ?? '—')) ?></strong></div>
    <div><span>Backend</span><strong>http://127.0.0.1:<?= (int) $port ?> (server.js)</strong></div>
    <div><span>Backend folder</span><strong><code><?= h(Support::path((string) ($paths['app_root'] ?? ''))) ?></code></strong></div>
    <div><span>Config file</span><strong><code><?= h(Support::path((string) ($paths['config'] ?? ''))) ?>/config.php</code></strong></div>
    <div><span>Frontend published</span><strong><?= !empty($frontend['published_at']) ? h((string) $frontend['files']) . ' files' : 'will be published now' ?></strong></div>
    <div><span>Backend copied</span><strong><?= !empty($backend['copied_at']) ? h((string) $backend['files']) . ' files' : 'will be copied now' ?></strong></div>
  </div>
</section>

<section class="card">
  <h2>Administrator</h2>
  <div class="kv">
    <div><span>Name</span><strong><?= h(trim((string) ($admin['first_name'] ?? '') . ' ' . (string) ($admin['last_name'] ?? '')) ?: '—') ?></strong></div>
    <div><span>Username</span><strong><?= h((string) ($admin['idnumber'] ?? '—')) ?></strong></div>
    <div><span>Email</span><strong><?= h((string) ($admin['email'] ?? '—')) ?></strong></div>
    <div><span>Role</span><strong>super_admin (bcrypt cost 12)</strong></div>
  </div>
</section>

<section class="card">
  <h2>Security</h2>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th class="col-status">Status</th><th>Control</th><th>Result</th></tr></thead>
      <tbody>
        <?php foreach ($checklist as $row): ?>
          <?= status_row((string) $row['label'], (string) $row['level'], (string) $row['note']) ?>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<form method="post" class="wizard-form" id="form-step9">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="9">

  <div class="inline-actions">
    <a class="btn btn-secondary" href="?step=9&amp;download=report">Download Installation Report</a>
    <span class="muted small">
      Plain text, no secrets — safe to attach to a support ticket.
    </span>
  </div>

  <?= wizard_nav([
      'prev'      => 8,
      'nextId'    => 'btn-finish',
      'nextLabel' => 'Finish installation',
      'nextHint'  => 'Writes installed.lock. This is the point of no return — the installer is disabled afterwards.',
  ]) ?>
</form>

<div id="finish-report" hidden></div>

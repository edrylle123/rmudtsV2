<?php
/**
 * Step 5 — Database provisioning.
 *
 * @var int $step
 * @var string $csrf
 * @var array $db
 * @var array $provision
 */

declare(strict_types=1);

use Rmudts\Installer\Database;
use Rmudts\Installer\State;

$provisioned = State::has('db_provisioned');
$done = array_keys(array_filter($provision, static fn(array $entry): bool => ($entry['level'] ?? '') !== 'fail'));
?>
<p class="lead">
  Two buttons, two very different levels of risk. <strong>Test Connection</strong> only reads
  metadata. <strong>Test Connection &amp; Provision</strong> creates the tables, indexes,
  relationships and default records from <code>database/schema.sql</code> — it never drops
  anything, and re-running it is safe.
</p>

<div class="kv kv-inline">
  <div><span>Host</span><strong><?= h((string) ($db['host'] ?? '—')) ?>:<?= h((string) ($db['port'] ?? '3306')) ?></strong></div>
  <div><span>Database</span><strong><?= h((string) ($db['name'] ?? '—')) ?></strong></div>
  <div><span>User</span><strong><?= h((string) ($db['user'] ?? '—')) ?></strong></div>
  <div><span>Schema file</span><strong><?= h((string) (count(Database::REQUIRED_TABLES))) ?> required tables</strong></div>
</div>

<?php if ($provisioned): ?>
  <div class="banner banner-pass">
    <strong>Database provisioned.</strong> The schema is in place and verified — you can continue.
  </div>
<?php endif; ?>

<form method="post" class="wizard-form" id="form-step5" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="5">

  <section class="card">
    <h2>Actions</h2>
    <div class="inline-actions">
      <button type="button" class="btn btn-secondary" id="btn-db-test">Test Connection</button>
      <button type="button" class="btn btn-primary" id="btn-provision">Test Connection &amp; Provision</button>
      <button type="button" class="btn btn-ghost" id="btn-provision-reset">Clear console</button>
    </div>
    <p class="muted small" id="provision-state">
      <?= $provisioned ? 'Provisioning completed for this session.' : 'Not provisioned yet.' ?>
    </p>
    <div class="progress-bar" id="provision-progress" hidden>
      <div class="progress-bar-fill" style="width: 0%"></div>
    </div>
  </section>

  <section class="card">
    <h2>Activity</h2>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th class="col-status">Status</th><th>Check</th><th>Result</th></tr></thead>
        <tbody id="db-test-body"></tbody>
      </table>
    </div>
    <div class="console" id="provision-console" role="log" aria-live="polite" aria-label="Provisioning output">
      <div class="console-line console-info">Waiting to start…</div>
    </div>
    <ol class="stage-list" id="stage-list">
      <?php foreach (Database::STAGES as $stage => $label): ?>
        <?php
          $entry = $provision[$stage] ?? null;
          $stateClass = $entry === null ? '' : (($entry['level'] ?? '') === 'fail' ? 'is-fail' : 'is-done');
        ?>
        <li class="stage <?= h($stateClass) ?>" data-stage="<?= h($stage) ?>">
          <span class="stage-dot"></span>
          <span class="stage-label"><?= h($label) ?></span>
          <span class="stage-note"><?= h($entry !== null ? (string) $entry['message'] : '') ?></span>
        </li>
      <?php endforeach; ?>
    </ol>
  </section>

  <?= wizard_nav([
      'prev'         => 4,
      'nextLabel'    => 'Continue to application settings',
      'nextDisabled' => !$provisioned,
      'nextHint'     => $provisioned
          ? 'Next: application name, URLs, timezone and environment.'
          : 'Provisioning must complete successfully before you can continue.',
  ]) ?>
</form>

<details class="card card-quiet">
  <summary>What exactly will be created?</summary>
  <p class="muted small">
    The schema adds the RMUDTS tables (documents, records, record files, movements, office history,
    notifications, incoming documents, employees, offices, dropdown options, application settings,
    users), their indexes and foreign keys, plus the reference data the application expects:
    offices, dropdown options and default application settings. Existing tables are left untouched
    and existing rows are updated in place, so this step can never destroy data.
  </p>
</details>

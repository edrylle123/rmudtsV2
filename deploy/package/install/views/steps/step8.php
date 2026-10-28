<?php
/**
 * Step 8 — Security configuration.
 *
 * @var int $step
 * @var string $csrf
 * @var array $security
 * @var array $secrets
 * @var array $paths
 * @var ?array $result
 */

declare(strict_types=1);

use Rmudts\Installer\Security;
use Rmudts\Installer\State;
use Rmudts\Installer\Support;

$applied = State::isComplete(8) || !empty($security['applied_at']);
$checklist = (array) ($security['checklist'] ?? []);
$resultData = (array) (($result['data'] ?? []));
if (!empty($resultData['checklist'])) {
    $checklist = (array) $resultData['checklist'];
    $applied = true;
}
$previews = (array) ($resultData['secrets'] ?? []);
if ($previews === [] && $secrets !== []) {
    foreach (Security::SECRETS as $key => $label) {
        $previews[$key] = ['label' => $label, 'preview' => Support::redact((string) ($secrets[$key] ?? ''))];
    }
}
?>
<p class="lead">
  This step generates every secret the application needs and writes the protections that keep
  configuration, logs, uploads and backups unreachable over HTTP. Keys are produced with
  <code>random_bytes()</code> and are shown only in redacted form — the real values live in
  <code>.env</code> with mode <code>0600</code>.
</p>

<form method="post" class="wizard-form" id="form-step8" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="8">

  <section class="card">
    <h2>Generated secrets</h2>
    <div class="inline-actions">
      <button type="button" class="btn btn-primary" id="btn-security-run" data-regenerate="0">
        <?= $applied ? 'Re-apply security configuration' : 'Generate keys and apply security' ?>
      </button>
      <button type="button" class="btn btn-ghost" id="btn-security-regenerate" data-regenerate="1"
              title="Replaces every key. Existing sessions become invalid.">Regenerate all keys</button>
      <span class="muted small" id="security-state">
        <?= $applied ? 'Applied ' . h((string) ($security['applied_at'] ?? '')) : 'Not applied yet.' ?>
      </span>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead><tr><th class="col-status">Status</th><th>Secret</th><th>Value in .env</th></tr></thead>
        <tbody id="secret-body">
          <?php foreach (Security::SECRETS as $key => $label): ?>
            <tr>
              <td class="col-status" data-status-for="<?= h($key) ?>">
                <?= isset($previews[$key]['preview']) && $previews[$key]['preview'] !== '' ? chip('pass', 'READY') : chip('warn', 'PENDING') ?>
              </td>
              <td><?= h($label) ?></td>
              <td><code data-value-for="<?= h($key) ?>"><?= h((string) ($previews[$key]['preview'] ?? '—')) ?></code></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    </div>
    <p class="muted small">
      Redaction pattern: the first and last four characters only. Full values are written to
      <code><?= h(Support::path((string) $paths['config'])) ?>/.env</code>.
    </p>
  </section>

  <section class="card">
    <h2>Protection checklist</h2>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th class="col-status">Status</th><th>Control</th><th>Result</th></tr></thead>
        <tbody id="security-checklist">
          <?php if ($checklist === []): ?>
            <tr><td colspan="3" class="muted">Run the security step to see the results.</td></tr>
          <?php else: ?>
            <?php foreach ($checklist as $row): ?>
              <?= status_row((string) $row['label'], (string) $row['level'], (string) $row['note']) ?>
            <?php endforeach; ?>
          <?php endif; ?>
        </tbody>
      </table>
    </div>
  </section>

  <section class="card card-quiet">
    <h2>What is applied</h2>
    <div class="grid-2">
      <ul class="tight">
        <li><strong>Directory protection</strong> — <code>Options -Indexes</code>, <code>IndexIgnore *</code></li>
        <li><strong>Environment protection</strong> — <code>.env</code>, <code>installed.lock</code> and SQL dumps blocked by rewrite rules</li>
        <li><strong>Configuration protection</strong> — config folder denied with <code>Require all denied</code></li>
      </ul>
      <ul class="tight">
        <li><strong>Upload restrictions</strong> — executable extensions denied, documents served as <code>text/plain</code></li>
        <li><strong>Session security</strong> — HttpOnly, SameSite=Lax, strict mode, HTTPS-only when available</li>
        <li><strong>Key generation</strong> — application, encryption, JWT, refresh, API and CSRF secrets</li>
      </ul>
    </div>
  </section>

  <?= wizard_nav([
      'prev'         => 7,
      'nextId'       => 'btn-security-next',
      'nextLabel'    => 'Continue to summary',
      'nextDisabled' => !$applied,
      'nextHint'     => $applied
          ? 'Next: review everything that was configured before the lock file is written.'
          : 'Apply the security configuration before continuing.',
  ]) ?>
</form>

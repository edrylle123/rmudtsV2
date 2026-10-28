<?php
/**
 * Step 3 — File storage configuration.
 *
 * @var int $step
 * @var string $csrf
 * @var array $paths
 * @var array $storage
 */

declare(strict_types=1);

use Rmudts\Installer\Paths;
use Rmudts\Installer\Support;

$accountHint = Support::path((string) dirname((string) $paths['public_root']));
?>
<p class="lead">
  RMUDTS keeps everything that matters <strong>outside</strong> <code>public_html</code>.
  Accept the recommended layout (safest, and what cPanel backup tools expect) or
  enter your own absolute paths.
</p>

<div class="banner banner-warn">
  <strong>Never store sensitive configuration files inside <code>public_html</code>.</strong>
  The wizard refuses paths that put <code>.env</code>, <code>config.php</code>, logs, uploads or
  backups inside the web root.
</div>

<form method="post" class="wizard-form" id="form-step3" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="3">

  <section class="card">
    <h2>Deployment locations</h2>
    <p class="card-desc">
      Absolute paths on this account (root: <code><?= h($accountHint) ?></code>).
      Folders are created automatically with the right permissions.
    </p>

    <div class="path-grid">
      <?php foreach (Paths::KEYS as $key => $label): ?>
        <?php
          $value = (string) ($paths[$key] ?? '');
          $private = in_array($key, Paths::MUST_BE_PRIVATE, true);
          $readonly = $key === 'public_root';
        ?>
        <div class="field path-field<?= $private ? ' is-private' : '' ?>">
          <label for="f-<?= h($key) ?>">
            <?= h($label) ?>
            <?php if ($private): ?><span class="tag">outside web root</span><?php endif; ?>
            <?php if ($readonly): ?><span class="tag tag-quiet">detected</span><?php endif; ?>
          </label>
          <input id="f-<?= h($key) ?>" name="<?= h($key) ?>" type="text" value="<?= h($value) ?>"
                 data-default="<?= h((string) (Paths::defaults()[$key] ?? '')) ?>"
                 spellcheck="false" <?= $readonly ? 'readonly' : '' ?>>
          <p class="hint"><?= h(Paths::PURPOSE[$key] ?? '') ?></p>
        </div>
      <?php endforeach; ?>
    </div>

    <div class="inline-actions">
      <button type="button" class="btn btn-secondary" id="btn-storage-check" data-mode="check">Verify write permissions</button>
      <button type="button" class="btn btn-ghost" id="btn-storage-defaults">Restore recommended paths</button>
      <span class="muted small" id="storage-state">Not verified yet.</span>
    </div>
  </section>

  <section class="card" id="storage-report-card" hidden>
    <h2>Storage report</h2>
    <div class="table-wrap">
      <table class="table" id="storage-report">
        <thead><tr><th class="col-status">Status</th><th>Location</th><th>Result</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </section>

  <?php if (!empty($storage['report'])): ?>
    <section class="card card-quiet">
      <h2>Last verification</h2>
      <p class="muted small">Prepared <?= h((string) ($storage['prepared_at'] ?? '')) ?>.</p>
      <?= path_table($paths) ?>
    </section>
  <?php endif; ?>

  <?= wizard_nav([
      'prev'         => 2,
      'nextId'       => 'btn-storage-apply',
      'nextLabel'    => 'Create folders and continue',
      'nextDisabled' => false,
      'nextHint'     => 'Missing folders are created, permissions are verified, and each private folder gets its own protection file.',
  ]) ?>
</form>

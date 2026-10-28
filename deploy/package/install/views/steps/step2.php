<?php
/**
 * Step 2 — Requirements check.
 *
 * @var int $step
 * @var string $csrf
 * @var array $paths
 */

declare(strict_types=1);

use Rmudts\Installer\Integrity;
use Rmudts\Installer\Paths;
use Rmudts\Installer\Requirements;
use Rmudts\Installer\Support;

$groups = Requirements::all($paths);
$summary = Requirements::summarise($groups);
$counts = $summary['counts'];
$blocking = $summary['blocking'];
$integrity = Integrity::verify();
?>
<p class="lead">
  These checks are read-only — nothing here changes your server. Every
  <strong>FAIL</strong> marked as required must be resolved before the wizard
  will continue; <strong>WARNING</strong> items can be accepted.
</p>

<div class="stat-strip">
  <div class="stat stat-pass"><span class="stat-number"><?= (int) $counts['pass'] ?></span><span class="stat-label">passed</span></div>
  <div class="stat stat-warn"><span class="stat-number"><?= (int) $counts['warn'] ?></span><span class="stat-label">warnings</span></div>
  <div class="stat stat-fail"><span class="stat-number"><?= (int) $counts['fail'] ?></span><span class="stat-label">failed</span></div>
  <div class="stat"><span class="stat-number"><?= h(PHP_VERSION) ?></span><span class="stat-label">PHP version</span></div>
</div>

<?php if (!$summary['ok']): ?>
  <div class="banner banner-fail">
    <strong>This server is not ready yet.</strong>
    <ul class="tight">
      <?php foreach (array_slice($blocking, 0, 6) as $item): ?>
        <li><?= h($item) ?></li>
      <?php endforeach; ?>
      <?php if (count($blocking) > 6): ?>
        <li>…and <?= count($blocking) - 6 ?> more.</li>
      <?php endif; ?>
    </ul>
  </div>
<?php else: ?>
  <div class="banner banner-pass"><strong>Ready.</strong> Every required check passed<?= $counts['warn'] > 0 ? ' — ' . (int) $counts['warn'] . ' warning(s) are informational' : '' ?>.</div>
<?php endif; ?>

<section class="card">
  <h2>Package integrity</h2>
  <p class="card-desc">
    These checks read <code>checksums.json</code> and re-hash every shipped file, so a truncated
    upload or an edited release is caught before anything is written to the server.
  </p>
  <div class="table-wrap">
    <table class="table table-checks">
      <thead><tr><th class="col-status">Status</th><th class="col-label">Check</th><th>Details</th></tr></thead>
      <tbody>
        <?php foreach ($integrity['checks'] as $check): ?>
          <tr>
            <td class="col-status"><?= chip((string) $check['level'], strtoupper((string) $check['level'])) ?></td>
            <td><?= h((string) $check['label']) ?></td>
            <td><?= h((string) $check['note']) ?></td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<form method="post" class="wizard-form" id="form-step2">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="2">

  <?php foreach ($groups as $group): ?>
    <section class="card">
      <h2><?= h($group['group']) ?></h2>
      <div class="table-wrap">
        <table class="table table-checks">
          <thead><tr><th class="col-status">Status</th><th class="col-label">Check</th><th>Details</th></tr></thead>
          <tbody>
            <?php foreach ($group['checks'] as $check): ?>
              <?= status_row((string) $check['label'] . (!empty($check['critical']) ? ' *' : ''), (string) $check['level'], (string) $check['note']) ?>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div>
    </section>
  <?php endforeach; ?>

  <p class="muted small">* required (a failure in a starred row stops the installation).</p>

  <?= wizard_nav([
      'prev'         => 1,
      'nextLabel'    => 'Continue to storage setup',
      'nextDisabled' => !$summary['ok'],
      'nextHint'     => $summary['ok']
          ? 'Private storage folders are created next, outside the web root.'
          : 'Resolve the required failures listed above, then reload this page.',
  ]) ?>
</form>

<details class="card card-quiet">
  <summary>How do I fix the common failures?</summary>
  <ul class="tight">
    <li><strong>PHP version</strong> — cPanel → <em>MultiPHP Manager</em>: select PHP 8.1 or newer for this domain.</li>
    <li><strong>Missing extension</strong> — cPanel → <em>Select PHP Version</em> → <em>Extensions</em>: tick the extension, then save.</li>
    <li><strong>Node.js not found</strong> — cPanel → <em>Setup Node.js App</em> → Create Application (Node 18+). The account's <code>~/nodevenv</code> binaries then appear in PATH.</li>
    <li><strong>Folder not writable</strong> — cPanel → <em>File Manager</em>: set the folder to <code>755</code> (some hosts need <code>775</code>) and make sure the owner is your account.</li>
    <li><strong>Shell execution disabled</strong> — not a problem: the wizard simply leaves <code>npm install</code> for you to run from <em>Setup Node.js App</em>.</li>
  </ul>
</details>

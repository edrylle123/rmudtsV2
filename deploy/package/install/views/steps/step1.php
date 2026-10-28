<?php
/**
 * Step 1 — Welcome.
 *
 * @var int $step
 * @var string $csrf
 * @var array $paths
 */

declare(strict_types=1);

use Rmudts\Installer\Installer;
use Rmudts\Installer\Lock;
use Rmudts\Installer\Paths;
use Rmudts\Installer\State;
use Rmudts\Installer\Support;

$resumable = State::resumeStep() > 2;
?>
<div class="hero">
  <h2>Welcome to the RMUDTS Installation Wizard</h2>
  <p class="lead">
    This wizard will install and configure RMUDTS for production use on your cPanel
    hosting account. It takes about five minutes, and every value it writes is shown
    to you before anything is changed.
  </p>
</div>

<form method="post" class="wizard-form" id="form-step1" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="1">

  <div class="grid-2">
    <section class="card">
      <h2>What this wizard will do</h2>
      <ul class="checklist">
        <li><span class="tick">&#10003;</span> Environment validation — PHP, extensions, Node.js</li>
        <li><span class="tick">&#10003;</span> Storage configuration — data, logs, uploads, backups outside public_html</li>
        <li><span class="tick">&#10003;</span> Database setup — connection test and schema provisioning</li>
        <li><span class="tick">&#10003;</span> Application setup — <code>.env</code>, <code>config.php</code>, front controller</li>
        <li><span class="tick">&#10003;</span> Security configuration — keys, <code>.htaccess</code>, permissions</li>
        <li><span class="tick">&#10003;</span> Administrator account setup — super administrator with a hashed password</li>
      </ul>
    </section>

    <section class="card">
      <h2>Before you begin</h2>
      <ul class="checklist checklist-plain">
        <li>Create the MySQL database and user in <strong>cPanel → MySQL Databases</strong> (or keep the
            credentials handy — the wizard can create the database if your user may).</li>
        <li>Have your <strong>site address</strong> ready, for example <code>https://rmudts.your-domain.edu</code>.</li>
        <li>Choose the <strong>administrator username, email and password</strong> you will sign in with.</li>
      </ul>
      <p class="muted small">
        Detected site address: <code><?= h($detected_url !== '' ? $detected_url : Installer::detectUrl()) ?></code>
      </p>
    </section>
  </div>

  <section class="card card-quiet">
    <h2>Environment</h2>
    <div class="kv">
      <div><span>Installer version</span><strong>v<?= h(Installer::VERSION) ?></strong></div>
      <div><span>PHP</span><strong><?= h(PHP_VERSION) ?></strong></div>
      <div><span>Server API</span><strong><?= h(PHP_SAPI) ?></strong></div>
      <div><span>Installer folder</span><strong><code><?= h(Support::path(Paths::installDir())) ?></code></strong></div>
      <div><span>Web root</span><strong><code><?= h(Support::path((string) $paths['public_root'])) ?></code></strong></div>
      <div><span>Lock file</span><strong><code><?= h(Support::path(Lock::candidates()[0])) ?></code></strong></div>
    </div>
    <?php if ($resumable): ?>
      <p class="banner banner-info">
        <strong>Resuming:</strong> a previous installation attempt stopped at step
        <?= (int) State::resumeStep() ?>. Your answers were kept in
        <code>.install-state.json</code> and are still available.
      </p>
    <?php endif; ?>
  </section>

  <?= wizard_nav([
      'prev'      => null,
      'nextLabel' => 'Start Installation',
      'nextId'    => 'start-button',
      'extra'     => '<span class="muted small nav-note">Nothing is written until you confirm each step.</span>',
  ]) ?>
</form>

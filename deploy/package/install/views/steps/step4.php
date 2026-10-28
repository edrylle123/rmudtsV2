<?php
/**
 * Step 4 — Database configuration.
 *
 * @var int $step
 * @var string $csrf
 * @var array $db
 * @var ?array $result
 */

declare(strict_types=1);

$errors = (array) (($result['data']['errors'] ?? []));
$host = (string) ($db['host'] ?? 'localhost');
$port = (string) ($db['port'] ?? '3306');
$name = (string) ($db['name'] ?? '');
$user = (string) ($db['user'] ?? '');
?>
<p class="lead">
  Enter the MySQL account RMUDTS should use. On cPanel you create it in
  <strong>MySQL Databases</strong>; cPanel prefixes both the database and the user with your
  account name, for example <code>myaccount_rmudts</code> and <code>myaccount_rmudts_user</code>.
</p>

<form method="post" class="wizard-form" id="form-step4" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="4">

  <div class="grid-2">
    <section class="card">
      <h2>Connection</h2>
      <?= field([
          'name' => 'host', 'label' => 'Database Host', 'value' => $host, 'required' => true,
          'placeholder' => 'localhost',
          'hint' => 'Almost always localhost. Some managed hosts use a hostname such as mysql.your-host.com.',
          'error' => (string) ($errors['host'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'port', 'label' => 'Port', 'value' => $port, 'type' => 'number', 'required' => true,
          'min' => 1, 'max' => 65535, 'placeholder' => '3306',
          'hint' => '3306 unless your host says otherwise.',
          'error' => (string) ($errors['port'] ?? ''),
      ]) ?>
    </section>

    <section class="card">
      <h2>Database and credentials</h2>
      <?= field([
          'name' => 'name', 'label' => 'Database Name', 'value' => $name, 'required' => true,
          'placeholder' => 'myaccount_rmudts',
          'hint' => 'Letters, numbers and underscores. Created automatically if your user is allowed to.',
          'error' => (string) ($errors['name'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'user', 'label' => 'MySQL Username', 'value' => $user, 'required' => true,
          'placeholder' => 'myaccount_rmudts_user', 'autocomplete' => 'off',
          'error' => (string) ($errors['user'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'pass', 'label' => 'MySQL Password', 'value' => '', 'type' => 'password',
          'autocomplete' => 'new-password',
          'hint' => 'Stored only in .env (mode 0600) alongside the backend. Never written to a report or a log.',
          'error' => (string) ($errors['pass'] ?? ''),
      ]) ?>
      <?php if (!empty($db['pass'])): ?>
        <p class="muted small">A password is already stored for this session — leave the field empty to keep it.</p>
      <?php endif; ?>
    </section>
  </div>

  <section class="card">
    <h2>Verify before continuing</h2>
    <p class="card-desc">
      The test checks the four things that usually break an installation: the server is reachable,
      the credentials work, the database exists (or can be created), and the account has the
      privileges required to build the schema.
    </p>
    <div class="inline-actions">
      <button type="button" class="btn btn-secondary" id="btn-db-test">Test Connection</button>
      <span class="muted small" id="db-test-state">Not tested yet.</span>
    </div>
    <div id="db-test-results" hidden>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th class="col-status">Status</th><th>Check</th><th>Result</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </section>

  <?= wizard_nav([
      'prev'      => 3,
      'nextLabel' => 'Save and continue to provisioning',
      'nextHint'  => 'Nothing is written to the database until the next step.',
  ]) ?>
</form>

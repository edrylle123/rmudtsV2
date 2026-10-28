<?php
/**
 * Step 7 — Super administrator account.
 *
 * @var int $step
 * @var string $csrf
 * @var array $admin
 * @var ?array $result
 */

declare(strict_types=1);

use Rmudts\Installer\Security;

$errors = (array) (($result['data']['errors'] ?? []));
$requirements = (array) (($result['data']['policy']['requirements'] ?? Security::checkPassword('')['requirements']));
$existing = $admin !== [];
?>
<p class="lead">
  RMUDTS cannot be used without an administrator, so this step is mandatory.
  The account is created with the <code>super_admin</code> role — the only role that can
  manage users, offices and routing-slip settings.
</p>

<?php if ($existing): ?>
  <div class="banner banner-info">
    <strong>An account was already created:</strong>
    <?= h((string) ($admin['idnumber'] ?? '')) ?> (<?= h((string) ($admin['email'] ?? '')) ?>).
    Submitting the form again updates that account rather than creating a second one.
  </div>
<?php endif; ?>

<form method="post" class="wizard-form" id="form-step7" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="7">

  <div class="grid-2">
    <section class="card">
      <h2>Administrator details</h2>
      <div class="grid-2 grid-tight">
        <?= field([
            'name' => 'first_name', 'label' => 'First Name', 'required' => true,
            'value' => (string) ($admin['first_name'] ?? ''),
            'placeholder' => 'Juan',
            'error' => (string) ($errors['first_name'] ?? ''),
        ]) ?>
        <?= field([
            'name' => 'last_name', 'label' => 'Last Name', 'required' => true,
            'value' => (string) ($admin['last_name'] ?? ''),
            'placeholder' => 'Dela Cruz',
            'error' => (string) ($errors['last_name'] ?? ''),
        ]) ?>
      </div>
      <?= field([
          'name' => 'idnumber', 'label' => 'Username', 'required' => true,
          'value' => (string) ($admin['idnumber'] ?? ''),
          'placeholder' => 'jdelacruz',
          'hint' => 'This is the sign-in identifier RMUDTS stores in the users table (3–20 characters).',
          'error' => (string) ($errors['idnumber'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'email', 'label' => 'Email', 'type' => 'email', 'required' => true,
          'value' => (string) ($admin['email'] ?? ''),
          'placeholder' => 'records@your-domain.edu',
          'hint' => 'Used for password resets and system notifications.',
          'error' => (string) ($errors['email'] ?? ''),
      ]) ?>
    </section>

    <section class="card">
      <h2>Password</h2>
      <?= field([
          'name' => 'password', 'label' => 'Password', 'type' => 'password', 'required' => true,
          'autocomplete' => 'new-password', 'placeholder' => 'At least 10 characters',
          'error' => (string) ($errors['password'] ?? ''),
      ]) ?>
      <div class="meter" id="password-meter" aria-hidden="true"><span></span></div>
      <p class="muted small" id="password-meter-label">Strength: —</p>
      <?= field([
          'name' => 'password_confirm', 'label' => 'Confirm Password', 'type' => 'password', 'required' => true,
          'autocomplete' => 'new-password',
      ]) ?>

      <h3 class="sub">Password requirements</h3>
      <ul class="policy" id="password-policy">
        <?php foreach ($requirements as $requirement): ?>
          <li class="<?= !empty($requirement['met']) ? 'is-met' : '' ?>"
              data-rule="<?= h((string) $requirement['label']) ?>">
            <span class="tick">&#10003;</span><?= h((string) $requirement['label']) ?>
          </li>
        <?php endforeach; ?>
      </ul>
      <p class="muted small">
        Stored as a bcrypt hash (cost 12) — the same format the backend verifies, so the
        password is never recoverable from the database.
      </p>
    </section>
  </div>

  <?= wizard_nav([
      'prev'      => 6,
      'nextLabel' => 'Create administrator and continue',
      'nextHint'  => 'Next: generate application keys and apply security hardening.',
  ]) ?>
</form>

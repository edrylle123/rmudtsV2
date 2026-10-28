<?php
/**
 * Step 6 — Application configuration (.env + config.php).
 *
 * @var int $step
 * @var string $csrf
 * @var array $app
 * @var int $port
 * @var string $detected_url
 * @var ?array $result
 * @var array $paths
 */

declare(strict_types=1);

use Rmudts\Installer\Paths;
use Rmudts\Installer\Support;

$errors = (array) (($result['data']['errors'] ?? []));
$name = (string) ($app['name'] ?? 'RMUDTS');
$url = (string) ($app['url'] ?? $detected_url);
$clientUrl = (string) ($app['client_url'] ?? '');
$apiUrl = (string) ($app['api_url'] ?? '');
$email = (string) ($app['system_email'] ?? '');
$timezone = (string) ($app['timezone'] ?? 'Asia/Manila');
$env = (string) ($app['env'] ?? 'production');
$port = (int) ($port ?: 8081);

$commonZones = [
    'Asia/Manila' => 'Asia/Manila (Philippine Time, UTC+8)',
    'UTC' => 'UTC',
    'Asia/Singapore' => 'Asia/Singapore',
    'Asia/Tokyo' => 'Asia/Tokyo',
    'Asia/Kolkata' => 'Asia/Kolkata',
    'Asia/Dubai' => 'Asia/Dubai',
    'Europe/London' => 'Europe/London',
    'Europe/Berlin' => 'Europe/Berlin',
    'America/New_York' => 'America/New_York',
    'America/Chicago' => 'America/Chicago',
    'America/Denver' => 'America/Denver',
    'America/Los_Angeles' => 'America/Los_Angeles',
    'Australia/Sydney' => 'Australia/Sydney',
    'Pacific/Auckland' => 'Pacific/Auckland',
];
if (!isset($commonZones[$timezone])) {
    $commonZones = [$timezone => $timezone] + $commonZones;
}
?>
<p class="lead">
  These values become <code>.env</code> (read by the Node.js backend) and
  <code>config.php</code> (read by the front controller). Both are written outside
  <code>public_html</code> with mode <code>0600</code>.
</p>

<form method="post" class="wizard-form" id="form-step6" autocomplete="off">
  <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
  <input type="hidden" name="step" value="6">

  <div class="grid-2">
    <section class="card">
      <h2>Identity</h2>
      <?= field([
          'name' => 'name', 'label' => 'Application Name', 'value' => $name, 'required' => true,
          'hint' => 'Shown in the browser title, emails and the sign-in page.',
          'error' => (string) ($errors['name'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'url', 'label' => 'Application URL', 'value' => $url, 'required' => true,
          'placeholder' => 'https://rmudts.your-domain.edu',
          'hint' => 'The address users type, including https:// and no trailing slash.',
          'error' => (string) ($errors['url'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'client_url', 'label' => 'Frontend URL', 'value' => $clientUrl,
          'placeholder' => $url,
          'hint' => 'Leave empty to use the application URL. Only different for split deployments.',
      ]) ?>
      <?= field([
          'name' => 'api_url', 'label' => 'API URL', 'value' => $apiUrl,
          'placeholder' => $url . '/api',
          'hint' => 'Leave empty to use <application URL>/api.',
      ]) ?>
    </section>

    <section class="card">
      <h2>Runtime</h2>
      <?= select_field([
          'name' => 'env', 'label' => 'Environment', 'value' => $env,
          'options' => ['production' => 'production (recommended for a live site)', 'staging' => 'staging (test copy)'],
          'hint' => 'Production hides stack traces from visitors.',
      ]) ?>
      <?= select_field([
          'name' => 'timezone', 'label' => 'Timezone', 'value' => $timezone,
          'options' => $commonZones,
          'hint' => 'Used for dates, control-number prefixes and reports.',
          'error' => (string) ($errors['timezone'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'system_email', 'label' => 'System Email', 'value' => $email, 'type' => 'email',
          'placeholder' => 'records@your-domain.edu',
          'hint' => 'Sender address for notifications. The mailbox must exist on this host.',
          'error' => (string) ($errors['system_email'] ?? ''),
      ]) ?>
      <?= field([
          'name' => 'port', 'label' => 'Backend Port (loopback)', 'value' => (string) $port, 'type' => 'number',
          'min' => 1024, 'max' => 65535, 'required' => true,
          'hint' => 'The Node.js service listens here on 127.0.0.1 and is reached through the front controller.',
          'error' => (string) ($errors['port'] ?? ''),
      ]) ?>
    </section>
  </div>

  <section class="card card-quiet">
    <h2>Files this step writes</h2>
    <div class="kv">
      <div><span>Backend environment</span><strong><code><?= h(Support::path((string) $paths['app_root'])) ?>/.env</code></strong></div>
      <div><span>Configuration copy</span><strong><code><?= h(Support::path((string) $paths['config'])) ?>/.env</code></strong></div>
      <div><span>PHP configuration</span><strong><code><?= h(Support::path((string) $paths['config'])) ?>/config.php</code></strong></div>
      <div><span>Contains DB password</span><strong>only in the two .env files (0600)</strong></div>
    </div>
  </section>

  <?= wizard_nav([
      'prev'      => 5,
      'nextLabel' => 'Write configuration and continue',
      'nextHint'  => 'Next: create the initial super administrator account.',
  ]) ?>
</form>

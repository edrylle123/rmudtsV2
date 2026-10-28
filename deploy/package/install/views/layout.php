<?php
/**
 * RMUDTS installer — wizard shell.
 * ---------------------------------------------------------------------------
 * Renders the chrome that is identical on every step: brand header, the step
 * sidebar, the completion percentage and the slot the step view fills.
 *
 * @var array $ctx
 */

declare(strict_types=1);

use Rmudts\Installer\Installer;
use Rmudts\Installer\Paths;
use Rmudts\Installer\State;
use Rmudts\Installer\Support;

require_once __DIR__ . DIRECTORY_SEPARATOR . 'partials.php';

// phpcs:ignore -- extracted variables are the documented view contract.
extract($ctx, EXTR_SKIP);

$title = 'Step ' . $step . ' of ' . State::TOTAL_STEPS . ' — ' . State::STEPS[$step];
$done = State::completed();
$doneCount = count(array_filter($done, static fn(int $n): bool => $n > 0 && $n < 10));
$percent = State::percent();
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>RMUDTS Installation Wizard — <?= h($title) ?></title>
  <link rel="stylesheet" href="assets/css/installer.css">
</head>
<body class="wizard" data-step="<?= (int) $step ?>">
<a class="skip" href="#wizard-main">Skip to content</a>

<header class="topbar">
  <div class="topbar-brand">
    <span class="logo" aria-hidden="true">RM</span>
    <div>
      <h1>RMUDTS Installation Wizard</h1>
      <p>Records Management Unit — Document Tracking System <span class="version">v<?= h(Installer::VERSION) ?></span></p>
    </div>
  </div>
  <div class="topbar-meta">
    <span title="PHP version">PHP <?= h(PHP_VERSION) ?></span>
    <span title="Server software"><?= h((string) ($_SERVER['SERVER_SOFTWARE'] ?? 'unknown server')) ?></span>
    <span><?= (int) $doneCount ?> of <?= State::TOTAL_STEPS - 1 ?> steps complete</span>
  </div>
</header>

<div class="progress-outer" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="<?= (int) $percent ?>"
     aria-label="Installation progress">
  <div class="progress-inner" id="progress-bar" style="width: <?= (int) $percent ?>%"></div>
  <span class="progress-label" id="progress-label"><?= (int) $percent ?>% complete</span>
</div>

<div class="shell">
  <nav class="sidebar" aria-label="Installation steps">
    <ol class="step-list">
      <?php foreach (State::STEPS as $number => $name): ?>
        <?php
          $isDone = in_array($number, $done, true);
          $isCurrent = $number === (int) $step;
          $isReachable = $number <= (int) $furthest;
          $classes = 'step-item' . ($isDone ? ' is-done' : '') . ($isCurrent ? ' is-current' : '') . ($isReachable ? '' : ' is-locked');
        ?>
        <li class="<?= h($classes) ?>">
          <?php if ($isReachable): ?>
            <a href="?step=<?= (int) $number ?>" <?= $isCurrent ? 'aria-current="step"' : '' ?>>
          <?php else: ?>
            <span>
          <?php endif; ?>
            <span class="step-number"><?= $isDone && !$isCurrent ? '&#10003;' : (int) $number ?></span>
            <span class="step-name"><?= h($name) ?></span>
          <?php if ($isReachable): ?>
            </a>
          <?php else: ?>
            </span>
          <?php endif; ?>
        </li>
      <?php endforeach; ?>
    </ol>
    <p class="sidebar-foot">
      Running as <strong><?= h(Paths::phpUser()) ?></strong><br>
      Installer directory:<br><code><?= h(Support::path(Paths::installDir())) ?></code>
    </p>
  </nav>

  <main class="content" id="wizard-main">
    <?= message_box($flash) ?>
    <div id="async-messages" aria-live="polite"></div>

    <h2 class="step-title"><?= h(State::STEPS[(int) $step]) ?></h2>

    <?php
    $stepFile = __DIR__ . DIRECTORY_SEPARATOR . 'steps' . DIRECTORY_SEPARATOR . 'step' . (int) $step . '.php';
    if (is_file($stepFile)) {
        require $stepFile;
    } else {
        echo '<p class="muted">This step has no view yet.</p>';
    }
    ?>
  </main>
</div>

<footer class="footer">
  <span>RMUDTS v<?= h(Installer::VERSION) ?> installer</span>
  <span>Never upload the <code>install/</code> folder's contents into a public location without the generated <code>.htaccess</code>.</span>
</footer>

<script src="assets/js/installer.js" defer></script>
</body>
</html>

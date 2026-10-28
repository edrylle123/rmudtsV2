<?php
/**
 * RMUDTS — One-Click Installation Wizard
 * ===========================================================================
 * Open https://your-domain/install and this file runs the ten-step setup.
 *
 * Responsibilities of this file (nothing else):
 *   • refuse to run once installed.lock exists;
 *   • turn a POST into a call on Rmudts\Installer\Installer;
 *   • render the wizard shell with the view for the current step;
 *   • answer the wizard's asynchronous actions with JSON.
 *
 * All real work lives in install/lib/*.php, and is covered by php -l in the
 * release build, so the entry point stays readable.
 */

declare(strict_types=1);

// The installer must never be cached by a browser or a proxy: every step
// shows state that changes as the installation progresses.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

require_once __DIR__ . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'Installer.php';

use Rmudts\Installer\Installer;
use Rmudts\Installer\Lock;
use Rmudts\Installer\Paths;
use Rmudts\Installer\State;
use Rmudts\Installer\Support;
use Rmudts\Installer\Requirements;
use Rmudts\Installer\Security;
use Rmudts\Installer\Storage;
use Rmudts\Installer\Database;
use Rmudts\Installer\ConfigWriter;

Installer::boot();

// Actions the wizard calls over fetch() and expects JSON back from.
const RMUDTS_JSON_ACTIONS = [
    'storage-check', 'storage-apply', 'db-test', 'db-provision',
    'security-run', 'backend-install', 'frontend-publish', 'finish', 'report',
];

function rmudts_wants_json(): bool
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        return false;
    }
    if (strtolower((string) ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest') {
        return true;
    }
    if (str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json')) {
        return true;
    }
    return in_array((string) ($_POST['action'] ?? ''), RMUDTS_JSON_ACTIONS, true);
}

function rmudts_respond_json(array $result): never
{
    header('Content-Type: application/json; charset=utf-8');
    // Always hand back a fresh token so a long-running step cannot expire.
    $result['csrf'] = Installer::csrfToken();
    echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function rmudts_flash(string $level, string $message): void
{
    $_SESSION['rmudts_flash'] = ['level' => $level, 'message' => $message];
}

// ---------------------------------------------------------------------------
// 1. Already installed? Stop, and say so.
// ---------------------------------------------------------------------------
if (Lock::exists()) {
    require __DIR__ . DIRECTORY_SEPARATOR . 'views' . DIRECTORY_SEPARATOR . 'locked.php';
    exit;
}

// ---------------------------------------------------------------------------
// 2. Requests
// ---------------------------------------------------------------------------
$wantsJson = rmudts_wants_json();
$result = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $input = $_POST;
    // A file-upload style POST can arrive as JSON; accept both.
    if ($input === []) {
        $raw = (string) file_get_contents('php://input');
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $input = $decoded;
        }
    }
    $result = Installer::dispatch('POST', $input);

    if ($wantsJson) {
        rmudts_respond_json($result);
    }

    if (!empty($result['redirect'])) {
        if ($result['message'] !== '') {
            rmudts_flash($result['level'], $result['message']);
        }
        header('Location: ' . $result['redirect'], true, 303);
        exit;
    }
    // A failed form step renders in place with its errors visible.
    rmudts_flash($result['level'], $result['message']);
}

// ---------------------------------------------------------------------------
// 2b. Report download (?download=report) — a plain text attachment.
// ---------------------------------------------------------------------------
if (isset($_GET['download']) && (string) $_GET['download'] === 'report') {
    $report = Installer::report();
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="rmudts-installation-report-' . date('Ymd-His') . '.txt"');
    header('Content-Length: ' . strlen($report));
    echo $report;
    exit;
}

// ---------------------------------------------------------------------------
// 3. Which step may be shown?
// ---------------------------------------------------------------------------
$furthest = min(State::TOTAL_STEPS, State::resumeStep());
$requested = isset($_GET['step']) ? (int) $_GET['step'] : State::step();
$step = max(1, min(State::TOTAL_STEPS, $requested));
if ($step > $furthest && State::step() !== 10) {
    $step = $furthest;
    rmudts_flash('warn', 'Finish the current step before moving on.');
}
if ($step === 10 && !State::isComplete(10)) {
    $step = $furthest;
}
State::goTo($step);

$flash = $_SESSION['rmudts_flash'] ?? null;
unset($_SESSION['rmudts_flash']);

// Everything the views need. Kept in one place so a view never reaches for a
// global or repeats derivation logic.
$ctx = [
    'step'     => $step,
    'furthest' => $furthest,
    'csrf'     => Installer::csrfToken(),
    'flash'    => $flash,
    'result'   => $result,
    'paths'    => Installer::paths(),
    'port'     => Installer::backendPort(),
    'app'      => (array) (State::get('app') ?? []),
    'db'       => (array) (State::get('db') ?? []),
    'admin'    => (array) (State::get('admin') ?? []),
    'secrets'  => (array) (State::get('secrets') ?? []),
    'storage'  => (array) (State::get('storage') ?? []),
    'frontend' => (array) (State::get('frontend') ?? []),
    'backend'  => (array) (State::get('backend') ?? []),
    'security' => (array) (State::get('security') ?? []),
    'provision' => (array) (State::get('provision_progress') ?? []),
    'percent'  => State::percent(),
    'detected_url' => Installer::detectUrl(),
];

require __DIR__ . DIRECTORY_SEPARATOR . 'views' . DIRECTORY_SEPARATOR . 'layout.php';

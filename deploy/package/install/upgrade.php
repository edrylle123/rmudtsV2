<?php
/**
 * RMUDTS — Upgrade and Repair mode
 * ===========================================================================
 * Open https://your-domain/install/upgrade
 *
 * The ten-step wizard is for a fresh copy and is disabled once installed.lock
 * exists. This page is the supported way to update or repair a copy that is
 * already live:
 *
 *   • it updates the application code from the package that was uploaded,
 *   • it migrates the database schema (missing tables, columns and indexes are
 *     added; nothing is dropped) and runs pending data migrations,
 *   • it regenerates .env and config.php from the values already in place,
 *     keeping every secret,
 *   • it never creates, replaces or deletes an account.
 *
 * Access is gated on a key that lives in the private configuration folder
 * (rmudts-config/upgrade.key): the wizard disables itself precisely so a
 * visitor cannot re-run it, so upgrade mode needs its own proof that the person
 * using it is the administrator. The key is created on the first visit and can
 * only be read from the filesystem, never over HTTP.
 *
 * All real work lives in lib/Upgrader.php.
 */

declare(strict_types=1);

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Robots-Tag: noindex, nofollow');

require_once __DIR__ . DIRECTORY_SEPARATOR . 'lib' . DIRECTORY_SEPARATOR . 'Installer.php';

use Rmudts\Installer\Installer;
use Rmudts\Installer\Lock;
use Rmudts\Installer\Support;
use Rmudts\Installer\Upgrader;

Installer::boot();

// Upgrade mode only exists for an installed copy. Anything else belongs in the
// wizard, which is one page over.
if (!Lock::exists()) {
    header('Location: index.php', true, 303);
    exit;
}

$ctx = Upgrader::context();
$keyFile = Upgrader::ensureKey($ctx['paths']);
$authorised = Upgrader::authorised($ctx['paths']);
$flash = null;
$result = null;

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = (string) ($_POST['action'] ?? '');
    $token = (string) ($_POST['csrf'] ?? '');

    if (!hash_equals(Installer::csrfToken(), $token)) {
        $flash = ['level' => 'fail', 'message' => 'Your session expired (security token mismatch). Reload the page and try again.'];
    } else {
        switch ($action) {
            case 'authorize':
                $outcome = Upgrader::authorise((string) ($_POST['key'] ?? ''), $ctx['paths']);
                $authorised = Upgrader::authorised($ctx['paths']);
                $flash = ['level' => $outcome['ok'] ? 'pass' : 'fail', 'message' => $outcome['message']];
                break;

            case 'revoke':
                Upgrader::revoke();
                $authorised = false;
                $flash = ['level' => 'info', 'message' => 'Upgrade mode is locked again. The key in the configuration folder is unchanged.'];
                break;

            case 'run':
                if (!$authorised) {
                    $flash = ['level' => 'fail', 'message' => 'Unlock upgrade mode with the key from the configuration folder before running it.'];
                    break;
                }
                @set_time_limit(900);
                // A copy that half-finished because the browser was closed is
                // worse than one that takes a little longer to answer.
                @ignore_user_abort(true);
                $result = Upgrader::run($ctx, [
                    'mode'     => (string) ($_POST['mode'] ?? 'upgrade'),
                    'code'     => isset($_POST['code']),
                    'deps'     => isset($_POST['deps']),
                    'schema'   => isset($_POST['schema']),
                    'config'   => isset($_POST['config']),
                    'password' => (string) ($_POST['password'] ?? ''),
                ]);
                // Re-read the copy so the page reflects what is actually there
                // now, not what was there before the run.
                $ctx = Upgrader::context();
                $authorised = Upgrader::authorised($ctx['paths']);
                $flash = [
                    'level'   => $result['ok'] ? 'pass' : 'fail',
                    'message' => $result['aborted']
                        ? 'Nothing was changed. ' . (string) ($result['steps'][count($result['steps']) - 1]['message'] ?? '')
                        : ($result['ok']
                            ? 'Upgrade finished. Restart the Node.js application so the new backend code is loaded.'
                            : 'The upgrade finished, but some steps need attention — read the results below.'),
                ];
                break;

            default:
                $flash = ['level' => 'warn', 'message' => 'Unknown action.'];
        }
    }
}

$plan = Upgrader::plan($ctx);
$version = Upgrader::versionState($ctx);
$last = Upgrader::lastUpgrade($ctx['paths']);
$csrf = Installer::csrfToken();

require __DIR__ . DIRECTORY_SEPARATOR . 'views' . DIRECTORY_SEPARATOR . 'upgrade.php';

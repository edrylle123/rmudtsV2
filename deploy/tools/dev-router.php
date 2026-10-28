<?php
/**
 * dev-router.php — development-only front-controller shim.
 * ---------------------------------------------------------------------------
 * The release relies on Apache's .htaccess to send unknown paths to index.php.
 * PHP's built-in web server has no mod_rewrite, so this router reproduces the
 * same behaviour for the acceptance harness (deploy/tools/verify-installer.php):
 *
 *   • real files (install/index.php, static/*, ...) are served by PHP;
 *   • everything else is handled by index.php, exactly like the .htaccess rules.
 *
 *   php -S 127.0.0.1:8099 -t dist/verify deploy/tools/dev-router.php
 *
 * Developer tool — never staged into the release archive.
 */

declare(strict_types=1);

$docroot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
if ($docroot === '') {
    $docroot = dirname(__DIR__, 2) . '/dist/verify';
}

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = rawurldecode($path);
if ($path === '') {
    $path = '/';
}

$target = $docroot . ($path === '/' ? '/index.php' : $path);

// PHP scripts run normally (the built-in server sets SCRIPT_NAME for them).
if (is_file($target) && str_ends_with(strtolower($target), '.php')) {
    return false;
}

// Static files are served by the built-in server exactly as Apache would.
if ($path !== '/' && is_file($target)) {
    return false;
}

require $docroot . '/index.php';

<?php
/**
 * RMUDTS front controller (public_html/index.php)
 * ===========================================================================
 * GENERATED FILE — the installation wizard wrote this from
 * install/views/templates/public-index.php.tpl. Editing it by hand is fine,
 * but re-running the wizard overwrites it.
 *
 * What it does, in order:
 *
 *   1. Loads config.php from outside the web root.
 *   2. Sends the visitor to the wizard while the system is not installed.
 *   3. Serves real files directly, so the app works even without mod_rewrite.
 *   4. Proxies every API call (/login, /records, /api, /uploads, …) to the
 *      Node.js backend listening on loopback.
 *   5. Falls back to the single-page application's index.html for deep links.
 *
 * The prefix list is intentionally identical to client/src/setupProxy.js, so
 * development and production route exactly the same way.
 *
 * WebSocket note: PHP cannot proxy the Socket.IO upgrade, so the upgrade
 * request is answered with 400 and the client transparently continues on
 * HTTP long-polling. To get true WebSockets, expose the Node port through
 * cPanel's own reverse proxy instead (see docs/INSTALL.md).
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
$RMUDTS_CONFIG_DIR = '{{CONFIG_DIR}}';
$RMUDTS_BACKEND_PORT = (int) '{{BACKEND_PORT}}';
$RMUDTS_APP_NAME = '{{APP_NAME}}';
$RMUDTS_FRONTEND_URL = '{{FRONTEND_URL}}';

$configFile = rtrim($RMUDTS_CONFIG_DIR, '/') . '/config.php';
if (!is_file($configFile)) {
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>RMUDTS is not configured</title>'
        . '<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.5">'
        . '<h1>RMUDTS is not configured yet</h1>'
        . '<p>The configuration file could not be found at <code>'
        . htmlspecialchars($RMUDTS_CONFIG_DIR, ENT_QUOTES) . '/config.php</code>.</p>'
        . '<p>Open <a href="install/">the installation wizard</a> to finish setting the application up.</p>';
    exit;
}

/** @var array $config */
$config = require $configFile;

$basePath = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'))), '/');
$isInstalled = !empty($config['installed']);

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------
function rmudts_path(): array
{
    return $GLOBALS['config']['paths'] ?? [];
}

function rmudts_request_path(): string
{
    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    $path = parse_url($uri, PHP_URL_PATH);
    $path = is_string($path) ? rawurldecode($path) : '/';
    $base = (string) ($GLOBALS['basePath'] ?? '');
    if ($base !== '' && $base !== '/' && str_starts_with($path, $base)) {
        $path = substr($path, strlen($base));
    }
    if ($path === '' || $path === false) {
        $path = '/';
    }
    if ($path[0] !== '/') {
        $path = '/' . $path;
    }
    // Collapse traversal attempts before the path is ever used on disk.
    if (str_contains($path, '..')) {
        $path = '/' . ltrim(str_replace('..', '', $path), '/');
    }
    return $path;
}

/** Prefix match on a path-segment boundary, the way Express `app.use()` does. */
function rmudts_is_api_path(string $path): bool
{
    $prefixes = $GLOBALS['config']['api_prefixes'] ?? [];
    foreach ((array) $prefixes as $prefix) {
        $prefix = '/' . trim((string) $prefix, '/');
        if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
            return true;
        }
    }
    return false;
}

function rmudts_backend_base(): string
{
    $backend = $GLOBALS['config']['backend'] ?? [];
    $port = (int) ($backend['port'] ?? $GLOBALS['RMUDTS_BACKEND_PORT'] ?? 8081);
    return rtrim((string) ($backend['base'] ?? 'http://127.0.0.1:' . $port), '/');
}

function rmudts_backend_alive(int $timeoutMs = 400): bool
{
    $socket = @fsockopen('127.0.0.1', (int) parse_url(rmudts_backend_base(), PHP_URL_PORT), $errno, $errstr, $timeoutMs / 1000);
    if ($socket === false) {
        return false;
    }
    fclose($socket);
    return true;
}

/** Headers to forward upstream, minus the hop-by-hop ones. */
function rmudts_forward_headers(): array
{
    $drop = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
        'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'accept-encoding',
        'content-length', 'expect'];
    $headers = [];
    foreach ($_SERVER as $key => $value) {
        if (str_starts_with($key, 'HTTP_')) {
            $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
            if (in_array(strtolower($name), $drop, true)) {
                continue;
            }
            $headers[$name] = (string) $value;
        }
    }
    foreach (['CONTENT_TYPE' => 'Content-Type', 'CONTENT_LENGTH' => 'Content-Length'] as $serverKey => $name) {
        if (!empty($_SERVER[$serverKey])) {
            $headers[$name] = (string) $_SERVER[$serverKey];
        }
    }
    // Apache/cPanel often hide Authorization from PHP; recover it when present.
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'REDIRECT_REDIRECT_HTTP_AUTHORIZATION'] as $key) {
        if (!empty($_SERVER[$key]) && empty($headers['Authorization'])) {
            $headers['Authorization'] = (string) $_SERVER[$key];
        }
    }
    $forwarded = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if ($forwarded !== '') {
        $headers['X-Forwarded-For'] = isset($headers['X-Forwarded-For'])
            ? $headers['X-Forwarded-For'] . ', ' . $forwarded
            : $forwarded;
        $headers['X-Real-IP'] = $forwarded;
    }
    $headers['X-Forwarded-Proto'] = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $headers['X-Forwarded-Host'] = (string) ($_SERVER['HTTP_HOST'] ?? '');
    $headers['X-Rmudts-Proxy'] = 'php-front-controller';
    return $headers;
}

function rmudts_emit_headers(array $lines): void
{
    $blocked = ['transfer-encoding', 'connection', 'keep-alive', 'content-length', 'content-encoding'];
    foreach ($lines as $line) {
        $name = strtolower(strtok($line, ':') ?: '');
        if ($name === '' || in_array($name, $blocked, true)) {
            continue;
        }
        if (str_starts_with(strtolower($line), 'http/')) {
            continue;
        }
        header($line, false);
    }
}

/**
 * Proxy the current request to the Node.js backend and stream the response.
 */
function rmudts_proxy(string $path, bool $headOnly = false): void
{
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $base = rmudts_backend_base();
    $query = (string) ($_SERVER['QUERY_STRING'] ?? '');
    $target = $base . $path . ($query !== '' ? '?' . $query : '');
    $body = null;
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        $body = file_get_contents('php://input');
        $body = $body === false ? '' : $body;
    }

    $timeout = (int) (($GLOBALS['config']['security']['proxy_timeout'] ?? 60));

    $forward = rmudts_forward_headers();
    $forwardLines = [];
    foreach ($forward as $name => $value) {
        $forwardLines[] = $name . ': ' . $value;
    }

    if (function_exists('curl_init')) {
        $status = 502;
        $lines = [];
        $curl = curl_init();
        curl_setopt_array($curl, [
            CURLOPT_URL            => $target,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_SSL_VERIFYPEER => false,   // loopback only
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_HTTPHEADER     => $forwardLines,
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$status, &$lines): int {
                $trimmed = trim($line);
                if ($trimmed === '') {
                    return strlen($line);
                }
                if (preg_match('#^HTTP/\S+\s+(\d{3})#i', $trimmed, $m)) {
                    $status = (int) $m[1];
                } else {
                    $lines[] = $trimmed;
                }
                return strlen($line);
            },
        ]);
        if ($body !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        if ($headOnly) {
            curl_setopt($curl, CURLOPT_NOBODY, true);
        }
        $response = curl_exec($curl);
        $errno = curl_errno($curl);
        $error = curl_error($curl);
        curl_close($curl);

        if ($errno !== 0) {
            rmudts_backend_unreachable($path, $error, $errno, true);
        }
        http_response_code($status);
        rmudts_emit_headers($lines);
        if ($response !== false && !$headOnly) {
            echo $response;
        }
        exit;
    }

    // Fallback without cURL: the HTTP stream wrapper. Fine for JSON APIs, and
    // it de-chunks responses for us.
    $options = [
        'http' => [
            'method'        => $method,
            'header'        => implode("\r\n", $forwardLines),
            'content'       => $body ?? '',
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ],
    ];
    $context = stream_context_create($options);
    $response = @file_get_contents($target, false, $context);
    $headers = $http_response_header ?? [];
    if ($response === false && $headers === []) {
        rmudts_backend_unreachable($path, 'stream wrapper could not open ' . $target, 0, true);
    }
    $status = 502;
    foreach ($headers as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#i', $line, $m)) {
            $status = (int) $m[1];
            continue;
        }
        if (str_contains($line, ':')) {
            rmudts_emit_headers([$line]);
        }
    }
    http_response_code($status);
    if (!$headOnly && $response !== false) {
        echo $response;
    }
    exit;
}

/** A 502 that tells the administrator exactly what to do. */
function rmudts_backend_unreachable(string $path, string $detail, int $errno = 0, bool $json = false): void
{
    $port = (int) (($GLOBALS['config']['backend']['port'] ?? 8081));
    $wantsJson = $json || str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json');
    http_response_code(502);
    if ($wantsJson) {
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode([
            'error'   => 'backend_unreachable',
            'message' => 'The RMUDTS application service is not responding.',
            'detail'  => 'No connection on 127.0.0.1:' . $port . ' for ' . $path,
        ]);
        exit;
    }
    header('Content-Type: text/html; charset=utf-8');
    $name = htmlspecialchars((string) ($GLOBALS['config']['app']['name'] ?? 'RMUDTS'), ENT_QUOTES);
    echo '<!doctype html><meta charset="utf-8"><title>' . $name . ' — service unavailable</title>'
        . '<body style="font-family:system-ui;max-width:44rem;margin:4rem auto;line-height:1.6">'
        . '<h1>Application service unavailable</h1>'
        . '<p>The website is running, but the ' . $name . ' backend (Node.js) is not answering on '
        . '<code>127.0.0.1:' . $port . '</code>.</p>'
        . '<ol><li>Open <strong>cPanel → Setup Node.js App</strong> and start the application '
        . '(startup file <code>server.js</code>, application root the folder recorded in config.php).</li>'
        . '<li>Confirm the port in <code>.env</code> matches <code>' . $port . '</code>.</li>'
        . '<li>Retry this page.</li></ol>'
        . '<p style="color:#64748b">Diagnostic: ' . htmlspecialchars($detail, ENT_QUOTES) . ' (errno ' . $errno . ')</p>';
    exit;
}

/** Serve a static file from the web root (used when mod_rewrite is missing). */
function rmudts_serve_static(string $relative): bool
{
    $root = (string) (rmudts_path()['public_root'] ?? dirname(__DIR__));
    $file = rtrim($root, '/') . $relative;
    if (!is_file($file)) {
        // The compiled build lives in /rmudts/; try it when the request did not
        // already carry the prefix (hosts without mod_rewrite).
        $file = rtrim($root, '/') . rtrim((string) $GLOBALS['RMUDTS_FRONTEND_URL'], '/') . $relative;
    }
    if (!is_file($file) || preg_match('/\.(php|phtml|phar|pl|py|cgi|sh|htaccess)$/i', $file)) {
        return false;
    }
    $types = [
        'html' => 'text/html; charset=utf-8', 'js' => 'application/javascript; charset=utf-8',
        'mjs' => 'application/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8',
        'json' => 'application/json; charset=utf-8', 'map' => 'application/json; charset=utf-8',
        'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif',
        'svg' => 'image/svg+xml', 'ico' => 'image/x-icon', 'webp' => 'image/webp',
        'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'eot' => 'application/vnd.ms-fontobject',
        'pdf' => 'application/pdf', 'txt' => 'text/plain; charset=utf-8',
        'webmanifest' => 'application/manifest+json', 'mp4' => 'video/mp4', 'webm' => 'video/webm',
    ];
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('Content-Length: ' . (string) filesize($file));
    // CRA fingerprints everything under /static/, so it is safe to cache hard.
    header(str_contains($relative, '/static/')
        ? 'Cache-Control: public, max-age=2592000, immutable'
        : 'Cache-Control: no-cache');
    readfile($file);
    return true;
}

/** The SPA shell. */
function rmudts_serve_spa(): void
{
    $root = (string) (rmudts_path()['public_root'] ?? dirname(__DIR__));
    $index = rtrim($root, '/') . '/index.html';
    if (!is_file($index)) {
        // Canonical layout: the React build is published in public_html/rmudts.
        $index = rtrim($root, '/') . rtrim((string) $GLOBALS['RMUDTS_FRONTEND_URL'], '/') . '/index.html';
    }
    if (!is_file($index)) {
        http_response_code(503);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><meta charset="utf-8"><title>RMUDTS</title>'
            . '<body style="font-family:system-ui;max-width:40rem;margin:4rem auto">'
            . '<h1>The frontend has not been published</h1>'
            . '<p>index.html is missing from the web root. Re-run the wizard with the built '
            . 'frontend (client/build) present in the package.</p>';
        return;
    }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache, must-revalidate');
    header('X-Content-Type-Options: nosniff');
    readfile($index);
}

// ---------------------------------------------------------------------------
// 1. Not installed yet → hand over to the wizard
// ---------------------------------------------------------------------------
if (!$isInstalled) {
    $wizard = ($basePath === '' ? '' : $basePath) . '/install/';
    if (is_file(dirname(__DIR__) . '/install/index.php')) {
        header('Location: ' . $wizard, true, 302);
        exit;
    }
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><title>RMUDTS</title>'
        . '<body style="font-family:system-ui;max-width:40rem;margin:4rem auto">'
        . '<h1>RMUDTS is not installed</h1><p>The installation wizard folder (install/) is missing. '
        . 'Re-upload the release archive and open <code>/install</code>.</p>';
    exit;
}

$path = rmudts_request_path();
$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

// ---------------------------------------------------------------------------
// 2. Diagnostics endpoint
// ---------------------------------------------------------------------------
if ($path === '/_rmudts/health') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode([
        'product'  => $config['product'] ?? 'RMUDTS',
        'version'  => $config['version'] ?? null,
        'installed' => (bool) ($config['installed'] ?? false),
        'php'      => PHP_VERSION,
        'backend'  => [
            'endpoint' => rmudts_backend_base(),
            'alive'    => rmudts_backend_alive(),
        ],
        'time'     => date('c'),
    ], JSON_PRETTY_PRINT);
    exit;
}

// ---------------------------------------------------------------------------
// 3. Static assets and SPA entry
// ---------------------------------------------------------------------------
$looksLikeFile = (bool) preg_match('/\.[A-Za-z0-9]{2,10}$/', $path);

if ($path === '/' || $path === '/index.html') {
    rmudts_serve_spa();
    exit;
}
if ($looksLikeFile && rmudts_serve_static($path)) {
    exit;
}

// ---------------------------------------------------------------------------
// 4. Never proxy the installer's own routes
// ---------------------------------------------------------------------------
if ($path === '/install' || str_starts_with($path, '/install/')) {
    $wizard = rtrim(dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/');
    header('Location: ' . ($wizard === '' ? '' : $wizard) . '/install/index.php', true, 302);
    exit;
}

// ---------------------------------------------------------------------------
// 5. API → backend
// ---------------------------------------------------------------------------
if (rmudts_is_api_path($path)) {
    $isUpgrade = strtolower((string) ($_SERVER['HTTP_UPGRADE'] ?? '')) === 'websocket';
    if ($isUpgrade) {
        // PHP cannot tunnel the WebSocket upgrade; telling the client "no"
        // makes Socket.IO fall back to HTTP long-polling automatically.
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'websocket_upgrade_unsupported', 'transport' => 'polling']);
        exit;
    }
    rmudts_proxy($path, $method === 'HEAD');
    exit;
}

// ---------------------------------------------------------------------------
// 6. A missing file is a 404, not the SPA shell
// ---------------------------------------------------------------------------
// Deep links such as /dashboard must return the application, but a request for
// an asset that does not exist (main.abc123.js after a redeploy, favicon, PDF)
// must not answer with HTML: that breaks script/style loading and hides real
// deployment problems behind a 200.
if ($looksLikeFile) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo "404 Not Found — " . $path . "\n";
    exit;
}

// ---------------------------------------------------------------------------
// 7. Anything else is a client route → SPA shell
// ---------------------------------------------------------------------------
if (in_array($method, ['GET', 'HEAD'], true)) {
    rmudts_serve_spa();
    exit;
}

// Unknown API-ish call for a non-proxied prefix.
http_response_code(404);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['error' => 'not_found', 'path' => $path, 'message' => 'No route matches this path.']);

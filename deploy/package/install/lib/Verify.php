<?php
/**
 * RMUDTS Installer — Verify
 * ---------------------------------------------------------------------------
 * Step 13 checks the deployment the way a visitor experiences it: HTTP requests
 * to the frontend, the API subdomain and the Socket.IO handshake, plus direct
 * database and filesystem checks. Nothing is marked successful unless the
 * service actually answered.
 *
 * A failed check is reported with the corrective action, never a stack trace.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Verify
{
    /**
     * @return array{ok:bool,checks:array<int,array<string,mixed>>,summary:array<string,int>}
     */
    public static function run(array $paths, array $db, array $urls, array $admin = []): array
    {
        $checks = [];
        $frontend = (string) ($urls['frontend'] ?? '');
        $api = (string) ($urls['api'] ?? '');
        $socketPath = (string) ($urls['socket_path'] ?? '/socket.io');

        $checks[] = self::schemeCheck('Frontend', $frontend);
        $checks[] = self::schemeCheck('API', $api);

        // ------------------------------------------------------------ frontend --
        $page = self::http($frontend . 'index.html');
        $isHtml = stripos((string) $page['content_type'], 'html') !== false;
        $hasRoot = str_contains((string) $page['body'], 'id="root"') || str_contains((string) $page['body'], "id='root'");
        $checks[] = self::check(
            'Frontend page',
            $page['status'] === 200 && $isHtml && $hasRoot ? 'pass' : 'fail',
            $page['status'] === 200
                ? ($hasRoot ? 'HTTP 200 — index.html served from ' . $frontend : 'HTTP 200, but the page does not contain the React root element. The frontend was not published correctly.')
                : 'HTTP ' . ($page['status'] ?: 'no response') . ' from ' . $frontend . '. Check that public_html/rmudts contains the build and that .htaccess allows index.html. ' . ($page['error'] ?: ''),
            'Upload the frontend again (step 9) and confirm public_html/rmudts/index.html exists.'
        );

        $manifest = self::http($frontend . 'manifest.json');
        $manifestJson = json_decode((string) $manifest['body'], true);
        $checks[] = self::check(
            'manifest.json',
            $manifest['status'] === 200 && is_array($manifestJson) ? 'pass' : 'fail',
            $manifest['status'] === 200
                ? (is_array($manifestJson) ? 'HTTP 200 — valid JSON' : 'HTTP 200, but the response is not JSON (an HTML error page was returned).')
                : 'HTTP ' . ($manifest['status'] ?: 'no response') . '. A 403 usually means the .htaccess FilesMatch block is too broad; a 404 means the build was not copied.',
            'Make sure manifest.json exists in the build and is not blocked by .htaccess.'
        );

        $runtime = self::http($frontend . 'runtime-config.js');
        $checks[] = self::check(
            'Runtime configuration',
            $runtime['status'] === 200 && str_contains((string) $runtime['body'], 'RMUDTS_CONFIG') ? 'pass' : 'fail',
            $runtime['status'] === 200
                ? (str_contains((string) $runtime['body'], 'RMUDTS_CONFIG') ? 'HTTP 200 — API_URL and SOCKET_URL are available to the SPA' : 'HTTP 200, but the file does not define window.RMUDTS_CONFIG.')
                : 'HTTP ' . ($runtime['status'] ?: 'no response') . ' — the SPA cannot discover the API.',
            'Re-run step 9 to regenerate runtime-config.js.'
        );

        // Individual bundles named by the published index.html.
        $missing = 0;
        $checkedAssets = 0;
        $localIndex = rtrim((string) ($paths['frontend'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'index.html';
        if (is_file($localIndex) && preg_match_all('/(?:src|href)\s*=\s*["\']([^"\']+)["\']/i', (string) @file_get_contents($localIndex), $matches)) {
            foreach ($matches[1] as $ref) {
                if (!preg_match('#(?:static|assets|css|media)/#', (string) $ref)) {
                    continue;
                }
                $checkedAssets++;
                $assetUrl = self::absolute($frontend, (string) $ref);
                $asset = self::http($assetUrl);
                if ($asset['status'] !== 200) {
                    $missing++;
                }
            }
        }
        $checks[] = self::check(
            'JavaScript and CSS bundles',
            $checkedAssets === 0 ? 'warn' : ($missing === 0 ? 'pass' : 'fail'),
            $checkedAssets === 0
                ? 'No bundles were referenced by index.html — verify the build manually.'
                : ($missing === 0
                    ? $checkedAssets . ' asset(s) return HTTP 200'
                    : $missing . ' of ' . $checkedAssets . ' bundle(s) return an error. A wrong homepage/base path produces 404s under /rmudts/static/.'),
            'Rebuild the client with PUBLIC_URL=/rmudts/ (CRA) or base=/rmudts/ (Vite).'
        );

        // ----------------------------------------------------------------- api --
        $root = self::http($api);
        $rootJson = json_decode((string) $root['body'], true);
        $hasTrace = stripos((string) $root['body'], 'stack') !== false || stripos((string) $root['body'], 'at Object.') !== false;
        $checks[] = self::check(
            'API root',
            $root['status'] === 200 && is_array($rootJson) && !$hasTrace ? 'pass' : 'fail',
            $root['status'] === 200
                ? (is_array($rootJson) && !$hasTrace ? 'HTTP 200 — valid JSON health response' : 'HTTP 200, but the response is not clean JSON. The application may be serving an error page.')
                : 'HTTP ' . ($root['status'] ?: 'no response') . ' from ' . $api . '. A 403/404 means the subdomain points at the wrong document root or the Node.js application is not registered; 500/503 means it failed to start. ' . ($root['error'] ?: ''),
            'Register the application in cPanel (step 12) and check its log.'
        );

        $health = self::http($api . 'api/health');
        $healthJson = json_decode((string) $health['body'], true);
        $dbState = is_array($healthJson) ? ($healthJson['database'] ?? null) : null;
        $checks[] = self::check(
            'API health and database',
            $health['status'] === 200 && is_array($healthJson) ? 'pass' : 'fail',
            $health['status'] === 200
                ? (is_array($healthJson) ? 'HTTP 200 — database: ' . (string) ($dbState ?? 'unknown') : 'HTTP 200, but the body is not JSON.')
                : 'HTTP ' . ($health['status'] ?: 'no response') . ' from ' . $api . 'api/health. If the root works but this does not, the backend started before .env was readable.',
            'Confirm rmudts-config/.env is readable by the application user and contains DB_* values.'
        );

        $socket = self::http($api . ltrim($socketPath, '/') . '/?EIO=4&transport=polling');
        $handshake = preg_match('/^\s*0\{/', (string) $socket['body']) === 1;
        $htmlError = stripos((string) $socket['body'], '<html') !== false || stripos((string) $socket['body'], '<!doctype') !== false;
        $checks[] = self::check(
            'Socket.IO handshake',
            $socket['status'] === 200 && $handshake ? 'pass' : 'fail',
            $socket['status'] === 200
                ? ($handshake ? 'HTTP 200 — Engine.IO handshake received' : 'HTTP 200, but the body is not an Engine.IO handshake' . ($htmlError ? ' (an Apache HTML page was returned)' : '') . '.')
                : 'HTTP ' . ($socket['status'] ?: 'no response') . ($socket['status'] === 404 ? ' — a 404 means Socket.IO is not attached, or the proxy path is wrong.' : ''),
            'Socket.IO must be attached to the same HTTP server as Express and the path must match /socket.io.'
        );

        // If the polling handshake works but a WebSocket upgrade fails, the
        // hosting proxy is the likely cause — warn rather than block.
        $checks[] = self::check(
            'WebSocket upgrade',
            $handshake ? 'warn' : 'warn',
            $handshake
                ? 'Polling works. WebSocket upgrades depend on the host proxy; if realtime falls back to polling, ask the host to enable WebSocket support for the API subdomain.'
                : 'Not tested because the polling handshake failed.',
            'No action unless realtime updates fail in the browser.'
        );

        // ------------------------------------------------------------ database --
        if ($db !== []) {
            try {
                $pdo = Database::connect($db);
                $tables = Database::tables($pdo);
                $required = Database::REQUIRED_TABLES;
                $missingTables = array_values(array_diff($required, $tables));
                $checks[] = self::check(
                    'Database tables',
                    $missingTables === [] ? 'pass' : 'fail',
                    $missingTables === []
                        ? count($tables) . ' table(s) present; all required tables exist'
                        : 'Missing table(s): ' . implode(', ', $missingTables),
                    'Re-run step 8 to provision the missing tables.'
                );

                $count = 0;
                try {
                    $stmt = $pdo->query('SELECT COUNT(*) FROM users');
                    $count = (int) $stmt->fetchColumn();
                } catch (\Throwable $e) {
                    $count = 0;
                }
                $adminEmail = (string) ($admin['email'] ?? '');
                $hasAdmin = false;
                if ($adminEmail !== '') {
                    try {
                        $stmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE email = ?');
                        $stmt->execute([$adminEmail]);
                        $hasAdmin = (int) $stmt->fetchColumn() > 0;
                    } catch (\Throwable $e) {
                        $hasAdmin = $count > 0;
                    }
                } else {
                    $hasAdmin = $count > 0;
                }
                $checks[] = self::check(
                    'Super administrator',
                    $hasAdmin ? 'pass' : 'fail',
                    $hasAdmin ? 'Administrator account exists (' . $count . ' user(s) total)' : 'No administrator account matches the address created in step 10.',
                    'Create the administrator in step 10.'
                );

                $version = 'unknown';
                try {
                    $version = (string) $pdo->query('SELECT `value` FROM app_settings WHERE `key` = "app_version" LIMIT 1')->fetchColumn();
                } catch (\Throwable $e) {
                    $version = 'unknown';
                }
                $checks[] = self::check(
                    'Schema version',
                    $version !== '' && $version !== 'unknown' ? 'pass' : 'warn',
                    $version !== '' && $version !== 'unknown' ? 'app_settings.app_version = ' . $version : 'app_version could not be read from app_settings.',
                    'Re-run step 8 if the table was imported without defaults.'
                );
            } catch (\Throwable $e) {
                $checks[] = self::check('Database connection', 'fail', Database::explain($e instanceof \PDOException ? $e : new \PDOException($e->getMessage()), $db), 'Correct the credentials in step 7 and provision again.');
            }
        }

        // ------------------------------------------------------------- storage --
        $unwritable = [];
        foreach (['storage', 'cache', 'sessions', 'temp', 'uploads', 'backups', 'logs'] as $key) {
            $dir = (string) ($paths[$key] ?? '');
            if ($dir === '' || !is_dir($dir) || !is_writable($dir)) {
                $unwritable[] = $key;
            }
        }
        $checks[] = self::check(
            'Storage writability',
            $unwritable === [] ? 'pass' : 'fail',
            $unwritable === [] ? 'Cache, sessions, temp, uploads, backups and logs are writable' : 'Not writable: ' . implode(', ', $unwritable),
            'Set the affected folders to 700 (or 750 on hosts that require group access).'
        );

        // ---------------------------------------------------- private config --
        $configDir = (string) ($paths['config'] ?? '');
        $publicEnv = rtrim((string) ($paths['frontend'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . '.env';
        $checks[] = self::check(
            'Private configuration',
            !is_file($publicEnv) && $configDir !== '' && is_file($configDir . DIRECTORY_SEPARATOR . '.env') ? 'pass' : 'fail',
            is_file($publicEnv)
                ? 'A .env file exists inside public_html/rmudts — remove it immediately.'
                : 'No .env in the frontend folder; the only environment file is ' . Support::path($configDir . DIRECTORY_SEPARATOR . '.env'),
            'Secrets belong only in rmudts-config/.env (mode 0600).'
        );

        $envProbe = self::http($frontend . '.env');
        $checks[] = self::check(
            'No secret over HTTP',
            in_array($envProbe['status'], [403, 404], true) ? 'pass' : 'fail',
            in_array($envProbe['status'], [403, 404], true)
                ? 'GET ' . $frontend . '.env returns HTTP ' . $envProbe['status']
                : 'GET ' . $frontend . '.env returned HTTP ' . ($envProbe['status'] ?: 'no response') . ' — the web server may be exposing dotfiles.',
            'Add the dotfile denial to the frontend .htaccess.'
        );

        $summary = ['pass' => 0, 'warn' => 0, 'fail' => 0];
        foreach ($checks as $check) {
            $summary[$check['level']]++;
        }
        $critical = array_filter($checks, static fn(array $c): bool => $c['level'] === 'fail' && !empty($c['critical']));
        return ['ok' => $critical === [], 'checks' => $checks, 'summary' => $summary];
    }

    /** @return array{label:string,level:string,note:string,action:string,critical:bool} */
    private static function check(string $label, string $level, string $note, string $action = '', bool $critical = true): array
    {
        return ['label' => $label, 'level' => $level, 'note' => $note, 'action' => $action, 'critical' => $critical];
    }

    private static function schemeCheck(string $label, string $url): array
    {
        $https = str_starts_with($url, 'https://');
        return self::check(
            $label . ' uses HTTPS',
            $https ? 'pass' : 'warn',
            $https ? $url : $url . ' is not HTTPS. Browsers block mixed content, so the frontend will not reach it.',
            'Use https:// for both the frontend and the API.',
            false
        );
    }

    /**
     * @return array{status:int,body:string,content_type:string,error:string}
     */
    private static function http(string $url, int $timeout = 12): array
    {
        $result = ['status' => 0, 'body' => '', 'content_type' => '', 'error' => ''];
        if (!filter_var($url, FILTER_VALIDATE_URL)) {
            $result['error'] = 'Invalid URL';
            return $result;
        }
        if (!function_exists('curl_init')) {
            $result['error'] = 'cURL is unavailable in PHP';
            return $result;
        }
        $ch = curl_init($url);
        if ($ch === false) {
            $result['error'] = 'cURL could not start';
            return $result;
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT      => 'RMUDTS-Installer/' . Installer::VERSION,
            CURLOPT_HTTPHEADER     => ['Accept: application/json, text/html, */*'],
        ]);
        $body = curl_exec($ch);
        $error = curl_error($ch);
        $result['status'] = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $result['content_type'] = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $result['body'] = is_string($body) ? substr($body, 0, 200000) : '';
        $result['error'] = $error !== '' ? $error : '';
        curl_close($ch);
        return $result;
    }

    private static function absolute(string $base, string $ref): string
    {
        if (preg_match('#^https?://#i', $ref)) {
            return $ref;
        }
        $parts = parse_url($base) ?: [];
        $origin = isset($parts['scheme'], $parts['host'])
            ? $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '')
            : rtrim($base, '/');
        if (str_starts_with($ref, '/')) {
            return $origin . $ref;
        }
        return rtrim($base, '/') . '/' . ltrim($ref, '/');
    }
}

<?php
/**
 * RMUDTS Installer — Requirements
 * ---------------------------------------------------------------------------
 * Everything step 2 asserts about the host: PHP version and extensions,
 * Node.js/npm availability, write permissions, disk space and package
 * integrity. Nothing here changes the system, so it is safe to run at any time.
 *
 * A check is a small array so the view layer can render it without knowing
 * anything about what was checked:
 *   ['label' => string, 'level' => 'pass'|'warn'|'fail', 'note' => string,
 *    'critical' => bool]
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Requirements
{
    public const MIN_PHP = '8.1.0';
    public const MIN_NODE = 20;
    public const MIN_FREE_BYTES = 209715200; // 200 MB

    /** PHP extension => [required?, why] */
    private const EXTENSIONS = [
        'pdo'        => [true,  'Database access layer used by the installer'],
        'pdo_mysql'  => [true,  'MySQL driver — required to provision the database'],
        'json'       => [true,  'Configuration and state files'],
        'session'    => [true,  'Installer keeps the wizard state between steps'],
        'openssl'    => [true,  'Cryptographically secure key generation'],
        'mbstring'   => [true,  'UTF-8 handling of administrator names and paths'],
        'fileinfo'   => [true,  'Upload type detection at runtime'],
        'zip'        => [true,  'Package inspection and backup archives'],
        'curl'       => [true,  'HTTPS service verification (API, Socket.IO)'],
        'filter'     => [true,  'URL and email validation'],
        'posix'      => [false, 'Report the web-server user in diagnostics'],
    ];

    /**
     * @return array<int,array{group:string,checks:array<int,array<string,mixed>>}>
     */
    public static function all(array $paths): array
    {
        return [
            ['group' => 'PHP platform',  'checks' => self::php()],
            ['group' => 'PHP extensions', 'checks' => self::extensions()],
            ['group' => 'Node.js runtime', 'checks' => self::node()],
            ['group' => 'File permissions', 'checks' => self::permissions($paths)],
            ['group' => 'Package integrity', 'checks' => self::package()],
        ];
    }

    private static function check(string $label, string $level, string $note, bool $critical = false): array
    {
        return ['label' => $label, 'level' => $level, 'note' => $note, 'critical' => $critical];
    }

    public static function php(): array
    {
        $checks = [];
        $version = PHP_VERSION;
        $checks[] = version_compare($version, self::MIN_PHP, '>=')
            ? self::check('PHP ' . self::MIN_PHP . ' or newer', 'pass', 'Running PHP ' . $version, false)
            : self::check('PHP ' . self::MIN_PHP . ' or newer', 'fail', 'Running PHP ' . $version . ' — ask your host to select PHP 8.1+ in cPanel → MultiPHP Manager', true);

        if (version_compare($version, '8.3.0', '>=')) {
            $checks[] = self::check('PHP version maturity', 'pass', 'PHP 8.3+ has full support for every feature RMUDTS uses', false);
        } elseif (version_compare($version, '8.1.0', '>=')) {
            $checks[] = self::check('PHP version maturity', 'warn', 'PHP 8.1/8.2 works, but 8.3 or 8.4 is recommended', false);
        }

        $sapi = PHP_SAPI;
        $checks[] = self::check(
            'Web server API',
            in_array($sapi, ['apache2handler', 'litespeed', 'fpm-fcgi', 'cgi-fcgi', 'cli-server'], true) ? 'pass' : 'warn',
            'PHP is running as ' . $sapi,
            false
        );
        $checks[] = self::check(
            'Shell execution',
            Support::shellEnabled() ? 'pass' : 'warn',
            Support::shellEnabled()
                ? 'proc_open/exec available — the installer can run npm install for you'
                : 'disable_functions blocks shell commands — you will run npm install from cPanel → Terminal / Setup Node.js App',
            false
        );
        $checks[] = self::check(
            'Installer session storage',
            session_status() !== PHP_SESSION_DISABLED ? 'pass' : 'fail',
            session_status() !== PHP_SESSION_DISABLED
                ? 'session.save_path: ' . (string) (ini_get('session.save_path') ?: 'default')
                : 'PHP sessions are disabled, the multi-step wizard cannot remember your input',
            true
        );
        $checks[] = self::check(
            'Secure random bytes',
            Security::hasSecureRandom() ? 'pass' : 'fail',
            Security::hasSecureRandom()
                ? 'random_bytes() is available — secrets can be generated safely'
                : 'random_bytes() failed — secrets cannot be generated on this host',
            true
        );
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        $checks[] = self::check(
            'HTTPS enabled',
            $https ? 'pass' : 'warn',
            $https
                ? 'The wizard is running over HTTPS'
                : 'This page is not using HTTPS. Install over https:// so passwords and the installation token are never sent in clear text.',
            false
        );
        return $checks;
    }

    public static function extensions(): array
    {
        $checks = [];
        foreach (self::EXTENSIONS as $ext => [$required, $why]) {
            $loaded = extension_loaded($ext);
            if ($loaded) {
                $checks[] = self::check('ext-' . $ext, 'pass', $why, $required);
            } else {
                $checks[] = self::check(
                    'ext-' . $ext,
                    $required ? 'fail' : 'warn',
                    $why . ' — enable it in cPanel → Select PHP Version → Extensions',
                    $required
                );
            }
        }
        return $checks;
    }

    public static function node(): array
    {
        $checks = [];
        $node = Support::which('node');
        $npm = Support::which('npm');

        if ($node === null) {
            $checks[] = self::check('Node.js installed', 'warn', 'No node executable found in PATH. Register the application in cPanel → Setup Node.js App (Node.js 20 LTS) — the installer prepares the code, cPanel runs it.', false);
        } else {
            $version = self::execVersion($node, '-v');
            $ok = $version !== null && version_compare(ltrim($version, 'v'), (string) self::MIN_NODE, '>=');
            $checks[] = $ok
                ? self::check('Node.js ' . self::MIN_NODE . '+', 'pass', 'node ' . $version . ' (' . Support::path($node) . ')', true)
                : self::check(
                    'Node.js ' . self::MIN_NODE . '+',
                    'warn',
                    'node ' . ($version ?: 'unknown version') . ' found — select Node.js 20 LTS (or newer) in cPanel → Setup Node.js App',
                    false
                );
        }

        if ($npm === null) {
            $checks[] = self::check('npm installed', 'warn', 'npm was not found in PATH — install production dependencies manually in the backend folder.', false);
        } else {
            $checks[] = self::check('npm installed', 'pass', 'npm ' . (self::execVersion($npm, '-v') ?: 'unknown') . ' (' . Support::path($npm) . ')', false);
        }

        if (DIRECTORY_SEPARATOR === '\\') {
            $checks[] = self::check('Hosting check', 'warn', 'This installer is running on Windows. Production deployments target cPanel/Linux hosting.', false);
        }
        return $checks;
    }

    public static function permissions(array $paths): array
    {
        $checks = [];

        $installDir = Paths::installDir();
        $checks[] = Support::isWritable($installDir)
            ? self::check('install/ is writable', 'pass', 'Required write test passed (installed.lock, state file)', true)
            : self::check('install/ is writable', 'fail', 'Cannot write to ' . Support::path($installDir) . ' — set the folder permission to 755 (or 775) before continuing', true);

        $publicRoot = (string) ($paths['public_root'] ?? Paths::packageRoot());
        $checks[] = Support::isWritable($publicRoot)
            ? self::check('Web root is writable', 'pass', 'Frontend files can be published into ' . Support::path((string) ($paths['frontend'] ?? $publicRoot . '/rmudts')), true)
            : self::check('Web root is writable', 'fail', 'Cannot write to ' . Support::path($publicRoot) . ' — check ownership/permissions of public_html', true);

        foreach (Paths::MUST_BE_PRIVATE as $key) {
            $path = (string) ($paths[$key] ?? '');
            if ($path === '') {
                continue;
            }
            $result = Paths::validate($key, $path, $paths);
            $checks[] = self::check(
                (Paths::KEYS[$key] ?? $key) . ' (private)',
                $result['level'],
                $result['message'],
                $result['level'] === 'fail'
            );
        }

        $free = Paths::freeSpace($publicRoot);
        if ($free === null) {
            $checks[] = self::check('Free disk space', 'warn', 'Could not read free space for ' . Support::path($publicRoot), false);
        } else {
            $checks[] = $free >= self::MIN_FREE_BYTES
                ? self::check('Free disk space', 'pass', Support::bytes($free) . ' available', false)
                : self::check('Free disk space', 'warn', 'Only ' . Support::bytes($free) . ' available — 200 MB or more is recommended', false);
        }
        return $checks;
    }

    public static function package(): array
    {
        $checks = [];
        $client = Paths::clientSource();
        $checks[] = $client !== null
            ? self::check('Frontend build', 'pass', 'Compiled React build found at ' . Support::path($client), true)
            : self::check('Frontend build', 'fail', 'client/index.html is missing — rebuild the client (npm run build) and repackage.', true);

        $server = Paths::serverSource();
        $checks[] = is_file($server . DIRECTORY_SEPARATOR . 'server.js')
            ? self::check('Backend startup file', 'pass', 'Express entry point found (server/server.js)', true)
            : self::check('Backend startup file', 'fail', 'server/server.js is missing — cPanel cannot start the application', true);

        $checks[] = is_file($server . DIRECTORY_SEPARATOR . 'package.json')
            ? self::check('Backend manifest', 'pass', 'server/package.json present', true)
            : self::check('Backend manifest', 'fail', 'server/package.json is missing — dependencies cannot be installed', true);

        $schema = Paths::schemaFile();
        $checks[] = is_file($schema)
            ? self::check('Database schema', 'pass', Support::bytes((int) filesize($schema)) . ' of schema.sql (' . self::countCreateTables($schema) . ' tables)', true)
            : self::check('Database schema', 'fail', 'database/schema.sql is missing from the package', true);

        $checks[] = is_file(Paths::defaultDataFile())
            ? self::check('Default data', 'pass', 'database/default-data.sql present', false)
            : self::check('Default data', 'warn', 'database/default-data.sql is missing — the schema will be imported without default records.', false);

        foreach (['backend.env.example', 'frontend.env.production.example', 'frontend.htaccess', 'cpanel-node-setup.txt'] as $template) {
            $file = Paths::templatesDir() . DIRECTORY_SEPARATOR . $template;
            $checks[] = is_file($file)
                ? self::check('Template /' . $template, 'pass', 'Present', false)
                : self::check('Template /' . $template, 'warn', 'Missing from the package — the installer generates an equivalent file itself.', false);
        }

        $checks[] = is_dir(Paths::migrationsDir())
            ? self::check('Migration folder', 'pass', 'database/migrations present', false)
            : self::check('Migration folder', 'warn', 'database/migrations is missing — no data migrations can run.', false);

        $writable = Support::isWritable(Paths::packageRoot() . DIRECTORY_SEPARATOR . 'install');
        if (!$writable) {
            $checks[] = self::check('Installer self-update', 'warn', 'install/ is read-only; the lock file will be written to the configuration folder instead.', false);
        }
        return $checks;
    }

    private static function countCreateTables(string $file): int
    {
        $sql = (string) @file_get_contents($file);
        return (int) preg_match_all('/CREATE TABLE/i', $sql);
    }

    private static function execVersion(string $binary, string $flag): ?string
    {
        [$code, $out] = Support::run(escapeshellarg($binary) . ' ' . $flag, 20);
        if ($out === '') {
            return null;
        }
        if (preg_match('/v?\d+(\.\d+){0,2}/', $out, $m)) {
            return $m[0];
        }
        return null;
    }

    /** @param array<int,array{group:string,checks:array<int,array<string,mixed>>}> $groups */
    public static function summarise(array $groups): array
    {
        $counts = ['pass' => 0, 'warn' => 0, 'fail' => 0];
        $blocking = [];
        foreach ($groups as $group) {
            foreach ($group['checks'] as $check) {
                $counts[$check['level']] = ($counts[$check['level']] ?? 0) + 1;
                if ($check['level'] === 'fail' && $check['critical']) {
                    $blocking[] = $check['label'] . ' — ' . $check['note'];
                }
            }
        }
        return ['counts' => $counts, 'blocking' => $blocking, 'ok' => $blocking === []];
    }
}

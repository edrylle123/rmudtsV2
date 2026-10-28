<?php
/**
 * RMUDTS Installer — Upgrader
 * ---------------------------------------------------------------------------
 * Upgrade and repair for a copy that is **already installed**.
 *
 * The wizard is deliberately one-shot: once installed.lock exists the ten-step
 * flow is disabled, because re-running it would replace the administrator
 * account and rewrite configuration from scratch. Updating a live copy is a
 * different job, so it lives here and in install/upgrade.php:
 *
 *   inspect    read the installed record (lock, config.php, .env, live schema)
 *   back up    full data dump of every table, rows included, before touching
 *              anything (the safety net; an upgrade refuses to start without it)
 *   repair     recreate missing storage folders, protection files and
 *              permissions
 *   migrate    converge the live schema onto the shipped schema.sql (missing
 *              tables, columns and indexes only — nothing is dropped) and run
 *              the ordered data migrations from Migrations
 *   update     copy the new backend out of the package, publish the new
 *              frontend and rebuild the front controller
 *   configure  regenerate .env and config.php from the values that are already
 *              there, preserving every key and secret — sessions and stored
 *              uploads keep working
 *   verify     prove accounts, records and every table kept at least as many
 *              rows as before, then stamp the new version into the lock
 *
 * Nothing in this class ever DROPs, TRUNCATEs or DELETEs application data, and
 * no step creates or replaces a user account.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

use PDO;
use PDOException;

final class Upgrader
{
    /** File the administrator pastes from the private config folder to unlock. */
    public const KEY_FILENAME = 'upgrade.key';

    /** Session slot that remembers an unlocked upgrade for a while. */
    public const SESSION_KEY = 'rmudts_upgrade_auth';

    /** Failed-key counter, kept on disk so a new session cannot reset it. */
    public const ATTEMPTS_FILENAME = '.upgrade-attempts.json';

    public const MAX_ATTEMPTS = 5;
    public const ATTEMPT_WINDOW = 900;   // seconds a failed attempt counts for
    public const SESSION_TTL = 1800;     // seconds an unlocked session lasts

    // ------------------------------------------------------------- inspect ---

    /**
     * Read everything the upgrade needs from the installed copy.
     *
     * Sources, in order of trust: config.php (paths, app, database), .env (the
     * database password and the generated secrets), the lock file (version and
     * install date), storage.json (paths), then the recommended defaults.
     *
     * @return array<string,mixed>
     */
    public static function context(): array
    {
        $paths = self::detectPaths();
        $sources = [];
        $warnings = [];

        $configFile = rtrim((string) ($paths['config'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'config.php';
        $config = self::readConfig($configFile);
        if ($config !== []) {
            $sources[] = 'config.php';
            foreach (['public_root', 'app_root', 'config', 'data', 'tmp', 'cache', 'logs', 'uploads', 'backups', 'restore'] as $key) {
                $value = (string) ($config['paths'][$key] ?? '');
                if ($value !== '') {
                    $paths[$key] = $value;
                }
            }
        } else {
            $warnings[] = 'config.php could not be read — paths come from storage.json and the recommended layout.';
        }

        $storageFile = rtrim((string) ($paths['config'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'storage.json';
        $storage = Support::readJson($storageFile);
        foreach (['public_root', 'app_root', 'config', 'data', 'tmp', 'cache', 'logs', 'uploads', 'backups', 'restore'] as $key) {
            if ($config === [] && !empty($storage['paths'][$key])) {
                $paths[$key] = (string) $storage['paths'][$key];
            }
        }
        if ($storage !== []) {
            $sources[] = 'storage.json';
        }

        $envFile = (string) ($paths['config'] ?? '') . DIRECTORY_SEPARATOR . '.env';
        $env = self::readEnv($envFile);
        if ($env !== []) {
            $sources[] = '.env';
        } else {
            $env = self::readEnv(rtrim((string) ($paths['app_root'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . '.env');
            if ($env !== []) {
                $sources[] = 'app_root/.env';
            } else {
                $warnings[] = 'No .env was found — the database password has to be entered by hand below.';
            }
        }
        if (empty($env['DB_PASS'])) {
            $warnings[] = 'The .env file holds no database password (DB_PASS is empty).';
        }

        $app = (array) ($config['app'] ?? []);
        if ($app === []) {
            $app = [
                'name'       => (string) ($env['APP_NAME'] ?? 'RMUDTS'),
                'url'        => (string) ($env['APP_URL'] ?? ''),
                'env'        => (string) ($env['APP_ENV'] ?? 'production'),
                'timezone'   => (string) ($env['TZ'] ?? 'Asia/Manila'),
                'system_email' => (string) ($env['SYSTEM_EMAIL'] ?? ''),
            ];
        }

        $db = [
            'host' => (string) ($config['database']['host'] ?? ($env['DB_HOST'] ?? 'localhost')) ?: 'localhost',
            'port' => (string) (int) ($config['database']['port'] ?? ($env['DB_PORT'] ?? 3306)),
            'name' => (string) ($config['database']['name'] ?? ($env['DB_NAME'] ?? '')),
            'user' => (string) ($config['database']['user'] ?? ($env['DB_USER'] ?? '')),
            'pass' => (string) ($env['DB_PASS'] ?? ''),
        ];

        $port = (int) ($config['backend']['port'] ?? ($env['PORT'] ?? Installer::DEFAULT_PORT));
        if ($port < 1 || $port > 65535) {
            $port = Installer::DEFAULT_PORT;
        }

        $secrets = [
            'app_key'              => (string) ($env['APP_KEY'] ?? ''),
            'encryption_key'       => (string) ($env['ENCRYPTION_KEY'] ?? ''),
            'jwt_secret'           => (string) ($env['JWT_SECRET'] ?? ''),
            'refresh_token_secret' => (string) ($env['REFRESH_TOKEN_SECRET'] ?? ''),
            'api_token'            => (string) ($env['API_TOKEN'] ?? ''),
            'csrf_secret'          => (string) ($env['CSRF_SECRET'] ?? ''),
        ];

        $lock = Lock::read();
        $installedVersion = (string) ($lock['version'] ?? ($config['version'] ?? ''));

        return [
            'paths'             => $paths,
            'app'               => $app,
            'db'                => $db,
            'secrets'           => $secrets,
            'env'               => $env,
            'port'              => $port,
            'lock'              => $lock,
            'installed_version' => $installedVersion,
            'installed_at'      => (string) ($lock['installed_at'] ?? ($config['installed_at'] ?? '')),
            'config_file'       => is_file($configFile) ? $configFile : null,
            'env_file'          => is_file($envFile) ? $envFile : null,
            'sources'           => $sources,
            'warnings'          => $warnings,
        ];
    }

    /**
     * The configuration folder, wherever this copy actually put it.
     *
     * @return array<string,string>
     */
    public static function detectPaths(): array
    {
        $paths = Paths::defaults();
        $candidates = [rtrim((string) $paths['config'], '/\\')];
        $account = dirname(rtrim((string) $paths['public_root'], '/\\'));
        $public = rtrim((string) $paths['public_root'], '/\\');

        // A custom layout is found through the generated config.php or
        // storage.json; never look inside the web root.
        foreach ((array) @glob($account . '/*/config.php') as $file) {
            $dir = dirname((string) $file);
            if (Paths::isInside($dir, $public)) {
                continue;
            }
            $candidates[] = $dir;
            if (count($candidates) > 20) {
                break;
            }
        }
        foreach ((array) @glob($account . '/*/storage.json') as $file) {
            $dir = dirname((string) $file);
            if (Paths::isInside($dir, $public)) {
                continue;
            }
            $candidates[] = $dir;
            if (count($candidates) > 40) {
                break;
            }
        }

        foreach (array_unique($candidates) as $dir) {
            if (is_file($dir . DIRECTORY_SEPARATOR . 'config.php')
                || is_file($dir . DIRECTORY_SEPARATOR . 'storage.json')
                || is_file($dir . DIRECTORY_SEPARATOR . 'installed.lock')) {
                $paths['config'] = $dir;
                return $paths;
            }
        }
        return $paths;
    }

    /** @return array<string,mixed> */
    private static function readConfig(string $file): array
    {
        if (!is_file($file) || !is_readable($file)) {
            return [];
        }
        try {
            $data = (static function (string $path) {
                return include $path;
            })($file);
        } catch (\Throwable $e) {
            return [];
        }
        return is_array($data) ? $data : [];
    }

    /**
     * Parse a generated .env without pulling in dotenv.
     *
     * @return array<string,string>
     */
    public static function readEnv(string $file): array
    {
        $out = [];
        if (!is_file($file) || !is_readable($file)) {
            return $out;
        }
        foreach ((array) file($file, FILE_IGNORE_NEW_LINES) as $line) {
            $line = trim((string) $line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value);
            if ($value !== '' && ($value[0] === '"' || $value[0] === "'")) {
                $quote = $value[0];
                $value = substr($value, 1);
                if (str_ends_with($value, $quote)) {
                    $value = substr($value, 0, -1);
                }
                if ($quote === '"') {
                    $value = str_replace(['\\n', '\\r', '\\"'], ["\n", '', '"'], $value);
                }
            }
            if ($key !== '') {
                $out[$key] = $value;
            }
        }
        return $out;
    }

    /**
     * Where this copy stands relative to the package.
     *
     * @return array{installed:string,package:string,state:string}
     */
    public static function versionState(array $ctx): array
    {
        $installed = (string) ($ctx['installed_version'] ?? '');
        $package = Installer::VERSION;
        $compare = $installed === '' ? 1 : version_compare($package, $installed);
        return [
            'installed' => $installed,
            'package'   => $package,
            'state'     => $compare > 0 ? 'newer' : ($compare < 0 ? 'older' : 'same'),
        ];
    }

    // ------------------------------------------------------------- access ----

    public static function keyFile(array $paths): string
    {
        $config = rtrim((string) ($paths['config'] ?? ''), '/\\');
        if ($config === '') {
            $config = Paths::installDir();
        }
        return $config . DIRECTORY_SEPARATOR . self::KEY_FILENAME;
    }

    /**
     * Make sure an upgrade key exists and hand it back so the page can show its
     * location (never the value) the first time it is created.
     *
     * @return array{path:string,created:bool,key:string}
     */
    public static function ensureKey(array $paths): array
    {
        $file = self::keyFile($paths);
        if (is_file($file)) {
            $existing = trim((string) @file_get_contents($file));
            if (strlen($existing) >= 32) {
                return ['path' => $file, 'created' => false, 'key' => $existing];
            }
        }
        $key = Security::hexKey(24);            // 48 hex characters
        $written = Support::writeFile($file, $key . "\n", 0600);
        if ($written) {
            @chmod($file, 0600);
        }
        return ['path' => $file, 'created' => $written, 'key' => $written ? $key : ''];
    }

    /** Session unlocked, still inside its lifetime, and the key has not changed? */
    public static function authorised(array $paths): bool
    {
        $state = $_SESSION[self::SESSION_KEY] ?? null;
        if (!is_array($state) || empty($state['at']) || empty($state['fingerprint'])) {
            return false;
        }
        if (time() - (int) $state['at'] > self::SESSION_TTL) {
            unset($_SESSION[self::SESSION_KEY]);
            return false;
        }
        $file = self::keyFile($paths);
        $current = is_file($file) ? trim((string) @file_get_contents($file)) : '';
        if ($current === '') {
            return false;
        }
        return hash_equals((string) $state['fingerprint'], self::fingerprint($current));
    }

    /**
     * @return array{ok:bool,message:string}
     */
    public static function authorise(string $submitted, array $paths): array
    {
        $key = trim($submitted);
        $state = self::attempts($paths);
        if ($state['count'] >= self::MAX_ATTEMPTS) {
            $wait = max(1, (int) ceil((self::ATTEMPT_WINDOW - (time() - $state['first'])) / 60));
            return ['ok' => false, 'message' => 'Too many failed attempts. Try again in ' . $wait . ' minute(s).'];
        }

        $file = self::keyFile($paths);
        $current = is_file($file) ? trim((string) @file_get_contents($file)) : '';
        if ($current === '') {
            return ['ok' => false, 'message' => 'No upgrade key exists yet. Reload this page to create one, then open it in cPanel → File Manager.'];
        }
        if ($key === '' || !hash_equals($current, $key)) {
            self::recordFailure($paths);
            usleep(400000);
            return ['ok' => false, 'message' => 'That key does not match the one in ' . Support::path($file) . '.'];
        }

        self::clearFailures($paths);
        $_SESSION[self::SESSION_KEY] = ['at' => time(), 'fingerprint' => self::fingerprint($current)];
        return ['ok' => true, 'message' => 'Upgrade mode unlocked for this browser session.'];
    }

    public static function revoke(): void
    {
        unset($_SESSION[self::SESSION_KEY]);
    }

    private static function fingerprint(string $key): string
    {
        return hash('sha256', $key);
    }

    /** @return array{count:int,first:int,last:int} */
    public static function attempts(array $paths): array
    {
        $file = Paths::installDir() . DIRECTORY_SEPARATOR . self::ATTEMPTS_FILENAME;
        $data = Support::readJson($file);
        $count = (int) ($data['count'] ?? 0);
        $first = (int) ($data['first'] ?? 0);
        if ($count > 0 && (time() - $first) > self::ATTEMPT_WINDOW) {
            $count = 0;
            $first = 0;
        }
        return ['count' => $count, 'first' => $first, 'last' => (int) ($data['last'] ?? 0)];
    }

    private static function recordFailure(array $paths): void
    {
        $file = Paths::installDir() . DIRECTORY_SEPARATOR . self::ATTEMPTS_FILENAME;
        $state = self::attempts($paths);
        $now = time();
        Support::writeJson($file, [
            'count' => $state['count'] + 1,
            'first' => $state['count'] === 0 ? $now : $state['first'],
            'last'  => $now,
        ]);
    }

    private static function clearFailures(array $paths): void
    {
        $file = Paths::installDir() . DIRECTORY_SEPARATOR . self::ATTEMPTS_FILENAME;
        if (is_file($file)) {
            @unlink($file);
        }
    }

    // -------------------------------------------------------------- plan ----

    /**
     * The preflight table: what is installed, what the package brings, and what
     * is currently broken. Read-only — safe to render on every page load.
     *
     * @return array<int,array{label:string,level:string,note:string}>
     */
    public static function plan(array $ctx): array
    {
        $rows = [];
        $paths = $ctx['paths'];
        $version = self::versionState($ctx);

        $installedWhen = (string) ($ctx['installed_at'] ?? '');
        $rows[] = [
            'label' => 'Installed copy',
            'level' => $version['installed'] !== '' ? 'pass' : 'warn',
            'note'  => $version['installed'] !== ''
                ? 'v' . $version['installed'] . ($installedWhen !== '' ? ' — installed ' . (date('j M Y H:i', strtotime($installedWhen) ?: time())) : '')
                : 'The lock file records no version.',
        ];
        $rows[] = [
            'label' => 'Package',
            'level' => $version['state'] === 'newer' ? 'pass' : 'info',
            'note'  => 'v' . $version['package'] . match ($version['state']) {
                'newer' => ' — newer than the installed copy, this is a real upgrade.',
                'same'  => ' — same version as the installed copy, so this is a repair.',
                default => ' — older than the installed copy. Upgrading to an older release is not supported.',
            },
        ];

        $rows[] = [
            'label' => 'config.php',
            'level' => $ctx['config_file'] !== null ? 'pass' : 'fail',
            'note'  => $ctx['config_file'] !== null
                ? Support::path((string) $ctx['config_file'])
                : 'Missing or unreadable — it will be rebuilt from the values below.',
        ];
        $rows[] = [
            'label' => '.env',
            'level' => $ctx['env_file'] !== null ? (($ctx['db']['pass'] ?? '') !== '' ? 'pass' : 'warn') : 'fail',
            'note'  => $ctx['env_file'] !== null
                ? Support::path((string) $ctx['env_file']) . (($ctx['db']['pass'] ?? '') === '' ? ' — no database password stored' : '')
                : 'Missing — every secret has to be re-entered, or restore the file from the configuration folder backup.',
        ];

        // Database + live schema ------------------------------------------------
        $db = $ctx['db'];
        if (($db['name'] ?? '') !== '' && ($db['user'] ?? '') !== '') {
            try {
                $pdo = Database::pdo($db);
                $serverVersion = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
                $tables = Database::tables($pdo);
                $rows[] = [
                    'label' => 'Database',
                    'level' => 'pass',
                    'note'  => 'Connected to `' . $db['name'] . '` on ' . $db['host'] . ':' . $db['port'] . ' (MySQL ' . $serverVersion . ') — ' . count($tables) . ' table(s).',
                ];
                $diff = Database::schemaDiff(Paths::schemaFile(), $db);
                $drift = count($diff['tables']) + count($diff['columns']) + count($diff['keys']);
                $rows[] = [
                    'label' => 'Schema',
                    'level' => $drift === 0 ? 'pass' : ($diff['tables'] === [] ? 'warn' : 'fail'),
                    'note'  => $drift === 0
                        ? 'Matches the shipped schema.sql — no structure changes needed.'
                        : $drift . ' object(s) missing: '
                            . implode(', ', array_merge(
                                array_map(static fn(string $t): string => 'table ' . $t, $diff['tables']),
                                array_map(static fn(array $c): string => $c['table'] . '.' . $c['name'], $diff['columns']),
                                array_map(static fn(array $k): string => $k['table'] . '.' . $k['name'], $diff['keys'])
                            )) . '. They will be added; nothing is dropped.',
                ];
                $counts = Database::tableCounts($db);
                $successors = 0;
                try {
                    $successors = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")->fetchColumn();
                } catch (PDOException $e) {
                    $successors = 0;
                }
                $rows[] = [
                    'label' => 'Accounts and records',
                    'level' => $successors > 0 ? 'pass' : 'warn',
                    'note'  => (int) ($counts['users'] ?? 0) . ' account(s) (' . $successors . ' super administrator), '
                        . (int) ($counts['records'] ?? 0) . ' record(s), ' . (int) ($counts['record_files'] ?? 0) . ' file(s). These are never modified by an upgrade.',
                ];
            } catch (PDOException $e) {
                $rows[] = ['label' => 'Database', 'level' => 'fail', 'note' => Database::explain($e, $db)];
                $rows[] = ['label' => 'Schema', 'level' => 'fail', 'note' => 'Cannot be inspected until the connection works. An upgrade will not start without a backup.'];
            }
        } else {
            $rows[] = ['label' => 'Database', 'level' => 'fail', 'note' => 'No database name or user was found in config.php / .env. Enter the password below if only the password is missing.'];
        }

        // Application files -----------------------------------------------------
        $appRoot = rtrim((string) $paths['app_root'], '/\\');
        $rows[] = [
            'label' => 'Backend',
            'level' => is_file($appRoot . DIRECTORY_SEPARATOR . 'server.js') ? 'pass' : 'warn',
            'note'  => is_file($appRoot . DIRECTORY_SEPARATOR . 'server.js')
                ? Support::path($appRoot) . ' (server.js present' . (is_dir($appRoot . DIRECTORY_SEPARATOR . 'node_modules') ? ', node_modules ready)' : ', node_modules missing)')
                : 'server.js is missing from ' . Support::path($appRoot) . ' — the code step will copy it back.',
        ];
        $client = Paths::clientSource();
        $rows[] = [
            'label' => 'Frontend (package)',
            'level' => $client !== null ? 'pass' : 'warn',
            'note'  => $client !== null ? 'Found in the package at ' . Support::path($client) . '.' : 'No built frontend in the package — existing files in the web root are left as they are.',
        ];
        $front = rtrim((string) $paths['public_root'], '/\\') . DIRECTORY_SEPARATOR . 'index.php';
        $rows[] = [
            'label' => 'Front controller',
            'level' => is_file($front) ? 'pass' : 'warn',
            'note'  => is_file($front) ? Support::path($front) . ' present.' : 'index.php is missing from the web root — the code step writes it again.',
        ];

        $free = Paths::freeSpace((string) $paths['backups']);
        if ($free !== null) {
            $rows[] = [
                'label' => 'Backup space',
                'level' => $free > 50 * 1024 * 1024 ? 'pass' : 'warn',
                'note'  => Support::bytes($free) . ' free in ' . Support::path((string) $paths['backups']) . '. A full data backup is written there before anything changes.',
            ];
        }

        foreach ((array) $ctx['warnings'] as $warning) {
            $rows[] = ['label' => 'Notice', 'level' => 'warn', 'note' => (string) $warning];
        }

        return $rows;
    }

    // --------------------------------------------------------------- run ----

    /**
     * Execute the upgrade or repair.
     *
     * @param array<string,mixed> $ctx      from context()
     * @param array<string,mixed> $options  mode, code, deps, schema, config, password
     * @return array<string,mixed>
     */
    public static function run(array $ctx, array $options): array
    {
        $mode = ($options['mode'] ?? 'upgrade') === 'repair' ? 'repair' : 'upgrade';
        $options = [
            'mode'   => $mode,
            'code'   => array_key_exists('code', $options) ? !empty($options['code']) : true,
            'deps'   => array_key_exists('deps', $options) ? !empty($options['deps']) : true,
            'schema' => array_key_exists('schema', $options) ? !empty($options['schema']) : true,
            'config' => array_key_exists('config', $options) ? !empty($options['config']) : true,
        ];

        $paths = $ctx['paths'];
        $db = $ctx['db'];
        if (!empty($options['password'])) {
            // Only ever held in memory for this request; it is written to .env
            // by the config step and never to the state file or the report.
            $db['pass'] = (string) $options['password'];
        }

        $result = [
            'ok'          => true,
            'mode'        => $mode,
            'aborted'     => false,
            'steps'       => [],
            'log'         => [],
            'before'      => ['version' => (string) ($ctx['installed_version'] ?? ''), 'counts' => [], 'installed_at' => (string) ($ctx['installed_at'] ?? '')],
            'after'       => ['version' => Installer::VERSION, 'counts' => [], 'schema' => []],
            'backup'      => null,
            'report_path' => null,
            'report_text' => '',
            'lock_files'  => [],
            'started_at'  => date('c'),
        ];

        $emit = static function (string $level, string $message) use (&$result): void {
            $result['log'][] = ['level' => $level, 'message' => $message, 'at' => date('c')];
        };
        $step = static function (string $id, string $label, string $level, string $message, array $data = []) use (&$result, $emit): array {
            $entry = ['id' => $id, 'label' => $label, 'level' => $level, 'message' => $message, 'data' => $data];
            $result['steps'][] = $entry;
            $emit($level, $label . ': ' . $message);
            return $entry;
        };

        // 1. Guard -------------------------------------------------------------
        if (!Lock::exists()) {
            $result['ok'] = false;
            $result['aborted'] = true;
            $step('guard', 'Upgrade guard', 'fail', 'installed.lock is missing, so there is nothing to upgrade. Open /install to run the wizard instead.');
            return $result;
        }
        if (($db['name'] ?? '') === '' || ($db['user'] ?? '') === '') {
            $result['ok'] = false;
            $result['aborted'] = true;
            $step('guard', 'Upgrade guard', 'fail', 'The database name or user is unknown, so no data could be preserved. Restore config.php / .env first.');
            return $result;
        }

        // Row counts before anything happens; every later decision uses these.
        $result['before']['counts'] = Database::tableCounts($db);
        $accountsBefore = self::accountSnapshot($db);
        $emit('info', 'Starting ' . strtoupper($mode) . ' of RMUDTS v' . (string) ($ctx['installed_version'] ?? '?')
            . ' → v' . Installer::VERSION . ' (' . count($result['before']['counts']) . ' table(s) inspected).');

        // 2. Backup (mandatory) -------------------------------------------------
        $backupDir = rtrim((string) $paths['backups'], '/\\') . DIRECTORY_SEPARATOR . 'manual';
        $backupFile = $backupDir . DIRECTORY_SEPARATOR . 'pre-upgrade-' . date('Ymd-His') . '.sql';
        $backup = Database::dumpData($db, $backupFile);
        $result['backup'] = $backup['path'];
        $step('backup', 'Data backup', $backup['level'], $backup['message'], $backup);
        if ($backup['level'] === 'fail' || $backup['path'] === null) {
            $result['ok'] = false;
            $result['aborted'] = true;
            $emit('fail', 'Nothing was changed: the upgrade refuses to run without a verified backup. Fix the database connection or free disk space, then try again.');
            $result['report_text'] = self::report($ctx, $result);
            return $result;
        }

        // 3. Storage + protection (always) --------------------------------------
        try {
            $prepared = Storage::prepare($paths);
            $bad = array_values(array_filter($prepared, static fn(array $row): bool => ($row['level'] ?? '') === 'fail'));
            $protected = Storage::protect($paths);
            $hardening = Security::applyHardening($paths);
            Security::tightenPermissions($paths);
            Storage::writeManifest($paths, (string) $paths['config']);
            $step('storage', 'Storage and protection', $bad === [] ? 'pass' : 'warn',
                count($prepared) . ' location(s) checked, ' . count($protected) . ' protection file(s), ' . count($hardening) . ' hardening file(s) rewritten.'
                . ($bad === [] ? '' : ' ' . count($bad) . ' location(s) still need attention.'), ['report' => $prepared]);
            foreach ($bad as $row) {
                $emit('warn', (string) ($row['message'] ?? ''));
            }
        } catch (\Throwable $e) {
            $step('storage', 'Storage and protection', 'warn', 'Could not finish the storage repair: ' . $e->getMessage());
        }

        // 4. Schema -------------------------------------------------------------
        if ($options['schema']) {
            try {
                $pdo = Database::pdo($db);
                if (!Migrations::ensureLedger($pdo)) {
                    $emit('warn', 'The migration ledger could not be created; structure convergence continues.');
                }
                $converged = Database::converge(Paths::schemaFile(), $db);
                $added = count($converged['created_tables']) + count($converged['added_columns']) + count($converged['added_indexes']);
                $level = $converged['failed'] === [] ? 'pass' : 'warn';
                $step('schema', 'Schema migration', $level,
                    $added === 0
                        ? 'Schema already matches v' . Installer::VERSION . ' — nothing to add.'
                        : $added . ' object(s) added: '
                            . implode(', ', array_merge(
                                array_map(static fn(string $t): string => 'table ' . $t, $converged['created_tables']),
                                array_map(static fn(string $c): string => 'column ' . $c, $converged['added_columns']),
                                array_map(static fn(string $i): string => 'index ' . $i, $converged['added_indexes'])
                            )) . '. No table, column or row was dropped.',
                    $converged);
                foreach ($converged['log'] as $entry) {
                    $emit((string) $entry['level'], (string) $entry['message']);
                }
                foreach ($converged['failed'] as $failure) {
                    $emit('warn', 'Needs manual attention — ' . $failure['what'] . ': ' . $failure['error']);
                }

                $dataMigrations = Migrations::run($pdo, Installer::VERSION, $emit);
                Migrations::recordBaseline($pdo, Installer::VERSION);
                $step('migrations', 'Data migrations', $dataMigrations['failed'] === [] ? 'pass' : 'warn',
                    $dataMigrations['applied'] === []
                        ? 'No pending data migrations for this release.'
                        : count($dataMigrations['applied']) . ' migration(s) applied.');

                $result['after']['schema'] = Database::schemaDiff(Paths::schemaFile(), $db);
            } catch (PDOException $e) {
                $step('schema', 'Schema migration', 'fail', 'Schema migration could not run: ' . Database::explain($e, $db));
                $result['ok'] = false;
            }
        } else {
            $step('schema', 'Schema migration', 'info', 'Skipped — the “migrate the database schema” option was off.');
        }

        // 5. Code ---------------------------------------------------------------
        if ($options['code']) {
            try {
                $backend = Storage::deployBackend(Paths::serverSource(), $paths, $options['deps']);
                $level = $backend['level'] === 'fail' ? 'fail' : 'pass';
                $backendMessage = implode(' ', array_filter(array_map('strval', (array) ($backend['messages'] ?? []))));
                $step('backend', 'Backend code', $level, $backendMessage !== '' ? $backendMessage : 'Backend files are in place.', $backend);
                foreach ($backend['messages'] as $message) {
                    $emit($level === 'fail' ? 'fail' : 'info', (string) $message);
                }
                if ($backend['level'] === 'fail') {
                    $result['ok'] = false;
                }

                $client = Paths::clientSource();
                if ($client !== null) {
                    $app = (array) ($ctx['app'] ?? []);
                    $frontend = Storage::publishFrontend($client, $paths, $app);
                    $step('frontend', 'Frontend build', $frontend['level'] === 'fail' ? 'fail' : 'pass', $frontend['message'], $frontend);
                    foreach ($frontend['notes'] as $note) {
                        $emit('info', (string) $note);
                    }
                    if ($frontend['level'] === 'fail') {
                        $result['ok'] = false;
                    }
                } else {
                    $step('frontend', 'Frontend build', 'warn', 'No built frontend in the package; the existing web root was left untouched.');
                }

                $entry = ConfigWriter::publishFrontController($paths, (array) ($ctx['app'] ?? []), (int) $ctx['port']);
                $step('front-controller', 'Front controller', $entry['level'] === 'fail' ? 'fail' : 'pass', $entry['message'], $entry);
                if ($entry['level'] === 'fail') {
                    $result['ok'] = false;
                }
            } catch (\Throwable $e) {
                $step('backend', 'Application code', 'fail', 'The code step failed: ' . $e->getMessage());
                $result['ok'] = false;
            }
        } else {
            $step('backend', 'Application code', 'info', 'Skipped — the “update the application files” option was off.');
        }

        // 6. Configuration ------------------------------------------------------
        if ($options['config']) {
            try {
                $env = self::buildEnvironment($ctx, $db);
                $envResult = ConfigWriter::writeEnv($paths, $env, (array) $ctx['app']);

                $installedAt = (string) ($ctx['installed_at'] ?? '');
                $configWrite = ConfigWriter::writeConfig($paths, ConfigWriter::configContents(
                    $paths,
                    (array) $ctx['app'],
                    $db,
                    (array) $ctx['secrets'],
                    (int) $ctx['port'],
                    ['installed' => true, 'installed_at' => $installedAt !== '' ? $installedAt : date('c')]
                ));
                $step('config', 'Configuration', ($envResult['level'] === 'fail' || $configWrite['level'] === 'fail') ? 'fail' : 'pass',
                    $envResult['message'] . ' ' . $configWrite['message'], ['env' => $envResult, 'config' => $configWrite]);
                if ($envResult['level'] === 'fail' || $configWrite['level'] === 'fail') {
                    $result['ok'] = false;
                }
                $emit('info', 'Secrets preserved: the application key, encryption key, JWT and refresh secrets were carried over unchanged, so existing sessions and encrypted values keep working.');
            } catch (\Throwable $e) {
                $step('config', 'Configuration', 'fail', 'Configuration could not be regenerated: ' . $e->getMessage());
                $result['ok'] = false;
            }
        } else {
            $step('config', 'Configuration', 'info', 'Skipped — the “regenerate the configuration” option was off.');
        }

        // 7. Settings -----------------------------------------------------------
        try {
            $written = Database::seedSystemSettings($db, [
                'installed_version' => Installer::VERSION,
                'upgraded_at'       => date('c'),
                'upgrade_from'      => (string) ($ctx['installed_version'] ?? ''),
                'last_upgrade_mode' => $mode,
            ]);
            $step('settings', 'System settings', 'pass', $written . ' setting(s) updated (installed_version, upgraded_at, upgrade_from).', ['written' => $written]);
        } catch (PDOException $e) {
            $step('settings', 'System settings', 'warn', 'app_settings could not be updated: ' . $e->getMessage());
        }

        // 8. Verify -------------------------------------------------------------
        $result['after']['counts'] = Database::tableCounts($db);
        $accountsAfter = self::accountSnapshot($db);
        $losses = [];
        foreach ($result['before']['counts'] as $table => $before) {
            $after = (int) ($result['after']['counts'][$table] ?? -1);
            if ($before >= 0 && $after < $before && $table !== Migrations::LEDGER) {
                $losses[] = $table . ': ' . $before . ' → ' . $after;
            }
        }
        if ($accountsAfter['users'] < $accountsBefore['users'] || $accountsAfter['super_admin'] < $accountsBefore['super_admin']) {
            $losses[] = 'accounts: ' . $accountsBefore['users'] . ' → ' . $accountsAfter['users'] . ' users, '
                . $accountsBefore['super_admin'] . ' → ' . $accountsAfter['super_admin'] . ' super administrators';
        }
        $drift = (array) ($result['after']['schema'] ?? []);
        $remaining = count((array) ($drift['tables'] ?? [])) + count((array) ($drift['columns'] ?? [])) + count((array) ($drift['keys'] ?? []));

        if ($losses !== []) {
            $result['ok'] = false;
            $step('verify', 'Verification', 'fail', 'Row counts went down — restore the backup written at the start of this run: ' . implode('; ', $losses), ['losses' => $losses]);
        } else {
            $step('verify', 'Verification', $remaining === 0 ? 'pass' : 'warn',
                'Every table kept its rows (' . array_sum($result['after']['counts']) . ' row(s) total, same or more than before). '
                . $accountsAfter['users'] . ' account(s) intact, ' . $accountsAfter['super_admin'] . ' super administrator(s).'
                . ($remaining === 0 ? ' Schema matches v' . Installer::VERSION . '.' : ' ' . $remaining . ' schema object(s) still need manual attention.'),
                ['accounts' => $accountsAfter, 'remaining' => $remaining]);
        }

        // 9. Report, installation record, then the final report -----------------
        // The report is written first so the lock can point at it, then written
        // again after the lock step so the file on disk is the complete record.
        $logDir = rtrim((string) $paths['logs'], '/\\') . DIRECTORY_SEPARATOR . 'installer';
        $reportFile = $logDir . DIRECTORY_SEPARATOR . $mode . '-report-' . date('Ymd-His') . '.txt';
        $result['report_text'] = self::report($ctx, $result);
        $reportWritten = Support::writeFile($reportFile, $result['report_text'], 0640);
        if ($reportWritten) {
            $result['report_path'] = $reportFile;
        }
        $step('report', 'Report', $reportWritten ? 'pass' : 'warn', $reportWritten
            ? 'Report written to ' . Support::path($reportFile) . '.'
            : 'The report could not be written to ' . Support::path($reportFile) . '.');

        $lockFiles = self::updateLock($ctx, $result);
        $result['lock_files'] = $lockFiles;
        if ($lockFiles === []) {
            $step('lock', 'Installation record', 'warn', 'installed.lock could not be rewritten — the version stamp is unchanged. Check permissions on install/ and the configuration folder.');
        } elseif ($result['ok']) {
            $step('lock', 'Installation record', 'pass', 'installed.lock updated: v' . $result['before']['version'] . ' → v' . Installer::VERSION . ', upgraded_at recorded.', ['files' => $lockFiles]);
        } else {
            $step('lock', 'Installation record', 'warn', 'installed.lock marked “upgrade incomplete” — it still reports v' . $result['before']['version'] . ' so the next run knows this copy needs work.', ['files' => $lockFiles]);
        }

        $emit($result['ok'] ? 'pass' : 'warn', $result['ok']
            ? 'Upgrade finished. Restart the Node.js application so the new backend code is loaded.'
            : 'Upgrade finished with items that need attention — read the steps above and the report.');

        // Rewrite the report now that the lock step is part of the record.
        $result['report_text'] = self::report($ctx, $result);
        if ($result['report_path'] !== null) {
            Support::writeFile($reportFile, $result['report_text'], 0640);
        }

        // The last-upgrade summary is secret-free and survives log rotation.
        $summaryFile = rtrim((string) $paths['config'], '/\\') . DIRECTORY_SEPARATOR . 'last-upgrade.json';
        Support::writeJson($summaryFile, [
            'mode'         => $mode,
            'ok'           => (bool) $result['ok'],
            'from_version' => (string) ($ctx['installed_version'] ?? ''),
            'to_version'   => Installer::VERSION,
            'finished_at'  => date('c'),
            'backup'       => $result['backup'],
            'report'       => $result['report_path'],
            'lock_files'   => $lockFiles,
            'steps'        => array_map(static fn(array $s): array => ['id' => $s['id'], 'level' => $s['level'], 'message' => $s['message']], $result['steps']),
            'counts'       => $result['after']['counts'],
        ]);

        return $result;
    }

    /**
     * @return array{users:int,super_admin:int}
     */
    private static function accountSnapshot(array $db): array
    {
        $snapshot = ['users' => 0, 'super_admin' => 0];
        try {
            $pdo = Database::pdo($db);
            $snapshot['users'] = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
            $snapshot['super_admin'] = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")->fetchColumn();
        } catch (PDOException $e) {
            // Counts stay zero; the caller reports the difference.
        }
        return $snapshot;
    }

    /**
     * Build the new .env: current values for everything this release knows about,
     * plus every key the package does not know (kept verbatim).
     *
     * @return array<string,string>
     */
    private static function buildEnvironment(array $ctx, array $db): array
    {
        $fresh = ConfigWriter::environment(
            (array) $ctx['paths'],
            (array) $ctx['app'],
            $db,
            (array) $ctx['secrets'],
            (int) $ctx['port']
        );
        $old = (array) ($ctx['env'] ?? []);

        foreach ($fresh as $key => $value) {
            if (($value === '' || $value === null) && isset($old[$key]) && $old[$key] !== '') {
                $fresh[$key] = $old[$key];
            }
        }
        // Anything the package does not manage stays exactly as it was.
        return $fresh + array_diff_key($old, $fresh);
    }

    /** @return string[] */
    private static function updateLock(array $ctx, array $result): array
    {
        $existing = Lock::read();
        unset($existing['_path']);
        $previous = (string) ($existing['version'] ?? ($ctx['installed_version'] ?? ''));

        $payload = $existing;
        $payload['previous_version'] = $previous;
        $payload['upgraded_at'] = date('c');
        if (!empty($result['ok'])) {
            $payload['version'] = Installer::VERSION;
            unset($payload['upgrade_incomplete']);
        } else {
            // A partial run must not claim the new version: the next upgrade has
            // to see that this copy still needs work.
            $payload['version'] = $previous !== '' ? $previous : Installer::VERSION;
            $payload['upgrade_incomplete'] = true;
        }
        $payload['upgrade_count'] = (int) ($existing['upgrade_count'] ?? 0) + 1;
        $payload['last_upgrade_mode'] = (string) ($result['mode'] ?? 'upgrade');
        if (!empty($result['report_path'])) {
            $payload['last_upgrade_report'] = (string) $result['report_path'];
        }
        if (empty($payload['installed_at'])) {
            $payload['installed_at'] = date('c');
        }
        if (empty($payload['app_url'])) {
            $payload['app_url'] = (string) ($ctx['app']['url'] ?? '');
        }
        if (empty($payload['checklist'])) {
            $payload['checklist'] = ['application' => true, 'database' => true, 'storage' => true, 'security' => true, 'administrator' => true];
        }
        return Lock::write($payload);
    }

    // ------------------------------------------------------------ report -----

    /** Plain-text, secret-free upgrade report. */
    public static function report(array $ctx, array $result): string
    {
        $lines = [];
        $line = static function (string $text = '') use (&$lines): void {
            $lines[] = $text;
        };
        $rule = static function () use ($line): void {
            $line(str_repeat('=', 74));
        };

        $rule();
        $line('RMUDTS — ' . strtoupper((string) ($result['mode'] ?? 'upgrade')) . ' REPORT');
        $line('Records Management Unit Document Tracking System');
        $rule();
        $line('Generated   : ' . date('c'));
        $line('Installer   : v' . Installer::VERSION . ' (PHP ' . PHP_VERSION . ')');
        $line('Mode        : ' . (string) ($result['mode'] ?? 'upgrade') . ($result['aborted'] ?? false ? ' — ABORTED before changes' : ''));
        $line('From        : v' . (string) ($result['before']['version'] ?? '?'));
        $line('To          : v' . Installer::VERSION);
        $line('Result      : ' . ($result['ok'] ?? false ? 'SUCCESS' : 'NEEDS ATTENTION'));
        $line('Backup      : ' . (((string) ($result['backup'] ?? '')) !== '' ? Support::path((string) $result['backup']) : 'none (aborted before the backup)'));
        $line();

        $rule();
        $line('1. STEPS');
        $rule();
        foreach ((array) ($result['steps'] ?? []) as $step) {
            $line('[' . strtoupper((string) $step['level']) . '] ' . str_pad((string) $step['label'], 26) . (string) $step['message']);
        }
        $line();

        $rule();
        $line('2. DATA PRESERVATION');
        $rule();
        $before = (array) ($result['before']['counts'] ?? []);
        $after = (array) ($result['after']['counts'] ?? []);
        $tables = array_unique(array_merge(array_keys($before), array_keys($after)));
        sort($tables);
        $line(str_pad('Table', 26) . str_pad('Before', 10) . str_pad('After', 10) . 'Result');
        foreach ($tables as $table) {
            $b = $before[$table] ?? null;
            $a = $after[$table] ?? null;
            $verdict = ($b !== null && $a !== null && $a < $b) ? 'LOST ROWS' : 'ok';
            $line(str_pad((string) $table, 26) . str_pad($b === null ? '—' : (string) $b, 10) . str_pad($a === null ? '—' : (string) $a, 10) . $verdict);
        }
        $line();
        $line('Administrator accounts are never recreated or rewritten by an upgrade:');
        $line('  ' . (int) ($after['users'] ?? 0) . ' account row(s) after the upgrade (was ' . (int) ($before['users'] ?? 0) . ').');
        $line();

        $rule();
        $line('3. SCHEDULE / FILES');
        $rule();
        $paths = (array) ($ctx['paths'] ?? []);
        foreach (['public_root', 'app_root', 'config', 'logs', 'uploads', 'backups'] as $key) {
            $line(str_pad(ucfirst(str_replace('_', ' ', $key)), 18) . Support::path((string) ($paths[$key] ?? '')));
        }
        $line();
        $line('Backend port   : ' . (int) ($ctx['port'] ?? Installer::DEFAULT_PORT));
        $line('Lock files     : ' . (count((array) ($result['lock_files'] ?? [])) > 0 ? implode(', ', array_map([Support::class, 'path'], (array) $result['lock_files'])) : 'not rewritten'));
        $line();

        $rule();
        $line('4. NEXT STEPS');
        $rule();
        $line('1. Restart the Node.js application (cPanel → Setup Node.js App → Restart) so the');
        $line('   new backend code is loaded.');
        $line('2. Open the application and sign in with an existing account.');
        $line('3. Keep the pre-upgrade backup: ' . Support::path((string) ($result['backup'] ?? '')));
        $line('4. Delete install/upgrade.key if you want to disable upgrade mode again — it is');
        $line('   re-created the next time /install/upgrade is opened.');
        $line();
        $rule();
        $line('End of report.');
        $rule();

        return implode("\n", $lines) . "\n";
    }

    /** Last upgrade summary, if any (used by the page and by support). */
    public static function lastUpgrade(array $paths): array
    {
        return Support::readJson(rtrim((string) ($paths['config'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'last-upgrade.json');
    }
}

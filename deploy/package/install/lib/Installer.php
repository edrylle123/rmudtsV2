<?php
/**
 * RMUDTS Installer — Installer (orchestrator)
 * ---------------------------------------------------------------------------
 * The single place that knows how the ten wizard steps fit together:
 *
 *   • which action each step performs,
 *   • how a submitted step is validated,
 *   • what has to be true before the wizard lets you move on,
 *   • how the installation report and the log file are produced.
 *
 * install/index.php is a thin shell around this class: it guards on the lock
 * file, calls Installer::dispatch(), and renders whatever comes back.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Installer
{
    public const VERSION = '1.0.0';
    public const PRODUCT = 'RMUDTS';
    public const DEFAULT_PORT = 8081;
    public const MIN_PHP = '8.1.0';

    /** Load the installer library. */
    public static function boot(): void
    {
        foreach (['Support', 'Paths', 'State', 'Lock', 'Integrity', 'Requirements', 'Security', 'Storage', 'Database', 'ConfigWriter', 'Cpanel', 'Verify', 'Migrations', 'Upgrader', 'Installer'] as $class) {
            $file = __DIR__ . DIRECTORY_SEPARATOR . $class . '.php';
            if ($class !== 'Installer' && is_file($file)) {
                require_once $file;
            }
        }
        State::start();
    }

    /** Paths in effect right now: saved choice, or the recommended defaults. */
    public static function paths(): array
    {
        $saved = State::get('paths');
        $defaults = Paths::defaults();
        if (!is_array($saved)) {
            return $defaults;
        }
        foreach ($defaults as $key => $value) {
            if (empty($saved[$key])) {
                $saved[$key] = $value;
            }
        }
        return $saved;
    }

    /** The port the backend will listen on. */
    public static function backendPort(): int
    {
        $server = State::get('server');
        $port = (int) ($server['port'] ?? self::DEFAULT_PORT);
        return ($port >= 1024 && $port <= 65535) ? $port : self::DEFAULT_PORT;
    }

    // ------------------------------------------------------------- dispatch --

    /**
     * Handle one request.
     *
     * @return array{action:string,ok:bool,level:string,message:string,data:array,redirect:?string}
     */
    public static function dispatch(string $method, array $input): array
    {
        $action = trim((string) ($input['action'] ?? ''));
        if ($method !== 'POST') {
            return self::result('view', true, 'info', '', []);
        }
        if ($action === '') {
            return self::result('view', false, 'warn', 'No action was supplied.', []);
        }

        // CSRF: every POST carries a token minted when the wizard was opened.
        $token = (string) ($input['csrf'] ?? '');
        if (!self::checkCsrf($token)) {
            return self::result($action, false, 'fail', 'Your session expired (security token mismatch). Reload the page and try again.', []);
        }

        try {
            return match ($action) {
                'start'          => self::actionStart(),
                'step-next'      => self::actionStepNext((int) ($input['step'] ?? 0), $input),
                'step-back'      => self::actionStepBack((int) ($input['step'] ?? 0)),
                'cancel'         => self::actionCancel(),
                'storage-check'  => self::actionStorageCheck($input, false),
                'storage-apply'  => self::actionStorageCheck($input, true),
                'db-test'        => self::actionDatabaseTest($input),
                'db-save'        => self::actionDatabaseSave($input),
                'db-provision'   => self::actionProvision($input),
                'app-save'       => self::actionApplicationSave($input),
                'admin-save'     => self::actionAdminSave($input),
                'security-run'   => self::actionSecurityRun($input),
                'backend-install' => self::actionBackendInstall(),
                'frontend-publish' => self::actionFrontendPublish(),
                'finish'         => self::actionFinish(),
                'report'         => self::actionReport(),
                default          => self::result($action, false, 'fail', 'Unknown installer action “' . $action . '”.', []),
            };
        } catch (\Throwable $e) {
            State::log('fail', 'Unhandled installer error: ' . $e->getMessage());
            return self::result($action, false, 'fail', 'The installer hit an unexpected error: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
        }
    }

    /** @return array{action:string,ok:bool,level:string,message:string,data:array,redirect:?string} */
    private static function result(string $action, bool $ok, string $level, string $message, array $data, ?string $redirect = null): array
    {
        return ['action' => $action, 'ok' => $ok, 'level' => $level, 'message' => $message, 'data' => $data, 'redirect' => $redirect];
    }

    // ---------------------------------------------------------------- csrf ---

    private static function checkCsrf(string $token): bool
    {
        $expected = (string) ($_SESSION['rmudts_csrf'] ?? '');
        if ($expected === '' || $token === '') {
            return false;
        }
        return hash_equals($expected, $token);
    }

    public static function csrfToken(): string
    {
        if (empty($_SESSION['rmudts_csrf'])) {
            $_SESSION['rmudts_csrf'] = bin2hex(random_bytes(24));
        }
        return (string) $_SESSION['rmudts_csrf'];
    }

    // -------------------------------------------------------------- actions --

    private static function actionStart(): array
    {
        State::markComplete(1);
        State::goTo(2);
        State::log('info', 'Installation wizard started.');
        return self::result('start', true, 'pass', 'Let’s check that this server can run RMUDTS.', [], '?step=2');
    }

    private static function actionStepBack(int $step): array
    {
        State::goTo(max(1, $step - 1));
        return self::result('step-back', true, 'info', '', []);
    }

    private static function actionCancel(): array
    {
        State::log('warn', 'Installation cancelled by the administrator.');
        State::reset();
        return self::result('cancel', true, 'info', 'Installation cancelled. No changes were written to the database.', [], '?cancelled=1');
    }

    private static function actionStepNext(int $step, array $input): array
    {
        return match ($step) {
            1  => self::actionStart(),
            2  => self::stepNextRequirements(),
            3  => self::actionStorageCheck($input, true),
            4  => self::actionDatabaseSave($input),
            5  => self::stepNextProvision(),
            6  => self::actionApplicationSave($input),
            7  => self::actionAdminSave($input),
            8  => self::actionSecurityRun($input),
            9  => self::actionFinish(),
            default => self::result('step-next', true, 'info', '', [], '?step=' . min(10, $step + 1)),
        };
    }

    private static function stepNextRequirements(): array
    {
        $groups = Requirements::all(self::paths());
        $summary = Requirements::summarise($groups);
        if (!$summary['ok']) {
            return self::result('step-next', false, 'fail', 'Fix the failing items below before continuing: ' . implode('; ', array_slice($summary['blocking'], 0, 3)), []);
        }

        // The archive itself has to be intact before any file is written.
        $integrity = Integrity::verify();
        State::set(['integrity' => $integrity]);
        if (!$integrity['ok']) {
            $problems = array_values(array_filter($integrity['checks'], static fn(array $c): bool => ($c['level'] ?? '') === 'fail'));
            $labels = array_map(static fn(array $c): string => (string) ($c['label'] ?? 'check'), $problems);
            State::log('fail', 'Package integrity check failed: ' . implode(', ', $labels));
            return self::result('step-next', false, 'fail', 'The release archive is incomplete or modified: ' . implode(', ', array_slice($labels, 0, 3)) . '. Re-upload the original ZIP and extract it again.', ['integrity' => $integrity]);
        }

        State::markComplete(2);
        State::goTo(3);
        State::log('pass', 'Requirements check passed (' . $summary['counts']['pass'] . ' checks, ' . $summary['counts']['warn'] . ' warnings; archive integrity verified).');
        return self::result('step-next', true, 'pass', 'All critical requirements are met and the archive is intact.', ['integrity' => $integrity], '?step=3');
    }

    private static function stepNextProvision(): array
    {
        if (!State::has('db_provisioned')) {
            return self::result('step-next', false, 'fail', 'Run “Test Connection & Provision” before continuing.', []);
        }
        State::markComplete(5);
        State::goTo(6);
        return self::result('step-next', true, 'pass', 'Database provisioned.', [], '?step=6');
    }

    // -- step 3: storage -------------------------------------------------------

    private static function actionStorageCheck(array $input, bool $create): array
    {
        $paths = self::paths();
        foreach (Paths::KEYS as $key => $label) {
            if (isset($input[$key]) && trim((string) $input[$key]) !== '') {
                $paths[$key] = Paths::normalise((string) $input[$key]);
            }
        }
        State::set(['paths' => $paths]);

        $validation = [];
        $ok = true;
        foreach (Paths::KEYS as $key => $label) {
            $result = Paths::validate($key, (string) $paths[$key], $paths);
            $validation[$key] = $result;
            if ($result['level'] === 'fail') {
                $ok = false;
            }
        }

        $actions = [];
        if ($create) {
            if (!$ok) {
                return self::result($create ? 'storage-apply' : 'storage-check', false, 'fail', 'Some locations were rejected. Nothing was created yet.', ['validation' => $validation]);
            }
            $actions = Storage::prepare($paths);
            $protected = Storage::protect($paths);
            $manifest = Storage::writeManifest($paths, (string) $paths['config']);
            foreach ($actions as $entry) {
                if ($entry['level'] === 'fail') {
                    $ok = false;
                }
            }
            State::log($ok ? 'pass' : 'fail', 'Storage prepared: ' . count($actions) . ' location(s), ' . count($protected) . ' protection file(s).');
            State::set(['storage' => ['report' => $actions, 'manifest' => $manifest, 'prepared_at' => date('c')]]);

            if ($ok) {
                State::markComplete(3);
                State::goTo(4);
            }
            return self::result('storage-apply', (bool) $ok, $ok ? 'pass' : 'fail', $ok
                ? 'Every storage location was created and verified. Sensitive folders are protected.'
                : 'Some locations could not be created — see the details below.', [
                    'validation' => $validation,
                    'report'     => $actions,
                    'manifest'   => $manifest,
                ], $ok ? '?step=4' : null);
        }

        return self::result('storage-check', $ok, $ok ? 'pass' : 'fail', $ok
            ? 'All configured locations look valid and writable.'
            : 'Some locations are not usable yet — fix the highlighted entries.', ['validation' => $validation]);
    }

    // -- step 4/5: database ----------------------------------------------------

    private static function sanitiseDatabase(array $input): array
    {
        $saved = (array) (State::get('db') ?? []);
        $db = [
            'host' => trim((string) ($input['host'] ?? $saved['host'] ?? 'localhost')) ?: 'localhost',
            'port' => (string) (int) ($input['port'] ?? $saved['port'] ?? 3306),
            'name' => trim((string) ($input['name'] ?? $saved['name'] ?? '')),
            'user' => trim((string) ($input['user'] ?? $saved['user'] ?? '')),
            // An empty password field means "keep what was stored" so the
            // administrator can revisit the step without retyping it.
            'pass' => array_key_exists('pass', $input) && (string) $input['pass'] !== ''
                ? (string) $input['pass']
                : (string) ($saved['pass'] ?? ''),
        ];
        return $db;
    }

    private static function validateDatabase(array $db): array
    {
        $errors = [];
        if ($db['name'] === '' || !preg_match('/^[A-Za-z0-9_$]{1,64}$/', $db['name'])) {
            $errors['name'] = 'Use letters, numbers and underscores only (that is what cPanel allows).';
        }
        if ($db['user'] === '' || !preg_match('/^[A-Za-z0-9_.$-]{1,64}$/', $db['user'])) {
            $errors['user'] = 'Enter the MySQL user created in cPanel → MySQL Databases (often prefixed with the account name).';
        }
        if ($db['host'] === '') {
            $errors['host'] = 'The database host is required (usually localhost).';
        }
        $port = (int) $db['port'];
        if ($port < 1 || $port > 65535) {
            $errors['port'] = 'The port must be between 1 and 65535.';
        }
        return $errors;
    }

    private static function actionDatabaseSave(array $input): array
    {
        $db = self::sanitiseDatabase($input);
        $errors = self::validateDatabase($db);
        if ($errors !== []) {
            return self::result('db-save', false, 'fail', 'Please correct the highlighted fields.', ['errors' => $errors]);
        }
        State::put('db', $db);
        State::log('info', 'Database details recorded for ' . $db['name'] . ' @ ' . $db['host'] . ':' . $db['port'] . ' as ' . $db['user'] . ' (password not logged).');
        State::markComplete(4);
        State::goTo(5);
        return self::result('db-save', true, 'pass', 'Database details saved. Next: test the connection and provision the schema.', [], '?step=5');
    }

    private static function actionDatabaseTest(array $input): array
    {
        $db = self::sanitiseDatabase($input);
        $errors = self::validateDatabase($db);
        if ($errors !== []) {
            return self::result('db-test', false, 'fail', 'Please correct the highlighted fields first.', ['errors' => $errors]);
        }
        State::put('db', $db);

        try {
            $test = Database::test($db);
        } catch (\PDOException $e) {
            $message = Database::explain($e, $db);
            State::log('fail', 'Database test failed: ' . $message);
            return self::result('db-test', false, 'fail', $message, ['checks' => []]);
        }
        State::log($test['ok'] ? 'pass' : 'fail', 'Database test: ' . ($test['ok'] ? 'passed' : 'failed'));
        return self::result('db-test', $test['ok'], $test['ok'] ? 'pass' : 'fail', $test['ok']
            ? 'Connection verified — the account can use database `' . $db['name'] . '`.'
            : 'The connection test found problems. Fix them and test again.', ['checks' => $test['checks']]);
    }

    private static function actionProvision(array $input): array
    {
        $db = self::sanitiseDatabase($input);
        $errors = self::validateDatabase($db);
        if ($errors !== []) {
            return self::result('db-provision', false, 'fail', 'Please correct the highlighted fields first.', ['errors' => $errors]);
        }
        State::put('db', $db);

        $stage = (string) ($input['stage'] ?? '');
        if (!array_key_exists($stage, Database::STAGES)) {
            return self::result('db-provision', false, 'fail', 'Unknown provisioning stage.', ['stages' => array_keys(Database::STAGES)]);
        }

        $schema = Paths::schemaFile();
        $result = Database::runStage($stage, $db, $schema);

        foreach ($result['log'] as $entry) {
            State::log($entry['level'], '[provision:' . $stage . '] ' . $entry['message']);
        }

        // Track progress so a reload can resume at the right stage.
        $progress = (array) (State::get('provision_progress') ?? []);
        $progress[$stage] = ['level' => $result['level'], 'message' => $result['message'], 'at' => date('c')];
        State::set(['provision_progress' => $progress]);

        $stages = array_keys(Database::STAGES);
        $index = (int) array_search($stage, $stages, true);
        $next = $stages[$index + 1] ?? null;

        $payload = [
            'stage'    => $stage,
            'label'    => Database::STAGES[$stage],
            'log'      => $result['log'],
            'data'     => $result['data'],
            'next'     => $result['level'] === 'fail' ? null : $next,
            'progress' => (int) round(($index + ($result['level'] === 'fail' ? 0 : 1)) / count($stages) * 100),
            'done'     => $next === null && $result['level'] !== 'fail',
        ];

        if ($stage === 'verify' && $result['level'] !== 'fail') {
            State::set(['db_provisioned' => true, 'provisioned_at' => date('c')]);
            State::markComplete(5);
        }

        return self::result('db-provision', $result['level'] !== 'fail', $result['level'], $result['message'], $payload);
    }

    // -- step 6: application ---------------------------------------------------

    private static function actionApplicationSave(array $input): array
    {
        $existing = (array) (State::get('app') ?? []);
        $app = [
            'name'         => trim((string) ($input['name'] ?? $existing['name'] ?? 'RMUDTS')) ?: 'RMUDTS',
            'url'          => rtrim(trim((string) ($input['url'] ?? $existing['url'] ?? self::detectUrl())), '/'),
            'client_url'   => rtrim(trim((string) ($input['client_url'] ?? '')), '/'),
            'api_url'      => rtrim(trim((string) ($input['api_url'] ?? '')), '/'),
            'system_email' => trim((string) ($input['system_email'] ?? '')),
            'timezone'     => trim((string) ($input['timezone'] ?? 'Asia/Manila')),
            'env'          => trim((string) ($input['env'] ?? 'production')),
        ];
        $port = (int) ($input['port'] ?? State::get('server')['port'] ?? self::DEFAULT_PORT);

        $errors = [];
        if (!preg_match('#^https?://[^\s]+$#i', $app['url'])) {
            $errors['url'] = 'Enter the full site address, including https:// (for example https://rmudts.example.edu).';
        }
        if ($app['system_email'] !== '' && !filter_var($app['system_email'], FILTER_VALIDATE_EMAIL)) {
            $errors['system_email'] = 'That does not look like an email address.';
        }
        if (!in_array($app['timezone'], \DateTimeZone::listIdentifiers(), true)) {
            $errors['timezone'] = 'Choose a timezone from the list.';
        }
        if (!in_array($app['env'], ['production', 'staging'], true)) {
            $app['env'] = 'production';
        }
        if ($port < 1024 || $port > 65535) {
            $errors['port'] = 'Choose a port between 1024 and 65535 (8081 is a safe default).';
        }
        if ($errors !== []) {
            return self::result('app-save', false, 'fail', 'Please correct the highlighted fields.', ['errors' => $errors]);
        }

        $app['client_url'] = $app['client_url'] !== '' ? $app['client_url'] : $app['url'];
        $app['api_url'] = $app['api_url'] !== '' ? $app['api_url'] : $app['url'] . '/api';

        // The three URLs every generated file must agree on. The frontend lives
        // in public_html/rmudts; the API/Socket.IO origin is whatever the
        // administrator entered (the api. subdomain in the recommended layout).
        $apiParts = parse_url($app['api_url']) ?: [];
        $apiOrigin = isset($apiParts['scheme'], $apiParts['host'])
            ? $apiParts['scheme'] . '://' . $apiParts['host'] . (isset($apiParts['port']) ? ':' . $apiParts['port'] : '')
            : $app['api_url'];
        $frontendPath = (string) (parse_url($app['client_url'], PHP_URL_PATH) ?: '/rmudts');

        State::set([
            'app'    => $app,
            'server' => ['port' => $port],
            'urls'   => [
                'frontend'    => $app['client_url'],
                'api'         => $app['api_url'],
                'socket'      => $apiOrigin,
                'socket_path' => '/socket.io',
                'base_path'   => rtrim($frontendPath, '/') . '/',
            ],
        ]);

        $paths = self::paths();
        $secrets = (array) (State::get('secrets') ?? []);
        $db = (array) (State::get('db') ?? []);
        $app['host'] = (string) (parse_url($app['url'], PHP_URL_HOST) ?: '');

        // Write the configuration now so the files exist even if the flow is
        // interrupted; the final step writes them again with the lock flag on.
        $env = ConfigWriter::environment($paths, $app, $db, $secrets, $port);
        State::put('env', $env);
        $envResult = ConfigWriter::writeEnv($paths, $env, $app);
        $configResult = ConfigWriter::writeConfig($paths, ConfigWriter::configContents($paths, $app, $db, $secrets, $port));
        State::set(['config' => ['config_file' => $configResult['file'], 'written_at' => date('c')]]);

        State::log($envResult['level'], 'Application configuration written (' . $app['name'] . ' at ' . $app['url'] . ').');
        State::markComplete(6);
        State::goTo(7);

        return self::result('app-save', $envResult['level'] !== 'fail' && $configResult['level'] !== 'fail', $envResult['level'] === 'fail' ? 'fail' : 'pass', $envResult['message'] . ' ' . $configResult['message'], [
            'env_file'    => $envResult['files'],
            'config_file' => $configResult['file'],
        ], '?step=7');
    }

    /** Best-guess absolute URL of this installation, used as the form default. */
    public static function detectUrl(): string
    {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/install/index.php');
        $base = rtrim(str_replace('/install/index.php', '', $script), '/');
        return ($https ? 'https://' : 'http://') . $host . $base;
    }

    // -- step 7: administrator -------------------------------------------------

    private static function actionAdminSave(array $input): array
    {
        $existing = (array) (State::get('admin') ?? []);
        $password = (string) ($input['password'] ?? '');
        $confirm = (string) ($input['password_confirm'] ?? '');

        $admin = [
            'first_name' => trim((string) ($input['first_name'] ?? '')),
            'last_name'  => trim((string) ($input['last_name'] ?? '')),
            'idnumber'   => trim((string) ($input['idnumber'] ?? '')),
            'email'      => trim((string) ($input['email'] ?? '')),
        ];

        $errors = [];
        if ($admin['first_name'] === '') {
            $errors['first_name'] = 'Enter the administrator’s first name.';
        }
        if ($admin['last_name'] === '') {
            $errors['last_name'] = 'Enter the administrator’s last name.';
        }
        if (!preg_match('/^[A-Za-z0-9._-]{3,20}$/', $admin['idnumber'])) {
            $errors['idnumber'] = 'The username (used to sign in) must be 3–20 characters: letters, numbers, dot, dash or underscore.';
        }
        if (!filter_var($admin['email'], FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Enter a valid email address — password resets are sent there.';
        }
        $policy = Security::checkPassword($password, $confirm);
        if (!$policy['ok']) {
            $missing = array_values(array_map(
                static fn(array $r): string => $r['label'],
                array_filter($policy['requirements'], static fn(array $r): bool => !$r['met'])
            ));
            $errors['password'] = 'The password does not meet the requirements: ' . implode(', ', $missing) . '.';
        }
        if ($errors !== []) {
            return self::result('admin-save', false, 'fail', 'Please correct the highlighted fields.', ['errors' => $errors, 'policy' => $policy]);
        }

        $db = (array) (State::get('db') ?? []);
        try {
            $created = Database::createAdministrator($db, $admin + ['password' => $password]);
        } catch (\PDOException $e) {
            $message = Database::explain($e, $db);
            State::log('fail', 'Administrator account could not be created: ' . $message);
            return self::result('admin-save', false, 'fail', 'The administrator account could not be created: ' . $message, []);
        }

        // Keep the record (never the plain text password) in the wizard state.
        State::set(['admin' => $admin + [
            'id'         => $created['id'],
            'created_at' => date('c'),
            'hash_algo'  => 'bcrypt cost 12',
            'existing_password_preserved' => $existing !== [],
        ]]);

        State::log($created['level'], 'Administrator account: ' . $created['message']);
        State::markComplete(7);
        State::goTo(8);

        return self::result('admin-save', true, 'pass', $created['message'], ['admin' => ['id' => $created['id'], 'name' => $created['name'], 'idnumber' => $created['idnumber']]], '?step=8');
    }

    // -- step 8: security ------------------------------------------------------

    private static function actionSecurityRun(array $input): array
    {
        $paths = self::paths();
        $existing = (array) (State::get('secrets') ?? []);
        $regenerate = !empty($input['regenerate']);

        if ($existing === [] || $regenerate) {
            $secrets = Security::generateSecrets();
            State::set(['secrets' => $secrets]);
            State::log('pass', 'Generated application key, encryption key, JWT secret, refresh-token secret, API token and CSRF secret.');
        } else {
            $secrets = $existing;
        }

        $written = Security::applyHardening($paths);
        $tightened = Security::tightenPermissions($paths);
        $checklist = Security::checklist($paths, $secrets, Lock::exists());

        // The secrets now exist, so refresh the configuration files that carry
        // them (step 6 wrote placeholders when it ran first).
        $app = (array) (State::get('app') ?? []);
        $db = (array) (State::get('db') ?? []);
        $port = self::backendPort();
        $env = ConfigWriter::environment($paths, $app, $db, $secrets, $port);
        State::put('env', $env);
        $envResult = ConfigWriter::writeEnv($paths, $env, $app);

        State::set(['security' => [
            'applied_at'       => date('c'),
            'files'            => $written,
            'tightened'        => $tightened,
            'checklist'        => $checklist,
        ]]);

        $fails = array_values(array_filter($checklist, static fn(array $row): bool => $row['level'] === 'fail'));
        $ok = $fails === [];
        if ($ok) {
            State::markComplete(8);
            State::goTo(9);
        }

        return self::result('security-run', $ok, $ok ? 'pass' : 'fail', $ok
            ? 'Security applied: keys generated, ' . count($written) . ' protection file(s) written, configuration permissions tightened.'
            : 'Security could not be finished — resolve the failing items.', [
                'secrets'   => self::publicSecrets($secrets),
                'files'     => $written,
                'checklist' => $checklist,
                'env'       => $envResult,
            ], $ok ? '?step=9' : null);
    }

    /** Never hand a raw secret back to the browser. */
    private static function publicSecrets(array $secrets): array
    {
        $out = [];
        foreach (Security::SECRETS as $key => $label) {
            $out[$key] = ['label' => $label, 'preview' => Support::redact((string) ($secrets[$key] ?? ''))];
        }
        return $out;
    }

    // -- install steps invoked from the summary --------------------------------

    private static function actionBackendInstall(): array
    {
        $paths = self::paths();
        $result = Storage::deployBackend(Paths::serverSource(), $paths);
        State::set(['backend' => [
            'copied_at' => date('c'),
            'path'      => $result['path'],
            'files'     => $result['files'],
            'deps'      => $result['deps'],
            'messages'  => $result['messages'],
        ]]);
        foreach ($result['messages'] as $message) {
            State::log($result['level'] === 'fail' ? 'fail' : 'info', $message);
        }
        return self::result('backend-install', $result['level'] !== 'fail', $result['level'] === 'fail' ? 'fail' : ($result['deps']['level'] === 'warn' ? 'warn' : 'pass'), implode(' ', $result['messages']), [
            'path' => $result['path'],
            'files' => $result['files'],
            'deps' => $result['deps'],
        ]);
    }

    private static function actionFrontendPublish(): array
    {
        $paths = self::paths();
        $app = (array) (State::get('app') ?? []);
        $client = Paths::clientSource();
        $result = Storage::publishFrontend((string) $client, $paths, $app);

        // The front controller and the web-root entry files go out with it.
        $entry = ConfigWriter::publishFrontController($paths, $app, self::backendPort());

        State::set(['frontend' => [
            'published_at' => date('c'),
            'source'       => $client,
            'files'        => $result['files'],
            'level'        => $result['level'],
            'entry_files'  => $entry['files'],
        ]]);

        $level = $result['level'] === 'fail' ? 'fail' : ($entry['level'] === 'fail' ? 'fail' : 'pass');
        foreach (array_merge([$result['message']], $entry['files'], $result['notes']) as $message) {
            State::log($level === 'fail' ? 'fail' : 'info', is_string($message) ? $message : json_encode($message));
        }

        return self::result('frontend-publish', $level !== 'fail', $level, $result['message'] . ' ' . $entry['message'], [
            'files'       => $result['files'],
            'notes'       => $result['notes'],
            'entry_files' => $entry['files'],
        ]);
    }

    /**
     * The last step: seed system settings, write the final configuration, drop
     * the schema snapshot into backups and finally write installed.lock.
     */
    private static function actionFinish(): array
    {
        $paths = self::paths();
        $app = (array) (State::get('app') ?? []);
        $db = (array) (State::get('db') ?? []);
        $admin = (array) (State::get('admin') ?? []);
        $secrets = (array) (State::get('secrets') ?? []);
        $port = self::backendPort();
        $messages = [];
        $level = 'pass';

        // 1. System settings ------------------------------------------------
        $settings = [
            'app_name'          => (string) ($app['name'] ?? 'RMUDTS'),
            'app_url'           => (string) ($app['url'] ?? ''),
            'app_env'           => (string) ($app['env'] ?? 'production'),
            'app_timezone'      => (string) ($app['timezone'] ?? 'Asia/Manila'),
            'system_email'      => (string) ($app['system_email'] ?? ''),
            'installed_version' => self::VERSION,
            'installed_at'      => date('c'),
            'installed_by'      => (string) ($admin['idnumber'] ?? ''),
            'maintenance_mode'  => '0',
            'default_retention' => '5 years',
        ];
        try {
            $seeded = Database::seedSystemSettings($db, $settings);
            $messages[] = $seeded . ' system setting(s) written.';
            State::log('pass', 'System settings seeded (' . $seeded . ' keys).');
        } catch (\PDOException $e) {
            $level = 'warn';
            $messages[] = 'System settings could not be written: ' . $e->getMessage();
            State::log('warn', end($messages));
        }

        // 2. Final configuration files --------------------------------------
        $env = ConfigWriter::environment($paths, $app, $db, $secrets, $port);
        $envResult = ConfigWriter::writeEnv($paths, $env, $app);
        $configFile = ConfigWriter::writeConfig($paths, ConfigWriter::configContents($paths, $app, $db, $secrets, $port, [
            'installed'    => true,
            'installed_at' => date('c'),
        ]));
        $messages[] = $envResult['message'];
        $messages[] = $configFile['message'];
        if ($envResult['level'] === 'fail' || $configFile['level'] === 'fail') {
            $level = 'warn';
        }

        // 2b. cPanel Node.js setup sheet -------------------------------------
        // PHP cannot create the cPanel application: there is no API for it on
        // shared hosting. The exact values and steps are generated instead, and
        // written next to the configuration so they survive the wizard state.
        $cpanel = Cpanel::instructions($paths, $app);
        $cpanelFile = Cpanel::writeFile($paths, $app, (string) $cpanel['download']);
        $messages[] = $cpanelFile !== null
            ? 'cPanel Node.js setup sheet written to ' . Support::path($cpanelFile) . '.'
            : 'The cPanel setup sheet could not be written; the completion screen still lists every value.';

        // 3. Front controller + frontend (idempotent, safe to repeat) --------
        $frontend = self::actionFrontendPublish();
        $messages[] = $frontend['message'];
        $backend = self::actionBackendInstall();
        $messages[] = $backend['message'];

        // 4. Database snapshot the administrator can keep --------------------
        $snapshotName = 'schema-' . date('Ymd-His') . '.sql';
        $snapshot = Database::dump($db, rtrim((string) $paths['backups'], '/\\') . DIRECTORY_SEPARATOR . 'manual' . DIRECTORY_SEPARATOR . $snapshotName);
        $messages[] = $snapshot['message'];

        // 5. Storage manifest and the install log file -----------------------
        Storage::writeManifest($paths, (string) $paths['config']);
        $logFile = self::writeLogFile($paths);
        if ($logFile !== null) {
            $messages[] = 'Installation log written to ' . Support::path($logFile) . '.';
        }

        // 6. Report -----------------------------------------------------------
        $report = self::report($paths);
        $reportFile = rtrim((string) $paths['logs'], '/\\') . DIRECTORY_SEPARATOR . 'installer'
            . DIRECTORY_SEPARATOR . 'installation-report-' . date('Ymd-His') . '.txt';
        Support::writeFile($reportFile, $report, 0640);
        State::set(['report_file' => $reportFile]);

        // 7. installed.lock — always last -------------------------------------
        $lockFiles = Lock::write([
            'app_name'    => (string) ($app['name'] ?? 'RMUDTS'),
            'app_url'     => (string) ($app['url'] ?? ''),
            'environment' => (string) ($app['env'] ?? 'production'),
            'php_version' => PHP_VERSION,
            'node_port'   => $port,
            'database'    => (string) ($db['name'] ?? '') . '@' . (string) ($db['host'] ?? ''),
            'admin'       => (string) ($admin['idnumber'] ?? ''),
            'report'      => $reportFile,
            'checklist'   => ['application' => true, 'database' => true, 'storage' => true, 'security' => true, 'administrator' => true],
        ]);
        if ($lockFiles === []) {
            $level = 'fail';
            $messages[] = 'The installer could not write installed.lock. Create an empty file named installed.lock inside the install folder to lock the installer.';
        } else {
            $messages[] = 'Installed lock written to ' . Support::path($lockFiles[0]) . ' — the wizard is now disabled.';
        }

        State::markComplete(9);
        State::markComplete(10);
        State::goTo(10);
        State::log($level === 'fail' ? 'fail' : 'pass', 'Installation completed.');

        // Everything the completion screen shows is captured before the state
        // file is removed, so nothing depends on it afterwards.
        $summary = [
            'messages'      => $messages,
            'lock_files'    => $lockFiles,
            'report'        => $reportFile,
            'report_text'   => $report,
            'snapshot'      => $snapshot['path'] ?? null,
            'app'           => $app,
            'admin'         => $admin,
            'database'      => [
                'host' => (string) ($db['host'] ?? ''),
                'port' => (string) ($db['port'] ?? ''),
                'name' => (string) ($db['name'] ?? ''),
                'user' => (string) ($db['user'] ?? ''),
            ],
            'port'          => $port,
            'installed_at'  => date('c'),
            'log_file'      => $logFile,
            'storage_paths' => $paths,
            'cpanel'        => [
                'values'   => (array) $cpanel['values'],
                'steps'    => (array) $cpanel['steps'],
                'commands' => (array) $cpanel['commands'],
                'file'     => $cpanelFile,
            ],
        ];

        // A durable, secret-free summary for the completion screen (and for
        // support requests afterwards). It survives the state reset below.
        $summaryFile = rtrim((string) ($paths['config'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'install-summary.json';
        if ($summaryFile !== DIRECTORY_SEPARATOR . 'install-summary.json') {
            Support::writeJson($summaryFile, $summary);
            $summary['summary_file'] = $summaryFile;
        }

        if ($level !== 'fail') {
            // The database password must not outlive the installation, and the
            // wizard state has no purpose once the lock file exists.
            State::shredDatabasePassword();
            State::reset(true);
        }

        return self::result('finish', $level !== 'fail', $level === 'fail' ? 'fail' : 'pass', 'RMUDTS installation completed.', $summary, $level === 'fail' ? null : '?step=10&done=1');
    }

    private static function writeLogFile(array $paths): ?string
    {
        $dir = rtrim((string) ($paths['logs'] ?? ''), '/\\') . DIRECTORY_SEPARATOR . 'installer';
        if (!Support::mkdir($dir)) {
            return null;
        }
        $file = $dir . DIRECTORY_SEPARATOR . 'install-' . date('Ymd-His') . '.log';
        $lines = ['# RMUDTS installation log — ' . date('c')];
        foreach (State::logEntries() as $entry) {
            $lines[] = '[' . ($entry['at'] ?? '') . '] ' . strtoupper((string) ($entry['level'] ?? 'info')) . ' ' . ($entry['message'] ?? '');
        }
        return Support::writeFile($file, implode("\n", $lines) . "\n", 0640) ? $file : null;
    }

    // --------------------------------------------------------------- report ---

    /** The downloadable installation report (plain text, no secrets). */
    public static function report(array $paths = []): string
    {
        $paths = $paths ?: self::paths();
        $app = (array) (State::get('app') ?? []);
        $db = (array) (State::get('db') ?? []);
        $admin = (array) (State::get('admin') ?? []);
        $secrets = (array) (State::get('secrets') ?? []);
        $provision = (array) (State::get('provision_progress') ?? []);
        $storage = (array) (State::get('storage') ?? []);
        $security = (array) (State::get('security') ?? []);
        $frontend = (array) (State::get('frontend') ?? []);
        $backend = (array) (State::get('backend') ?? []);

        $lines = [];
        $line = static function (string $text = '') use (&$lines): void {
            $lines[] = $text;
        };
        $rule = static function () use ($line): void {
            $line(str_repeat('=', 74));
        };

        $rule();
        $line('RMUDTS — Installation Report');
        $line('Records Management Unit Document Tracking System');
        $rule();
        $line('Generated      : ' . date('c'));
        $line('Installer      : v' . self::VERSION . ' (PHP ' . PHP_VERSION . ')');
        $line('Product status : ' . (Lock::exists() ? 'INSTALLED (locked)' : 'not locked yet'));
        $line('Report file    : ' . (string) (State::get('report_file') ?? 'generated in-memory'));
        $line();

        $rule();
        $line('1. APPLICATION');
        $rule();
        $line('Name           : ' . (string) ($app['name'] ?? '—'));
        $line('URL            : ' . (string) ($app['url'] ?? '—'));
        $line('Frontend URL   : ' . (string) ($app['client_url'] ?? '—'));
        $line('API URL        : ' . (string) ($app['api_url'] ?? '—'));
        $line('Environment    : ' . (string) ($app['env'] ?? '—'));
        $line('Timezone       : ' . (string) ($app['timezone'] ?? '—'));
        $line('System email   : ' . (string) ($app['system_email'] ?? '—'));
        $line('Backend port   : ' . self::backendPort() . '  (http://127.0.0.1:' . self::backendPort() . ')');
        $line();

        $rule();
        $line('2. STORAGE LOCATIONS');
        $rule();
        foreach (Paths::KEYS as $key => $label) {
            $present = is_dir((string) ($paths[$key] ?? ''));
            $writable = $present && is_writable((string) ($paths[$key] ?? ''));
            $line(str_pad($label, 30) . Support::path((string) ($paths[$key] ?? '—')));
            $line(str_pad('', 30) . ($present ? ($writable ? 'writable' : 'NOT WRITABLE') : 'missing'));
        }
        if (!empty($storage['manifest'])) {
            $line();
            $line('Manifest       : ' . Support::path((string) $storage['manifest']));
        }
        $line();

        $rule();
        $line('3. DATABASE');
        $rule();
        $line('Host           : ' . (string) ($db['host'] ?? '—') . ':' . (string) ($db['port'] ?? '—'));
        $line('Database       : ' . (string) ($db['name'] ?? '—'));
        $line('User           : ' . (string) ($db['user'] ?? '—'));
        $line('Password       : ******** (stored in .env, mode 0600 — never in this report)');
        if ($provision !== []) {
            $line();
            $line('Provisioning stages:');
            foreach (Database::STAGES as $stage => $label) {
                $entry = $provision[$stage] ?? null;
                $line('  ' . str_pad($stage, 16) . ($entry ? strtoupper((string) $entry['level']) . ' — ' . (string) $entry['message'] : 'not run'));
            }
        }
        try {
            $report = Database::report($db);
            $line();
            $line('Tables         : ' . count($report['tables']) . ' (' . Support::bytes($report['size']) . ')');
            foreach ($report['tables'] as $table) {
                $line('  ' . str_pad((string) $table['table'], 24) . $table['rows'] . ' rows');
            }
        } catch (\Throwable $e) {
            $line('Tables         : not inspected (' . $e->getMessage() . ')');
        }
        $line();

        $rule();
        $line('4. ADMINISTRATOR ACCOUNT');
        $rule();
        $line('Name           : ' . (string) ($admin['name'] ?? (string) ($admin['first_name'] ?? '—') . ' ' . (string) ($admin['last_name'] ?? '')));
        $line('Username       : ' . (string) ($admin['idnumber'] ?? '—') . '   (sign-in identifier)');
        $line('Email          : ' . (string) ($admin['email'] ?? '—'));
        $line('Role           : super_admin');
        $line('Password hash  : ' . (string) ($admin['hash_algo'] ?? 'bcrypt'));
        $line('Created        : ' . (string) ($admin['created_at'] ?? '—'));
        $line();

        $rule();
        $line('5. SECURITY');
        $rule();
        foreach (Security::SECRETS as $key => $label) {
            $line(str_pad($label, 34) . Support::redact((string) ($secrets[$key] ?? '')));
        }
        $line();
        $line('Protection files written : ' . count((array) ($security['files'] ?? [])));
        foreach ((array) ($security['files'] ?? []) as $file) {
            $line('  ' . Support::path((string) $file));
        }
        $line();
        $line('Checklist:');
        foreach ((array) ($security['checklist'] ?? []) as $row) {
            $line('  [' . strtoupper((string) $row['level']) . '] ' . str_pad((string) $row['label'], 28) . (string) $row['note']);
        }
        $line();

        $rule();
        $line('6. PUBLISHED FILES');
        $rule();
        $line('Frontend source : ' . Support::path((string) ($frontend['source'] ?? '—')));
        $line('Frontend files  : ' . (string) ($frontend['files'] ?? '0') . ' published at ' . (string) ($frontend['published_at'] ?? '—'));
        foreach ((array) ($frontend['entry_files'] ?? []) as $file) {
            $line('  entry: ' . Support::path((string) $file));
        }
        $line('Backend folder  : ' . Support::path((string) ($backend['path'] ?? '—')) . ' (' . (string) ($backend['files'] ?? '0') . ' files)');
        $line('npm install     : ' . (string) (($backend['deps']['message'] ?? '—')));
        $line();

        $rule();
        $line('7. NEXT STEPS');
        $rule();
        $line('1. cPanel → Setup Node.js App: application root = the backend folder above,');
        $line('   startup file = server.js, then press "Restart" (and "Run NPM Install" if it');
        $line('   was not run automatically).');
        $line('2. Open ' . (string) ($app['url'] ?? '') . ' and sign in with the administrator account above.');
        $line('3. Keep installed.lock in place. Delete it only to reinstall.');
        $line('4. Schedule backups of ' . Support::path((string) ($paths['uploads'] ?? '')) . ' and ' . Support::path((string) ($paths['backups'] ?? '')) . '.');
        $line();
        $rule();
        $line('End of report.');
        $rule();

        return implode("\n", $lines) . "\n";
    }

    private static function actionReport(): array
    {
        $report = self::report();
        $paths = self::paths();
        $file = rtrim((string) ($paths['logs'] ?? sys_get_temp_dir()), '/\\') . DIRECTORY_SEPARATOR . 'installer'
            . DIRECTORY_SEPARATOR . 'installation-report-' . date('Ymd-His') . '.txt';
        Support::writeFile($file, $report, 0640);
        State::set(['report_file' => $file]);
        return self::result('report', true, 'pass', 'Installation report generated.', ['report' => $report, 'file' => $file]);
    }
}

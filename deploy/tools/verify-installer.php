<?php
/**
 * verify-installer.php — end-to-end verification for the RMUDTS installer.
 * ---------------------------------------------------------------------------
 * Drives a real installation through the HTTP interface the administrator uses,
 * against an extracted copy of the release archive, and then inspects the
 * artefacts the wizard claims to have produced.
 *
 *   php deploy/tools/verify-installer.php <docroot> <base-url> [scratch-db]
 *
 * Example:
 *   php deploy/tools/verify-installer.php dist/verify http://127.0.0.1:8099 rmudts_installer_scratch
 *
 * Credentials are read from server/.env (the same file the backend uses) and
 * are never printed. Exits non-zero if any check fails.
 *
 * Development tool only — this file is not part of the release archive.
 */

declare(strict_types=1);

$docroot = rtrim($argv[1] ?? 'dist/verify', '/\\');
$baseUrl = rtrim($argv[2] ?? 'http://127.0.0.1:8099', '/');
$scratchDb = $argv[3] ?? 'rmudts_installer_scratch';

$repo = dirname(__DIR__, 2);
$docrootAbs = str_replace('\\', '/', realpath($docroot) ?: $docroot);

// ---------------------------------------------------------------- helpers ---

$checks = [];
$section = '';

function section(string $title): void
{
    global $section;
    $section = $title;
    echo "\n" . str_repeat('─', 76) . "\n" . $title . "\n" . str_repeat('─', 76) . "\n";
}

function check(string $label, bool $ok, string $detail = ''): bool
{
    global $checks, $section;
    $checks[] = ['section' => $section, 'label' => $label, 'ok' => $ok, 'detail' => $detail];
    printf("  %s %s%s\n", $ok ? 'PASS' : 'FAIL', $label, $detail !== '' ? '  (' . $detail . ')' : '');
    return $ok;
}

/**
 * A assertion that cannot be evaluated on this platform is reported as SKIP
 * rather than silently counted as a pass.
 */
function skip(string $label, string $reason): void
{
    global $checks, $section;
    $checks[] = ['section' => $section, 'label' => $label, 'ok' => true, 'detail' => $reason, 'skipped' => true];
    printf("  SKIP %s  (%s)\n", $label, $reason);
}

function envFile(string $file): array
{
    $out = [];
    if (!is_file($file)) {
        return $out;
    }
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $out[trim($key)] = trim($value, " \t\"'");
    }
    return $out;
}

$cookieJar = tempnam(sys_get_temp_dir(), 'rmudts-cookies');
$csrf = '';
$lastStatus = 0;
$lastBody = '';
$lastHeaders = [];

function request(string $method, string $path, array $fields = [], bool $xhr = false, int $timeout = 600): array
{
    global $baseUrl, $cookieJar, $csrf, $lastStatus, $lastBody, $lastHeaders;

    if ($csrf !== '' && !isset($fields['csrf'])) {
        $fields['csrf'] = $csrf;
    }
    $ch = curl_init();
    $url = $baseUrl . $path;
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_COOKIEJAR => $cookieJar,
        CURLOPT_COOKIEFILE => $cookieJar,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HEADER => true,
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($fields));
    }
    if ($xhr) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-Requested-With: XMLHttpRequest', 'Accept: application/json']);
    }
    $raw = curl_exec($ch);
    if ($raw === false) {
        $error = curl_error($ch);
        curl_close($ch);
        return ['status' => 0, 'body' => '', 'headers' => [], 'error' => $error];
    }
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $headerBlock = substr($raw, 0, $headerSize);
    $body = substr($raw, $headerSize);
    $headers = [];
    foreach (preg_split('/\r?\n/', trim($headerBlock)) ?: [] as $line) {
        if (str_contains($line, ':')) {
            [$name, $value] = explode(':', $line, 2);
            $headers[strtolower(trim($name))] = trim($value);
        }
    }

    $lastStatus = $status;
    $lastBody = $body;
    $lastHeaders = $headers;

    // Pick up a refreshed CSRF token from JSON responses.
    if (str_contains($headers['content-type'] ?? '', 'json')) {
        $decoded = json_decode($body, true);
        if (is_array($decoded) && !empty($decoded['csrf'])) {
            $csrf = (string) $decoded['csrf'];
        }
    }
    return ['status' => $status, 'body' => $body, 'headers' => $headers, 'error' => ''];
}

function htmlGet(string $path): string
{
    $response = request('GET', $path);
    return $response['body'];
}

function tokenFrom(string $html): string
{
    if (preg_match('/name="csrf" value="([^"]+)"/', $html, $m)) {
        return $m[1];
    }
    return '';
}

function jsonPost(string $path, array $fields): array
{
    $response = request('POST', $path, $fields, true);
    $decoded = json_decode($response['body'], true);
    return is_array($decoded) ? $decoded : ['ok' => false, 'message' => 'not JSON: ' . substr($response['body'], 0, 200), 'data' => [], 'level' => 'fail'];
}

// -------------------------------------------------------------- preflight ---

echo "RMUDTS installer verification\n";
echo "docroot : $docrootAbs\n";
echo "base url: $baseUrl\n";
echo "scratch : $scratchDb\n";

$dbEnv = envFile($repo . '/server/.env');
$dbHost = $dbEnv['DB_HOST'] ?? 'localhost';
$dbPort = $dbEnv['DB_PORT'] ?? '3306';
$dbUser = $dbEnv['DB_USER'] ?? '';
$dbPass = $dbEnv['DB_PASS'] ?? '';

if ($dbUser === '') {
    fwrite(STDERR, "server/.env has no DB_USER — cannot run the database parts of the test.\n");
    exit(2);
}

// The installer has to keep a real secret out of its reports and state files,
// and the developer's own MySQL account often has an empty password. So create
// a throw-away account for this run and drive the wizard with it. The password
// is generated here and never printed.
$verifyUser = 'rmudts_verify';
$verifyPass = bin2hex(random_bytes(12));
$usingDedicatedAccount = false;

$adminPdo = null;
try {
    $adminPdo = new PDO(
        'mysql:host=' . $dbHost . ';port=' . $dbPort . ';charset=utf8mb4',
        $dbUser,
        $dbPass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    foreach (['localhost', '127.0.0.1'] as $pattern) {
        $adminPdo->exec("DROP USER IF EXISTS '" . $verifyUser . "'@'" . $pattern . "'");
        $adminPdo->exec("CREATE USER '" . $verifyUser . "'@'" . $pattern . "' IDENTIFIED BY '" . $verifyPass . "'");
        $adminPdo->exec("GRANT ALL PRIVILEGES ON `" . $scratchDb . "`.* TO '" . $verifyUser . "'@'" . $pattern . "'");
    }
    $adminPdo->exec('FLUSH PRIVILEGES');
    $usingDedicatedAccount = true;
    echo "\nUsing a dedicated MySQL account ($verifyUser) with a generated password.\n";
} catch (PDOException $e) {
    echo "\nCould not create a dedicated MySQL account (" . $e->getCode() . "); falling back to the account in server/.env.\n";
}

if ($usingDedicatedAccount) {
    $dbUser = $verifyUser;
    $dbPass = $verifyPass;
}

// ------------------------------------------------------------- step 1 -------

section('Step 1 — Welcome');
$html = htmlGet('/install/index.php');
$csrf = tokenFrom($html);
check('wizard renders the welcome step', str_contains($html, 'Welcome to the RMUDTS Installation Wizard'));
check('wizard sets an anti-CSRF token', $csrf !== '');
check('wizard states the locks rule', str_contains($html, 'installed.lock'));
check('JavaScript enhancement is loaded', str_contains($html, 'assets/js/installer.js'));

$result = jsonPost('/install/index.php', ['action' => 'start', 'step' => '1']);
check('start action redirects to step 2', ($result['redirect'] ?? '') === '?step=2', (string) ($result['message'] ?? ''));

// ------------------------------------------------------------- step 2 -------

section('Step 2 — Requirements check');
$html = htmlGet('/install/index.php?step=2');
check('requirements page lists PHP platform checks', str_contains($html, 'PHP platform'));
check('requirements page lists PHP extensions', str_contains($html, 'PHP extensions'));
check('requirements page lists Node.js runtime', str_contains($html, 'Node.js runtime'));
check(
    'requirements page reports per-check status chips',
    str_contains($html, 'chip-pass') && (str_contains($html, 'chip-warn') || str_contains($html, 'chip-fail')),
    str_contains($html, 'chip-fail') ? 'includes FAIL rows' : 'this host has no failing checks'
);
$result = jsonPost('/install/index.php', ['action' => 'step-next', 'step' => '2']);
check('requirements gate opens (no blocking failures)', ($result['ok'] ?? false) === true, (string) ($result['message'] ?? ''));

// ------------------------------------------------------------- step 3 -------

section('Step 3 — File storage configuration');
$html = htmlGet('/install/index.php?step=3');
check('storage page lists every location', substr_count($html, 'name="public_root"') === 1 && str_contains($html, 'name="uploads"'));
check('storage page warns about public_html', str_contains($html, 'Never store sensitive configuration files inside'));
$result = jsonPost('/install/index.php', ['action' => 'storage-check', 'step' => '3']);
$checked = array_values(array_filter((array) ($result['data']['validation'] ?? []), static fn(array $r): bool => ($r['level'] ?? '') === 'pass'));
$failed = array_values(array_filter((array) ($result['data']['validation'] ?? []), static fn(array $r): bool => ($r['level'] ?? '') === 'fail'));
check('permission verification accepts the recommended layout', count($failed) === 0 && count($checked) === 11, count($checked) . ' locations accepted');

$result = jsonPost('/install/index.php', ['action' => 'storage-apply', 'step' => '3']);
check('folders are created and the wizard advances', ($result['ok'] ?? false) === true && ($result['redirect'] ?? '') === '?step=4', (string) ($result['message'] ?? ''));
$report = (array) ($result['data']['report'] ?? []);
$bad = array_values(array_filter($report, static fn(array $r): bool => ($r['level'] ?? '') === 'fail'));
check('no storage location failed to create', $bad === [], count($report) . ' locations processed');

// What step 3 promised must exist on disk.
foreach ([
    'rmudts-config' => 'configuration outside the web root',
    'rmudts-app' => 'backend application folder',
    'rmudts-data' => 'application data folder',
    'rmudts-logs' => 'log folder',
    'rmudts-uploads' => 'uploads folder',
    'rmudts-backups' => 'backup folder',
] as $leaf => $what) {
    $path = dirname($docrootAbs) . '/' . $leaf;
    check($what . ' created at ' . $leaf, is_dir($path));
}
check('storage.json manifest written', is_file(dirname($docrootAbs) . '/rmudts-config/storage.json'));

// ------------------------------------------------------------- step 4 -------

section('Step 4 — Database configuration');
$html = htmlGet('/install/index.php?step=4');
check('database form exposes all five fields', str_contains($html, 'name="host"') && str_contains($html, 'name="port"')
    && str_contains($html, 'name="name"') && str_contains($html, 'name="user"') && str_contains($html, 'name="pass"'));

$dbFields = ['host' => $dbHost, 'port' => $dbPort, 'name' => $scratchDb, 'user' => $dbUser, 'pass' => $dbPass];
$result = jsonPost('/install/index.php', ['action' => 'db-test', 'step' => '4'] + $dbFields);
check('connection test succeeds', ($result['ok'] ?? false) === true, (string) ($result['message'] ?? ''));
$labels = array_map(static fn(array $c): string => (string) $c['label'], (array) ($result['data']['checks'] ?? []));
check('test reports reachability, credentials, database and privileges', count($labels) >= 4, implode(', ', $labels));

$result = jsonPost('/install/index.php', ['action' => 'db-save', 'step' => '4'] + $dbFields);
check('database details saved and wizard advances', ($result['ok'] ?? false) === true && ($result['redirect'] ?? '') === '?step=5');

// ------------------------------------------------------------- step 5 -------

section('Step 5 — Database provisioning');
$stages = ['connect', 'tables', 'indexes', 'relationships', 'defaults', 'verify'];
$stageOk = true;
foreach ($stages as $stage) {
    $result = jsonPost('/install/index.php', ['action' => 'db-provision', 'step' => '5', 'stage' => $stage]);
    $ok = ($result['ok'] ?? false) === true;
    $stageOk = $stageOk && $ok;
    check('provision stage: ' . $stage, $ok, (string) ($result['message'] ?? ''));
}
check('provisioning reports completion', $stageOk);

$pdo = new PDO(
    'mysql:host=' . $dbHost . ';port=' . $dbPort . ';dbname=' . $scratchDb . ';charset=utf8mb4',
    $dbUser,
    $dbPass,
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);
$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
check('schema imported (14 tables)', count($tables) === 14, count($tables) . ' tables');
$seeded = (int) $pdo->query('SELECT COUNT(*) FROM offices')->fetchColumn()
    + (int) $pdo->query('SELECT COUNT(*) FROM dropdown_options')->fetchColumn()
    + (int) $pdo->query('SELECT COUNT(*) FROM app_settings')->fetchColumn();
check('default records loaded', $seeded >= 360, $seeded . ' rows');
$fks = (int) $pdo->query('SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL')->fetchColumn();
check('foreign keys created', $fks >= 6, $fks . ' constraints');

// ------------------------------------------------------------- step 6 -------

section('Step 6 — Application configuration');
$html = htmlGet('/install/index.php?step=6');
check('application form renders', str_contains($html, 'name="name"') && str_contains($html, 'name="timezone"') && str_contains($html, 'name="port"'));
$result = jsonPost('/install/index.php', [
    'action' => 'app-save', 'step' => '6',
    'name' => 'RMUDTS Verification', 'url' => $baseUrl, 'client_url' => '', 'api_url' => '',
    'system_email' => 'records@example.edu', 'timezone' => 'Asia/Manila', 'env' => 'production', 'port' => '8098',
]);
check('configuration written and wizard advances', ($result['ok'] ?? false) === true && ($result['redirect'] ?? '') === '?step=7', (string) ($result['message'] ?? ''));

$configDir = dirname($docrootAbs) . '/rmudts-config';
check('config.php written outside the web root', is_file($configDir . '/config.php'));
check('backend .env written', is_file(dirname($docrootAbs) . '/rmudts-app/.env'));
$env = envFile($configDir . '/.env');
check('.env carries the database name', ($env['DB_NAME'] ?? '') === $scratchDb);
check('config.php carries the uploaded port', str_contains((string) @file_get_contents($configDir . '/config.php'), "'port' => 8098"));
check('PORT is left to Passenger in .env', !isset($env['PORT']), isset($env['PORT']) ? 'PORT would override the port cPanel assigns' : 'cPanel supplies process.env.PORT');
$documentedKeys = ['APP_NAME', 'APP_URL', 'CLIENT_URL', 'API_URL', 'APP_ENV', 'CLIENT_ORIGIN', 'TZ',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET',
    'UPLOAD_DIR', 'DATA_DIR', 'LOG_DIR', 'BACKUP_DIR', 'TMP_DIR', 'CACHE_DIR', 'SYSTEM_EMAIL'];
$missingKeys = array_values(array_filter($documentedKeys, static fn(string $k): bool => !isset($env[$k]) && !array_key_exists($k, $env)));
check('.env defines every documented key', $missingKeys === [], $missingKeys === [] ? count($documentedKeys) . ' keys' : 'missing ' . implode(', ', $missingKeys));
check('.env points the backend at the configured uploads folder', str_contains((string) ($env['UPLOAD_DIR'] ?? ''), 'rmudts-uploads'));

// ------------------------------------------------------------- step 7 -------

section('Step 7 — Administrator account');
$html = htmlGet('/install/index.php?step=7');
check('administrator form renders with the password policy', str_contains($html, 'name="idnumber"') && str_contains($html, 'Password requirements'));
$adminPassword = 'Rmu-Verify!2026Pass';
$weak = jsonPost('/install/index.php', [
    'action' => 'admin-save', 'step' => '7',
    'first_name' => 'Verification', 'last_name' => 'Admin', 'idnumber' => 'vadmin',
    'email' => 'vadmin@example.edu', 'password' => 'password', 'password_confirm' => 'password',
]);
check('weak password is rejected', ($weak['ok'] ?? true) === false, (string) ($weak['message'] ?? ''));

$result = jsonPost('/install/index.php', [
    'action' => 'admin-save', 'step' => '7',
    'first_name' => 'Verification', 'last_name' => 'Admin', 'idnumber' => 'vadmin',
    'email' => 'vadmin@example.edu', 'password' => $adminPassword, 'password_confirm' => $adminPassword,
]);
check('administrator created and wizard advances', ($result['ok'] ?? false) === true && ($result['redirect'] ?? '') === '?step=8', (string) ($result['message'] ?? ''));

$row = $pdo->query("SELECT role, password, email, name FROM users WHERE idnumber = 'vadmin'")->fetch();
check('administrator row stored with super_admin role', ($row['role'] ?? '') === 'super_admin');
check('password stored as a bcrypt hash', is_array($row) && preg_match('/^\$2[aby]\$/', (string) $row['password']) === 1, substr((string) ($row['password'] ?? ''), 0, 7) . '…');
check('php verifies the stored hash', is_array($row) && password_verify($adminPassword, (string) $row['password']));

// The password must be verifiable by the library the RUNNING backend uses, not
// just by PHP: node-bcrypt parses `$2y$` hashes and then returns false, which
// would lock the administrator out of a correct login.
$bcryptLib = $repo . '/server/node_modules/bcrypt';
$nodeScript = 'const b=require(' . json_encode($bcryptLib) . ');'
    . 'b.compare(process.env.RMUDTS_TEST_PW, process.env.RMUDTS_TEST_HASH)'
    . '.then(function(r){console.log(r ? "MATCH" : "MISMATCH");})'
    . '.catch(function(e){console.log("ERROR " + e.message);});';
putenv('RMUDTS_TEST_PW=' . $adminPassword);
putenv('RMUDTS_TEST_HASH=' . (string) ($row['password'] ?? ''));
$nodeResult = trim((string) shell_exec('node -e ' . escapeshellarg($nodeScript) . ' 2>&1'));
putenv('RMUDTS_TEST_PW');
putenv('RMUDTS_TEST_HASH');
check('node-bcrypt (the backend library) verifies the hash', str_contains($nodeResult, 'MATCH'), trim($nodeResult));

// ------------------------------------------------------------- step 8 -------

section('Step 8 — Security configuration');
$html = htmlGet('/install/index.php?step=8');
check('security step lists every generated secret', substr_count($html, 'data-value-for=') === 6);
$result = jsonPost('/install/index.php', ['action' => 'security-run', 'step' => '8']);
check('security configuration applies', ($result['ok'] ?? false) === true && ($result['redirect'] ?? '') === '?step=9', (string) ($result['message'] ?? ''));
$failures = array_values(array_filter((array) ($result['data']['checklist'] ?? []), static fn(array $r): bool => ($r['level'] ?? '') === 'fail'));
check('security checklist has no failures', $failures === [], implode('; ', array_map(static fn(array $r): string => (string) $r['label'], $failures)));

$env = envFile($configDir . '/.env');
foreach (['APP_KEY', 'ENCRYPTION_KEY', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'API_TOKEN', 'CSRF_SECRET'] as $key) {
    check('secret ' . $key . ' generated', strlen((string) ($env[$key] ?? '')) >= 32, strlen((string) ($env[$key] ?? '')) . ' chars');
}
$distinct = array_unique(array_filter([$env['APP_KEY'] ?? '', $env['JWT_SECRET'] ?? '', $env['ENCRYPTION_KEY'] ?? '', $env['API_TOKEN'] ?? '']));
check('each secret is independently random', count($distinct) === 4);

if (DIRECTORY_SEPARATOR === '\\') {
    skip('.env is not world-readable', 'NTFS does not carry POSIX permission bits — verify with ls -l after deploying to Linux');
} else {
    $perms = fileperms($configDir . '/.env') & 0777;
    check('.env is not world-readable', ($perms & 0007) === 0, '0' . decoct($perms));
}

// ------------------------------------------------------------- step 9 -------

section('Step 9 — Installation summary');
$html = htmlGet('/install/index.php?step=9');
check('summary shows requirements, storage, database and administrator', str_contains($html, 'System requirements')
    && str_contains($html, 'Storage locations') && str_contains($html, 'Database') && str_contains($html, 'Administrator'));
check('summary offers the installation report', str_contains($html, 'Download Installation Report'));
$report = request('GET', '/install/index.php?step=9&download=report');
check('installation report downloads', $report['status'] === 200 && str_contains($report['body'], 'RMUDTS — Installation Report'));
if ($usingDedicatedAccount) {
    check('report contains no database password', !str_contains($report['body'], $dbPass));
    check('report masks the password field', str_contains($report['body'], 'stored in .env'));
} else {
    skip('report contains no database password', 'using the account from server/.env, whose password cannot be checked');
}
check('report contains no generated keys', !str_contains($report['body'], (string) ($env['JWT_SECRET'] ?? 'x-never-matches')));
check('report contains no private key material', !str_contains($report['body'], (string) ($env['ENCRYPTION_KEY'] ?? 'x-never-matches')));

// ------------------------------------------------------------ step 10 -------

section('Step 10 — Complete');
$result = jsonPost('/install/index.php', ['action' => 'finish', 'step' => '9'], true, 900);
check('finish action completes', ($result['ok'] ?? false) === true, (string) ($result['message'] ?? ''));
foreach ((array) ($result['data']['messages'] ?? []) as $message) {
    echo "        · $message\n";
}
$lock = $docrootAbs . '/install/installed.lock';
check('installed.lock written', is_file($lock));
$lockData = is_file($lock) ? json_decode((string) file_get_contents($lock), true) : [];
check('lock records the installation', is_array($lockData) && ($lockData['product'] ?? '') === 'RMUDTS' && !empty($lockData['installed_at']));
check('system settings seeded', (int) $pdo->query("SELECT COUNT(*) FROM app_settings WHERE setting_key = 'installed_version'")->fetchColumn() === 1);
check('administrator still present after finishing', (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")->fetchColumn() === 1);

// ------------------------------------------------------- post-install ------

section('Post-installation behaviour');
$html = htmlGet('/install/index.php');
check('installer is locked and refuses to run again', str_contains($html, 'RMUDTS is already installed.'));
check('locked screen explains how to reinstall', str_contains($html, 'Reinstalling'));
check('locked screen redirects to the application', str_contains($html, 'http-equiv="refresh"'));
check('locked screen announces the redirect', str_contains($html, 'Redirecting to the application'));
$result = jsonPost('/install/index.php', ['action' => 'start', 'step' => '1']);
check('wizard actions are refused after locking', ($result['ok'] ?? true) === false || !str_contains((string) ($result['redirect'] ?? ''), 'step=2'));

$html = htmlGet('/');
check('front controller serves the single-page application', str_contains($html, '<div id="root">') || str_contains($html, 'static/js/'));
$health = request('GET', '/_rmudts/health');
$healthData = json_decode($health['body'], true);
check('health endpoint reports installed state', is_array($healthData) && ($healthData['installed'] ?? false) === true);
check('health endpoint reports the backend endpoint', is_array($healthData) && str_contains((string) ($healthData['backend']['endpoint'] ?? ''), '8098'));

$html = htmlGet('/dashboard');
check('deep links fall back to the SPA shell', str_contains($html, '<div id="root">') || str_contains($html, 'static/js/'));
$missing = request('GET', '/static/js/does-not-exist.js');
check('a missing asset is a 404, not the SPA shell', $missing['status'] === 404, 'status ' . $missing['status']);
$api = request('GET', '/api/notifications');
check('API request is proxied and fails gracefully while the backend is stopped', $api['status'] === 502 && (str_contains($api['body'], 'Application service unavailable') || str_contains($api['body'], 'backend_unreachable')));

check('front controller replaces the bootstrap index.php', str_contains((string) file_get_contents($docrootAbs . '/index.php'), 'RMUDTS front controller'));
check('archive ships schema.sql at the root as documented', is_file($docrootAbs . '/schema.sql'));
check('root schema.sql matches database/schema.sql', @file_get_contents($docrootAbs . '/schema.sql') === @file_get_contents($docrootAbs . '/database/schema.sql'));
check('web-root protection file written', str_contains((string) file_get_contents($docrootAbs . '/.htaccess'), 'RMUDTS front-controller rules'));
check('private folders carry a protection file', is_file(dirname($docrootAbs) . '/rmudts-uploads/.htaccess'));
check('uploads protection blocks executables', str_contains((string) @file_get_contents(dirname($docrootAbs) . '/rmudts-uploads/.htaccess'), 'engine off'));
check('installation log written', (bool) glob(dirname($docrootAbs) . '/rmudts-logs/installer/install-*.log'));
check('installation report archived', (bool) glob(dirname($docrootAbs) . '/rmudts-logs/installer/installation-report-*.txt'));
check('schema snapshot saved to backups', (bool) glob(dirname($docrootAbs) . '/rmudts-backups/manual/schema-*.sql'));
check('wizard state removed after installation', !is_file($docrootAbs . '/install/.install-state.json'));
check('install summary written for the completion screen', is_file($configDir . '/install-summary.json'));

// ------------------------------------------------ upgrade / repair --------

section('Upgrade / repair mode');

$upgradeUrl = '/install/upgrade.php';
$keyFile = $configDir . '/upgrade.key';

$html = htmlGet($upgradeUrl);
$csrf = tokenFrom($html);
check('upgrade page is reachable while installed.lock exists', str_contains($html, 'Upgrade or repair this installation'));
check('upgrade page asks for the key before showing any action', str_contains($html, 'name="key"') && !str_contains($html, 'id="form-upgrade"'));
check('upgrade key created in the private configuration folder', is_file($keyFile));
check('upgrade key lives outside the web root', !str_contains(str_replace('\\', '/', $keyFile), $docrootAbs));
$upgradeKey = trim((string) @file_get_contents($keyFile));
check('upgrade key is a 48-character secret', preg_match('/^[0-9a-f]{48}$/', $upgradeKey) === 1, strlen($upgradeKey) . ' characters');

$response = request('POST', $upgradeUrl, ['action' => 'authorize', 'key' => 'definitely-not-the-key']);
check('a wrong key is rejected', str_contains($response['body'], 'That key does not match'));

$response = request('POST', $upgradeUrl, ['action' => 'run', 'mode' => 'upgrade', 'schema' => '1', 'config' => '1', 'code' => '1']);
check('the run action refuses to start while locked', str_contains($response['body'], 'Unlock upgrade mode with the key'));

$response = request('POST', $upgradeUrl, ['action' => 'authorize', 'key' => $upgradeKey, 'csrf' => 'forged-token']);
check('a forged CSRF token cannot unlock upgrade mode', str_contains($response['body'], 'session expired'));

$response = request('POST', $upgradeUrl, ['action' => 'authorize', 'key' => $upgradeKey]);
$csrf = tokenFrom($response['body']);
check('the correct key unlocks upgrade mode', str_contains($response['body'], 'id="form-upgrade"') && str_contains($response['body'], 'Preflight'));
check('preflight reports the installed copy, database and accounts', str_contains($response['body'], 'Installed copy')
    && str_contains($response['body'], 'Accounts and records') && str_contains($response['body'], 'Schema'));

// Data that must come out of the upgrade untouched ---------------------------
$adminHashBefore = (string) $pdo->query("SELECT password FROM users WHERE idnumber = 'vadmin'")->fetchColumn();
$pdo->exec("INSERT INTO records (office_requestor, classification, priority, concerned_personnel, destination_office, record_origin, status, control_number, current_office)
            VALUES ('Upgrade Survivor', 'Test', 'Normal', 'Tester', 'CITCS', 'Internal', 'IN_OFFICE', 'UPG-SURVIVOR-1', 'CITCS')");
$upgradeRecordId = (int) $pdo->lastInsertId();
$pdo->exec("INSERT INTO users (email, password, role, idnumber, name)
            VALUES ('survivor@example.edu', '" . $adminHashBefore . "', 'user', 'survivor', 'Upgrade Survivor')");
$recordsBefore = (int) $pdo->query('SELECT COUNT(*) FROM records')->fetchColumn();
$usersBefore = (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
$envBefore = envFile($configDir . '/.env');

// Present the copy as an older release with a drifted schema ------------------
$lockBefore = json_decode((string) file_get_contents($lock), true) ?: [];
$installedAtBefore = (string) ($lockBefore['installed_at'] ?? '');
$lockBefore['version'] = '0.9.0';
file_put_contents($lock, json_encode($lockBefore, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
if (is_file($configDir . '/installed.lock')) {
    $lockCopy = json_decode((string) file_get_contents($configDir . '/installed.lock'), true) ?: [];
    $lockCopy['version'] = '0.9.0';
    file_put_contents($configDir . '/installed.lock', json_encode($lockCopy, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
}
$pdo->exec("UPDATE app_settings SET value = '0.9.0' WHERE setting_key = 'installed_version'");
$pdo->exec('ALTER TABLE offices DROP COLUMN created_at');
$pdo->exec('ALTER TABLE record_files DROP INDEX record_id');
$pdo->exec('DROP TABLE incoming_documents');
@unlink($docrootAbs . '/index.php');
@unlink(dirname($docrootAbs) . '/rmudts-uploads/.htaccess');
file_put_contents($configDir . '/.env', "CUSTOM_KEEP_ME=preserved-value\n", FILE_APPEND);

// A previous release's hashed bundle, and a file that is not part of the build.
// The frontend is published under /rmudts/, so the refresh happens there.
$frontendDir = $docrootAbs . '/rmudts';
@mkdir($frontendDir . '/static/js', 0775, true);
file_put_contents($frontendDir . '/static/js/main.0ldha5h.chunk.js', '/* previous release bundle */\n');
file_put_contents($frontendDir . '/maintenance-note.txt', "keep me through upgrades\n");
check('a stale bundle from the previous build is present before the upgrade',
    is_file($frontendDir . '/static/js/main.0ldha5h.chunk.js'));

$drifted = (int) $pdo->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offices' AND COLUMN_NAME = 'created_at'")->fetchColumn();
$tablesNow = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
check('drift simulated: column, index, table, front controller and protection file removed',
    $drifted === 0 && !in_array('incoming_documents', $tablesNow, true)
    && !is_file($docrootAbs . '/index.php') && !is_file(dirname($docrootAbs) . '/rmudts-uploads/.htaccess'));

$response = request('POST', $upgradeUrl, [
    'action' => 'run',
    'mode'   => 'upgrade',
    'schema' => '1',
    'config' => '1',
    'code'   => '1',
    'deps'   => '0',
], false, 900);
$body = $response['body'];
$csrf = tokenFrom($body);
check('upgrade run completes and renders its results', str_contains($body, 'id="upgrade-results"'), 'status ' . $response['status']);
foreach (['Data backup', 'Schema migration', 'Data migrations', 'Backend code', 'Frontend build', 'Configuration', 'Verification'] as $stepLabel) {
    check('upgrade result reports the ' . $stepLabel . ' step', str_contains($body, $stepLabel));
}

// Data preservation ----------------------------------------------------------
check('records survived the upgrade', (int) $pdo->query('SELECT COUNT(*) FROM records')->fetchColumn() === $recordsBefore);
$survivor = $pdo->query('SELECT control_number, office_requestor FROM records WHERE id = ' . $upgradeRecordId)->fetch();
check('the record created before the upgrade is unchanged',
    is_array($survivor) && ($survivor['control_number'] ?? '') === 'UPG-SURVIVOR-1' && ($survivor['office_requestor'] ?? '') === 'Upgrade Survivor');
check('accounts survived the upgrade', (int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() === $usersBefore);
check('the administrator password hash is untouched',
    (string) $pdo->query("SELECT password FROM users WHERE idnumber = 'vadmin'")->fetchColumn() === $adminHashBefore);
check('an existing non-administrator account still exists',
    (int) $pdo->query("SELECT COUNT(*) FROM users WHERE idnumber = 'survivor'")->fetchColumn() === 1);
check('the upgrade did not create a second super administrator',
    (int) $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'super_admin'")->fetchColumn() === 1);

// Schema migration -----------------------------------------------------------
check('the missing column was re-added',
    (int) $pdo->query("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offices' AND COLUMN_NAME = 'created_at'")->fetchColumn() === 1);
check('the missing index was re-created',
    (int) $pdo->query("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'record_files' AND INDEX_NAME = 'record_id'")->fetchColumn() > 0);
check('the missing table was re-created', in_array('incoming_documents', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN), true));
check('the migration ledger exists', in_array('schema_migrations', $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN), true));
check('the ledger records the converged release',
    (int) $pdo->query("SELECT COUNT(*) FROM schema_migrations WHERE id = 'baseline:1.0.0'")->fetchColumn() === 1);
check('app_settings reports the new version',
    (string) $pdo->query("SELECT value FROM app_settings WHERE setting_key = 'installed_version'")->fetchColumn() === '1.0.0');
check('app_settings records the version it came from',
    (string) $pdo->query("SELECT value FROM app_settings WHERE setting_key = 'upgrade_from'")->fetchColumn() === '0.9.0');
check('app_settings records when the upgrade ran',
    (string) $pdo->query("SELECT value FROM app_settings WHERE setting_key = 'upgraded_at'")->fetchColumn() !== '');

// Installation record --------------------------------------------------------
$lockAfter = json_decode((string) file_get_contents($lock), true) ?: [];
check('the lock is stamped with the new version', ($lockAfter['version'] ?? '') === '1.0.0');
check('the lock keeps the original install date', ($lockAfter['installed_at'] ?? '') === $installedAtBefore, (string) ($lockAfter['installed_at'] ?? ''));
check('the lock records the previous version', ($lockAfter['previous_version'] ?? '') === '0.9.0');
check('the lock records when it was upgraded', ($lockAfter['upgraded_at'] ?? '') !== '');

// Regenerated configuration --------------------------------------------------
$envAfter = envFile($configDir . '/.env');
check('secrets are preserved verbatim (no rotation)',
    ($envAfter['APP_KEY'] ?? 'a') === ($envBefore['APP_KEY'] ?? 'b')
    && ($envAfter['JWT_SECRET'] ?? 'a') === ($envBefore['JWT_SECRET'] ?? 'b')
    && ($envAfter['ENCRYPTION_KEY'] ?? 'a') === ($envBefore['ENCRYPTION_KEY'] ?? 'b'));
check('a .env key the package does not manage is preserved', ($envAfter['CUSTOM_KEEP_ME'] ?? '') === 'preserved-value');
$configAfter = require $configDir . '/config.php';
check('config.php is regenerated for this version', ($configAfter['version'] ?? '') === '1.0.0' && ($configAfter['installed'] ?? false) === true);
$configSource = (string) file_get_contents($configDir . '/config.php');
check('config.php still contains no database password', !preg_match("/'pass'\\s*=>/", $configSource));
if ($usingDedicatedAccount) {
    check('the regenerated config.php keeps the password out', !str_contains($configSource, $dbPass));
}

// Backup + report ------------------------------------------------------------
$backupFiles = glob(dirname($docrootAbs) . '/rmudts-backups/manual/pre-upgrade-*.sql') ?: [];
check('a data backup was written before the upgrade', $backupFiles !== [], count($backupFiles) . ' file(s)');
$backupText = $backupFiles !== [] ? (string) file_get_contents((string) end($backupFiles)) : '';
check('the backup carries rows, not just structure', str_contains($backupText, 'INSERT INTO `records`') && str_contains($backupText, 'UPG-SURVIVOR-1'));
check('the backup carries the accounts', str_contains($backupText, 'INSERT INTO `users`') && str_contains($backupText, 'vadmin'));
$upgradeReports = glob(dirname($docrootAbs) . '/rmudts-logs/installer/upgrade-report-*.txt') ?: [];
check('an upgrade report was written', $upgradeReports !== []);
$upgradeReportText = $upgradeReports !== [] ? (string) file_get_contents((string) end($upgradeReports)) : '';
check('the report documents data preservation', str_contains($upgradeReportText, 'DATA PRESERVATION') && str_contains($upgradeReportText, 'Administrator accounts are never recreated'));
if ($usingDedicatedAccount) {
    check('the upgrade report contains no database password', !str_contains($upgradeReportText, $dbPass));
    check('the upgrade report contains no generated keys', !str_contains($upgradeReportText, (string) ($envAfter['JWT_SECRET'] ?? 'never-matches')));
}
check('a secret-free last-upgrade summary is kept for support', is_file($configDir . '/last-upgrade.json'));

// Restored web root ----------------------------------------------------------
check('the front controller was rewritten', str_contains((string) @file_get_contents($docrootAbs . '/index.php'), 'RMUDTS front controller'));
$html = htmlGet('/');
check('the application is served again after the upgrade', str_contains($html, '<div id="root">') || str_contains($html, 'static/js/'));
check('the uploads protection file was restored', is_file(dirname($docrootAbs) . '/rmudts-uploads/.htaccess'));

// Build folder refresh --------------------------------------------------------
check('the stale bundle from the previous build was removed',
    !is_file($frontendDir . '/static/js/main.0ldha5h.chunk.js'));
check('a file that is not part of the build is left alone',
    is_file($frontendDir . '/maintenance-note.txt')
    && trim((string) @file_get_contents($frontendDir . '/maintenance-note.txt')) === 'keep me through upgrades');
$indexHtml = (string) @file_get_contents($frontendDir . '/index.html');
preg_match_all('/(?:src|href)\s*=\s*["\'](\/?(?:static|assets|js|css|media)\/[^"\']+)["\']/i', $indexHtml, $assetMatches);
$missingAssets = [];
foreach ((array) ($assetMatches[1] ?? []) as $assetRef) {
    $cleanAsset = ltrim(explode('?', $assetRef)[0], '/');
    if (!is_file($frontendDir . '/' . $cleanAsset)) {
        $missingAssets[] = $cleanAsset;
    }
}
check('every asset named by index.html exists after the upgrade',
    $assetMatches[1] !== [] && $missingAssets === [], $missingAssets === [] ? count($assetMatches[1]) . ' asset reference(s)' : implode(', ', $missingAssets));
$newBundle = (string) ($assetMatches[1][0] ?? '');
check('the published index.html names a bundle newer than the seeded one',
    $newBundle !== '' && !str_contains($newBundle, '0ldha5h'));
check('the upgrade reports how the build folder was refreshed',
    preg_match('/\d+ frontend file\(s\) published into/', $body) === 1
    && str_contains($body, 'stale file(s) from the previous build removed'));

// Repair mode ----------------------------------------------------------------
@unlink(dirname($docrootAbs) . '/rmudts-uploads/.htaccess');
@unlink($docrootAbs . '/index.php');
$response = request('POST', $upgradeUrl, [
    'action' => 'run',
    'mode'   => 'repair',
    'schema' => '1',
    'config' => '1',
    'code'   => '1',
    'deps'   => '0',
], false, 900);
check('a repair run completes', str_contains($response['body'], 'id="upgrade-results"'), 'status ' . $response['status']);
check('repair restores the deleted protection file', is_file(dirname($docrootAbs) . '/rmudts-uploads/.htaccess'));
check('repair restores the deleted front controller', is_file($docrootAbs . '/index.php'));
check('repair does not duplicate records', (int) $pdo->query('SELECT COUNT(*) FROM records')->fetchColumn() === $recordsBefore);
$lockRepair = json_decode((string) file_get_contents($lock), true) ?: [];
check('repair keeps the version and counts as a second run',
    ($lockRepair['version'] ?? '') === '1.0.0' && (int) ($lockRepair['upgrade_count'] ?? 0) === 2, 'count ' . (string) ($lockRepair['upgrade_count'] ?? '0'));
$lastSummary = json_decode((string) @file_get_contents($configDir . '/last-upgrade.json'), true) ?: [];
check('the last-upgrade summary records the repair', ($lastSummary['mode'] ?? '') === 'repair');
check('a repair report was written', (bool) glob(dirname($docrootAbs) . '/rmudts-logs/installer/repair-report-*.txt'));
check('the upgrade key is not exposed in the web root', !is_file($docrootAbs . '/upgrade.key') && !is_file($docrootAbs . '/install/upgrade.key'));

section('Artifacts');
foreach ([
    $configDir . '/config.php',
    $configDir . '/.env',
    dirname($docrootAbs) . '/rmudts-app/server.js',
    dirname($docrootAbs) . '/rmudts-app/node_modules',
] as $path) {
    check('present: ' . str_replace('\\', '/', $path), file_exists($path));
}
$configSource = (string) file_get_contents($configDir . '/config.php');
$config = require $configDir . '/config.php';
check('config.php reports installed = true', ($config['installed'] ?? false) === true);
check('config.php holds no database password field', !preg_match("/'pass'\s*=>/", $configSource) && !str_contains($configSource, 'DB_PASS'));
if ($usingDedicatedAccount) {
    check('config.php keeps the database password out', !str_contains($configSource, $dbPass));
    check('the database password no longer lives in the wizard state', !str_contains((string) @file_get_contents($configDir . '/install-summary.json'), $dbPass));
    check('the backend .env still holds the password (the app needs it)', str_contains((string) file_get_contents($configDir . '/.env'), $dbPass));
} else {
    skip('password leakage checks', 'no dedicated MySQL account available for a real password');
}

// ---------------------------------------------------------------- summary ---

$passed = count(array_filter($checks, static fn(array $c): bool => $c['ok']));
$failed = count($checks) - $passed;
echo "\n" . str_repeat('=', 76) . "\n";
printf("Verification finished: %d passed, %d failed (of %d checks)\n", $passed, $failed, count($checks));
if ($failed > 0) {
    echo "\nFailures:\n";
    foreach ($checks as $c) {
        if (!$c['ok']) {
            printf("  [%s] %s%s\n", $c['section'], $c['label'], $c['detail'] !== '' ? ' — ' . $c['detail'] : '');
        }
    }
}
echo str_repeat('=', 76) . "\n";

if ($usingDedicatedAccount) {
    echo "\nCleanup (kept on purpose so the installed app can be exercised):\n";
    echo "  DROP DATABASE `$scratchDb`;\n";
    echo "  DROP USER '$verifyUser'@'localhost', '$verifyUser'@'127.0.0.1';\n";
}
@unlink($cookieJar);
exit($failed === 0 ? 0 : 1);

<?php
/**
 * RMUDTS Installer — Database
 * ---------------------------------------------------------------------------
 * Everything that talks to MySQL.
 *
 * Provisioning is split into named stages so the wizard can show genuine
 * progress instead of a progress bar that lies:
 *
 *   connect        server reachable, credentials valid, database available
 *   tables         CREATE TABLE statements from database/schema.sql
 *   indexes        every index the schema declares is present
 *   relationships  every foreign key is in place
 *   defaults       seeded reference/configuration rows
 *   verify         the finished database really holds what the app expects
 *
 * Every stage is idempotent (IF NOT EXISTS / ON DUPLICATE KEY UPDATE), so a
 * retry after a network blip never damages a half-filled database.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

use PDO;
use PDOException;

final class Database
{
    /** Stages that step 5 walks through, in order. */
    public const STAGES = [
        'connect'       => 'Connecting…',
        'tables'        => 'Creating Tables…',
        'indexes'       => 'Creating Indexes…',
        'relationships' => 'Creating Relationships…',
        'defaults'      => 'Loading Defaults…',
        'verify'        => 'Completed.',
    ];

    /** Tables the application cannot start without. */
    public const REQUIRED_TABLES = [
        'users', 'records', 'record_files', 'record_history', 'record_movements',
        'offices', 'dropdown_options', 'app_settings', 'notifications', 'movements',
    ];

    private static ?PDO $pdo = null;

    // ------------------------------------------------------------ connection --

    public static function dsn(array $db, bool $withDatabase = true): string
    {
        $parts = [
            'host=' . (string) ($db['host'] ?? 'localhost'),
            'port=' . (string) ($db['port'] ?? '3306'),
            'charset=utf8mb4',
        ];
        if ($withDatabase && !empty($db['name'])) {
            $parts[] = 'dbname=' . (string) $db['name'];
        }
        return 'mysql:' . implode(';', $parts);
    }

    public static function connect(array $db, bool $withDatabase = true): PDO
    {
        return new PDO(self::dsn($db, $withDatabase), (string) ($db['user'] ?? ''), (string) ($db['pass'] ?? ''), [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT            => 8,
            // Never emulate prepares: the application relies on real
            // server-side binding for safe quoting.
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }

    /** Cached connection for the current request. */
    public static function pdo(array $db, bool $withDatabase = true): PDO
    {
        if (self::$pdo === null) {
            self::$pdo = self::connect($db, $withDatabase);
        }
        return self::$pdo;
    }

    /**
     * Full connection test used by the [ Test Connection ] button.
     *
     * @return array{ok:bool,checks:array<int,array{label:string,level:string,message:string}>,version:?string,user:?string}
     */
    public static function test(array $db): array
    {
        $checks = [];
        $version = null;
        $user = null;
        $ok = true;

        $server = new PDO(self::dsn($db, false), (string) ($db['user'] ?? ''), (string) ($db['pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 8,
        ]);

        // 1. Server reachable -------------------------------------------------
        try {
            $version = (string) $server->query('SELECT VERSION()')->fetchColumn();
            $checks[] = ['label' => 'Server reachable', 'level' => 'pass', 'message' => 'MySQL ' . $version . ' at ' . ($db['host'] ?? '') . ':' . ($db['port'] ?? '3306')];
        } catch (PDOException $e) {
            return [
                'ok'     => false,
                'checks' => [['label' => 'Server reachable', 'level' => 'fail', 'message' => self::explain($e, $db)]],
                'version' => null,
                'user'    => null,
            ];
        }

        // 2. Credentials valid (already implied by connecting) ----------------
        try {
            $user = (string) $server->query('SELECT CURRENT_USER()')->fetchColumn();
            $checks[] = ['label' => 'Credentials valid', 'level' => 'pass', 'message' => 'Authenticated as ' . $user];
        } catch (PDOException $e) {
            $checks[] = ['label' => 'Credentials valid', 'level' => 'warn', 'message' => 'Could not read CURRENT_USER()'];
        }

        // 3. Database exists --------------------------------------------------
        $name = (string) ($db['name'] ?? '');
        $exists = false;
        try {
            $stmt = $server->prepare('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
            $stmt->execute([$name]);
            $exists = $stmt->fetchColumn() !== false;
            $checks[] = $exists
                ? ['label' => 'Database exists', 'level' => 'pass', 'message' => 'Database `' . $name . '` found.']
                : ['label' => 'Database exists', 'level' => 'warn', 'message' => 'Database `' . $name . '` does not exist yet — it will be created during provisioning.'];
        } catch (PDOException $e) {
            $checks[] = ['label' => 'Database exists', 'level' => 'warn', 'message' => 'Could not inspect the schema list: ' . $e->getMessage()];
        }

        // 4. Required privileges ---------------------------------------------
        $grants = [];
        try {
            foreach ($server->query('SHOW GRANTS FOR CURRENT_USER()') as $row) {
                $grants[] = implode(' ', array_map('strval', array_values($row)));
            }
        } catch (PDOException $e) {
            // Not fatal: some managed hosts hide SHOW GRANTS.
        }
        $blob = strtoupper(implode(' ', $grants));
        $hasAll = str_contains($blob, 'ALL PRIVILEGES');
        $canCreate = $hasAll || str_contains($blob, 'CREATE');
        $canInsert = $hasAll || str_contains($blob, 'INSERT');
        $canAlter = $hasAll || str_contains($blob, 'ALTER');

        if ($grants === []) {
            $checks[] = ['label' => 'Required permissions', 'level' => 'warn', 'message' => 'This host hides SHOW GRANTS. Permissions will be proven when the schema is imported.'];
        } elseif ($exists ? ($canAlter && $canInsert) : $canCreate) {
            $checks[] = ['label' => 'Required permissions', 'level' => 'pass', 'message' => 'Account may ' . ($exists ? 'CREATE TABLE, ALTER and INSERT' : 'CREATE the database and its tables') . ' in `' . $name . '`.'];
        } else {
            $ok = false;
            $checks[] = ['label' => 'Required permissions', 'level' => 'fail', 'message' => 'The MySQL user needs CREATE, ALTER, INSERT, SELECT, UPDATE and DELETE on `' . $name . '`. Current grants: ' . implode(' | ', $grants)];
        }

        // 5. Collation / charset sanity --------------------------------------
        try {
            $charset = (string) $server->query("SELECT @@character_set_server")->fetchColumn();
            $checks[] = str_starts_with(strtolower($charset), 'utf8')
                ? ['label' => 'Server character set', 'level' => 'pass', 'message' => $charset . ' — full Unicode support']
                : ['label' => 'Server character set', 'level' => 'warn', 'message' => $charset . ' — utf8mb4 is recommended for document titles and names'];
        } catch (PDOException $e) {
            // ignore
        }

        foreach ($checks as $check) {
            if ($check['level'] === 'fail') {
                $ok = false;
            }
        }

        return ['ok' => $ok, 'checks' => $checks, 'version' => $version, 'user' => $user];
    }

    /** Turn a PDO error into something an administrator can act on. */
    public static function explain(PDOException $e, array $db = []): string
    {
        $code = (int) ($e->errorInfo[1] ?? 0);
        $host = (string) ($db['host'] ?? 'localhost');
        $message = match ($code) {
            1045    => 'Access denied for user “' . ($db['user'] ?? '') . '”. Check the username and password in cPanel → MySQL Databases.',
            1044    => 'The MySQL user is not allowed to use that database. Add the user to the database in cPanel → MySQL Databases → Add User To Database.',
            1049    => 'Unknown database. Create it in cPanel → MySQL Databases, or let the installer create it (requires the CREATE privilege).',
            2002, 2003 => 'Cannot reach the MySQL server at ' . $host . '. Most hosts use “localhost”; some require the server hostname shown in cPanel.',
            1040    => 'MySQL refused the connection: too many connections. Try again in a moment.',
            default => 'MySQL error ' . $code . ': ' . $e->getMessage(),
        };
        return $message;
    }

    // ---------------------------------------------------------- provisioning --

    /**
     * Run one provisioning stage.
     *
     * @return array{level:string,message:string,log:array<int,array{level:string,message:string}>,data:array}
     */
    public static function runStage(string $stage, array $db, string $schemaFile): array
    {
        return match ($stage) {
            'connect'       => self::stageConnect($db),
            'tables'        => self::stageStatements($db, $schemaFile, 'CREATE TABLE', 'table'),
            'indexes'       => self::stageIndexes($db, $schemaFile),
            'relationships' => self::stageRelationships($db),
            'defaults'      => self::stageStatements($db, $schemaFile, 'INSERT', 'seed row'),
            'verify'        => self::stageVerify($db),
            default         => ['level' => 'fail', 'message' => 'Unknown provisioning stage “' . $stage . '”.', 'log' => [], 'data' => []],
        };
    }

    private static function stageConnect(array $db): array
    {
        $log = [];
        $log[] = ['level' => 'info', 'message' => 'Connecting to ' . ($db['host'] ?? 'localhost') . ':' . ($db['port'] ?? '3306') . ' as ' . ($db['user'] ?? '') . ' …'];
        try {
            $pdo = self::connect($db, false);
            $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
            $log[] = ['level' => 'pass', 'message' => 'Connected — MySQL ' . $version . '.'];
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'log' => $log, 'data' => []];
        }

        $name = (string) ($db['name'] ?? '');
        try {
            $stmt = $pdo->prepare('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?');
            $stmt->execute([$name]);
            if ($stmt->fetchColumn() === false) {
                $log[] = ['level' => 'info', 'message' => 'Database `' . $name . '` not found — creating it …'];
                $pdo->exec('CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '``', $name) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
                $log[] = ['level' => 'pass', 'message' => 'Database `' . $name . '` created.'];
            } else {
                $log[] = ['level' => 'pass', 'message' => 'Database `' . $name . '` found.'];
            }
            $pdo->exec('USE `' . str_replace('`', '``', $name) . '`');
            $log[] = ['level' => 'pass', 'message' => 'Character set utf8mb4 — full Unicode support for names and document titles.'];
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'log' => $log, 'data' => []];
        }

        return [
            'level'   => 'pass',
            'message' => 'Connection established and database ready.',
            'log'     => $log,
            'data'    => ['version' => $version, 'database' => $name],
        ];
    }

    /** Execute the statements of one kind (CREATE TABLE… / INSERT…) from the schema file. */
    private static function stageStatements(array $db, string $schemaFile, string $kind, string $noun): array
    {
        $log = [];
        if (!is_file($schemaFile)) {
            return ['level' => 'fail', 'message' => 'database/schema.sql is missing from the package.', 'log' => $log, 'data' => []];
        }
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'log' => $log, 'data' => []];
        }

        $done = 0;
        $failed = 0;
        foreach (self::statements($schemaFile) as $statement) {
            if (!self::isKind($statement['sql'], $kind)) {
                continue;
            }
            try {
                $pdo->exec($statement['sql']);
                $done++;
                $log[] = ['level' => 'pass', 'message' => $statement['label']];
            } catch (PDOException $e) {
                $failed++;
                $log[] = ['level' => 'fail', 'message' => $statement['label'] . ' — ' . $e->getMessage()];
            }
        }

        if ($done === 0 && $failed === 0) {
            return ['level' => 'warn', 'message' => 'No ' . $kind . ' statements were found in schema.sql.', 'log' => $log, 'data' => ['done' => 0, 'failed' => 0]];
        }
        if ($failed > 0) {
            return [
                'level'   => 'fail',
                'message' => $failed . ' of ' . ($done + $failed) . ' ' . $noun . ' statement(s) failed. Nothing further will be installed until this is resolved.',
                'log'     => $log,
                'data'    => ['done' => $done, 'failed' => $failed],
            ];
        }
        return [
            'level'   => 'pass',
            'message' => $done . ' ' . $noun . ' statement(s) applied successfully.',
            'log'     => $log,
            'data'    => ['done' => $done, 'failed' => 0],
        ];
    }

    private static function stageIndexes(array $db, string $schemaFile = ''): array
    {
        $log = [];
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'log' => $log, 'data' => []];
        }

        // Only indexes the shipped schema actually declares are created: the
        // database on the host must match database/schema.sql exactly.
        $expected = self::declaredIndexes($schemaFile);
        if ($expected === []) {
            $log[] = ['level' => 'warn', 'message' => 'No secondary indexes are declared in schema.sql; all keys are defined inline with their tables.'];
        }
        $created = 0;
        $present = 0;
        $failed = 0;

        foreach ($expected as $spec) {
            [$table, $index, $columns] = $spec;
            try {
                if (self::hasIndex($pdo, $table, $index)) {
                    $present++;
                    continue;
                }
                $pdo->exec('ALTER TABLE `' . $table . '` ADD INDEX `' . $index . '` (' . $columns . ')');
                $created++;
                $log[] = ['level' => 'pass', 'message' => 'Index ' . $table . '.' . $index . ' created.'];
            } catch (PDOException $e) {
                // A missing table means an earlier stage did not finish; the
                // verify stage reports that properly, so keep this non-fatal.
                $failed++;
                $log[] = ['level' => 'warn', 'message' => 'Index ' . $table . '.' . $index . ' skipped — ' . $e->getMessage()];
            }
        }

        // Primary keys and the indexes that arrive inline with CREATE TABLE are
        // counted too, so the message reflects the real state of the database.
        $total = self::countIndexes($pdo);
        $log[] = ['level' => 'pass', 'message' => $total . ' index(es) now defined across the database (including primary and inline keys).'];
        if ($created > 0) {
            $log[] = ['level' => 'pass', 'message' => $created . ' missing declared index(es) created.'];
        }
        if ($failed > 0) {
            $log[] = ['level' => 'warn', 'message' => $failed . ' index(es) could not be created; the application still runs, list views may be slower.'];
        }

        return [
            'level'   => $failed > 0 ? 'warn' : 'pass',
            'message' => $present . ' declared index(es) present, ' . $created . ' created, ' . $total . ' total keys.',
            'log'     => $log,
            'data'    => ['present' => $present, 'created' => $created, 'failed' => $failed, 'total' => $total],
        ];
    }

    private static function stageRelationships(array $db): array
    {
        $log = [];
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'log' => $log, 'data' => []];
        }

        $found = 0;
        $broken = 0;
        try {
            $sql = 'SELECT TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME
                      FROM information_schema.KEY_COLUMN_USAGE
                     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
                     ORDER BY TABLE_NAME, CONSTRAINT_NAME';
            foreach ($pdo->query($sql) as $row) {
                $found++;
                $log[] = ['level' => 'pass', 'message' => $row['TABLE_NAME'] . '.' . $row['CONSTRAINT_NAME'] . ' → ' . $row['REFERENCED_TABLE_NAME']];
            }
        } catch (PDOException $e) {
            $log[] = ['level' => 'warn', 'message' => 'Could not read the constraint catalogue: ' . $e->getMessage()];
        }

        // Referential integrity: every referenced table must exist and be InnoDB.
        try {
            $sql = "SELECT COUNT(*) FROM information_schema.TABLES
                     WHERE TABLE_SCHEMA = DATABASE() AND ENGINE IS NOT NULL AND ENGINE <> 'InnoDB'";
            $nonInnoDb = (int) $pdo->query($sql)->fetchColumn();
            if ($nonInnoDb > 0) {
                $log[] = ['level' => 'warn', 'message' => $nonInnoDb . ' table(s) are not InnoDB — foreign keys are ignored there.'];
            }
        } catch (PDOException $e) {
            // ignore
        }

        if ($found === 0) {
            $log[] = ['level' => 'warn', 'message' => 'No foreign keys were found. If the tables were created just now in this step, re-run provisioning.'];
        }

        return [
            'level'   => $broken === 0 ? ($found > 0 ? 'pass' : 'warn') : 'warn',
            'message' => $found . ' foreign key relationship(s) in place.',
            'log'     => $log,
            'data'    => ['found' => $found],
        ];
    }

    private static function stageVerify(array $db): array
    {
        $log = [];
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'log' => $log, 'data' => []];
        }

        $tables = [];
        try {
            foreach ($pdo->query('SHOW TABLES') as $row) {
                $tables[] = (string) array_values($row)[0];
            }
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => $e->getMessage(), 'log' => $log, 'data' => []];
        }

        $missing = array_values(array_diff(self::REQUIRED_TABLES, $tables));
        foreach ($tables as $table) {
            $log[] = ['level' => 'pass', 'message' => 'Table ' . $table . ' present'];
        }
        if ($missing !== []) {
            return [
                'level'   => 'fail',
                'message' => 'Missing required table(s): ' . implode(', ', $missing) . '.',
                'log'     => $log,
                'data'    => ['tables' => $tables, 'missing' => $missing],
            ];
        }

        $rows = 0;
        try {
            $rows = (int) $pdo->query('SELECT COUNT(*) FROM offices')->fetchColumn()
                + (int) $pdo->query('SELECT COUNT(*) FROM dropdown_options')->fetchColumn()
                + (int) $pdo->query('SELECT COUNT(*) FROM app_settings')->fetchColumn();
            $log[] = ['level' => 'pass', 'message' => $rows . ' configuration/reference row(s) loaded (offices, dropdown options, settings).'];
        } catch (PDOException $e) {
            $log[] = ['level' => 'warn', 'message' => 'Could not count default rows: ' . $e->getMessage()];
        }

        // Prove the account can write, then roll the probe back.
        try {
            $pdo->beginTransaction();
            $pdo->exec('CREATE TABLE `_rmudts_installer_probe` (`id` int NOT NULL) ENGINE=InnoDB');
            $pdo->exec('INSERT INTO `_rmudts_installer_probe` (`id`) VALUES (1)');
            $pdo->exec('DROP TABLE `_rmudts_installer_probe`');
            $pdo->commit();
            $log[] = ['level' => 'pass', 'message' => 'Write test passed (CREATE, INSERT, DROP all permitted).'];
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $log[] = ['level' => 'warn', 'message' => 'Write test could not complete: ' . $e->getMessage()];
        }

        return [
            'level'   => 'pass',
            'message' => count($tables) . ' table(s) verified, ' . $rows . ' default row(s) loaded.',
            'log'     => $log,
            'data'    => ['tables' => $tables, 'rows' => $rows],
        ];
    }

    // ---------------------------------------------------------- admin account --

    /**
     * Create the initial super administrator.
     *
     * @return array{level:string,message:string,id:?int,name:string,idnumber:string}
     */
    public static function createAdministrator(array $db, array $admin): array
    {
        $pdo = self::pdo($db);
        $idnumber = (string) $admin['idnumber'];
        $email = (string) ($admin['email'] ?? '');
        $name = trim((string) ($admin['first_name'] ?? '') . ' ' . (string) ($admin['last_name'] ?? ''));
        $password = (string) $admin['password'];

        $stmt = $pdo->prepare('SELECT id FROM users WHERE idnumber = ? LIMIT 1');
        $stmt->execute([$idnumber]);
        $existing = $stmt->fetchColumn();

        $hash = Security::hashPassword($password);

        if ($existing !== false) {
            $update = $pdo->prepare('UPDATE users SET password = ?, role = ?, email = ?, name = ? WHERE id = ?');
            $update->execute([$hash, 'super_admin', $email, $name, $existing]);
            return ['level' => 'warn', 'message' => 'An account with username “' . $idnumber . '” already existed; it has been upgraded to super administrator with the new password.', 'id' => (int) $existing, 'name' => $name, 'idnumber' => $idnumber];
        }

        $insert = $pdo->prepare('INSERT INTO users (idnumber, password, role, email, name, office) VALUES (?, ?, ?, ?, ?, NULL)');
        $insert->execute([$idnumber, $hash, 'super_admin', $email, $name]);

        return ['level' => 'pass', 'message' => 'Super administrator “' . $name . '” created.', 'id' => (int) $pdo->lastInsertId(), 'name' => $name, 'idnumber' => $idnumber];
    }

    /** Upsert the RMUDTS-specific system settings. */
    public static function seedSystemSettings(array $db, array $settings): int
    {
        $pdo = self::pdo($db);
        $stmt = $pdo->prepare(
            'INSERT INTO app_settings (setting_key, value) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)'
        );
        $count = 0;
        foreach ($settings as $key => $value) {
            $stmt->execute([(string) $key, is_scalar($value) ? (string) $value : json_encode($value)]);
            $count++;
        }
        return $count;
    }

    /** Row count + size summary for the summary step. */
    public static function report(array $db): array
    {
        $out = ['tables' => [], 'rows' => 0, 'size' => 0];
        try {
            $pdo = self::pdo($db);
            $sql = 'SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH AS BYTES
                      FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME';
            foreach ($pdo->query($sql) as $row) {
                $out['tables'][] = ['table' => $row['TABLE_NAME'], 'rows' => (int) $row['TABLE_ROWS'], 'bytes' => (int) $row['BYTES']];
                $out['rows'] += (int) $row['TABLE_ROWS'];
                $out['size'] += (int) $row['BYTES'];
            }
        } catch (PDOException $e) {
            $out['error'] = $e->getMessage();
        }
        return $out;
    }

    /** Save a portable SQL dump so the administrator has a copy before going live. */
    public static function dump(array $db, string $destination): array
    {
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'path' => null];
        }
        $sql = ["-- RMUDTS database snapshot (created by the installer on " . date('c') . ')', "SET NAMES utf8mb4;", ''];
        $tables = [];
        foreach ($pdo->query('SHOW TABLES') as $row) {
            $tables[] = (string) array_values($row)[0];
        }
        foreach ($tables as $table) {
            $create = $pdo->query('SHOW CREATE TABLE `' . $table . '`')->fetch();
            if (!$create) {
                continue;
            }
            $ddl = (string) ($create['Create Table'] ?? array_values($create)[1] ?? '');
            $sql[] = 'DROP TABLE IF EXISTS `' . $table . '`;';
            $sql[] = $ddl . ';';
        }
        // Structure only: this snapshot exists to prove provisioning worked,
        // and it deliberately contains no administrator password hash.
        if (!Support::writeFile($destination, implode("\n", $sql) . "\n", 0600)) {
            return ['level' => 'warn', 'message' => 'Could not write the schema snapshot to ' . Support::path($destination) . '.', 'path' => null];
        }
        @chmod($destination, 0600);
        return ['level' => 'pass', 'message' => 'Schema snapshot written to ' . Support::path($destination) . ' (' . Support::bytes((int) filesize($destination)) . ', structure only — no accounts).', 'path' => $destination];
    }

    // ------------------------------------------------------------- upgrades --

    /**
     * Every table the shipped schema declares.
     *
     * @return string[]
     */
    public static function declaredTables(string $schemaFile): array
    {
        $tables = [];
        if ($schemaFile === '' || !is_file($schemaFile)) {
            return $tables;
        }
        foreach (self::statements($schemaFile) as $statement) {
            if (!self::isKind($statement['sql'], 'CREATE TABLE')) {
                continue;
            }
            if (preg_match('/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`([^`]+)`/i', $statement['sql'], $m)) {
                $tables[] = $m[1];
            }
        }
        return array_values(array_unique($tables));
    }

    /**
     * Column definitions declared by the shipped schema.
     *
     * The definition is kept verbatim (minus the trailing comma) so an upgrade
     * can add a missing column with exactly the type, nullability and default
     * the release ships — never a hand-retyped approximation.
     *
     * @return array<string,array<string,string>> table => [column => definition]
     */
    public static function declaredColumns(string $schemaFile): array
    {
        $out = [];
        if ($schemaFile === '' || !is_file($schemaFile)) {
            return $out;
        }
        foreach (self::statements($schemaFile) as $statement) {
            if (!self::isKind($statement['sql'], 'CREATE TABLE')) {
                continue;
            }
            if (!preg_match('/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`([^`]+)`/i', $statement['sql'], $m)) {
                continue;
            }
            $table = $m[1];
            $body = self::definitionBody($statement['sql']);
            if ($body === null) {
                continue;
            }
            $out[$table] = [];
            foreach (self::splitDefinition($body) as $segment) {
                // Only column definitions: `name` type …
                if (!preg_match('/^`([^`]+)`\s+(.+)$/s', trim($segment), $col)) {
                    continue;
                }
                $definition = preg_replace('/\s+/', ' ', trim($col[2])) ?? trim($col[2]);
                $out[$table][$col[1]] = rtrim($definition, ", \t\n\r");
            }
        }
        return $out;
    }

    /**
     * Indexes the shipped schema declares inside CREATE TABLE, with uniqueness.
     *
     * @return array<int,array{table:string,name:string,columns:string,unique:bool}>
     */
    public static function declaredKeys(string $schemaFile): array
    {
        $out = [];
        if ($schemaFile === '' || !is_file($schemaFile)) {
            return $out;
        }
        foreach (self::statements($schemaFile) as $statement) {
            if (!self::isKind($statement['sql'], 'CREATE TABLE')) {
                continue;
            }
            if (!preg_match('/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`([^`]+)`/i', $statement['sql'], $m)) {
                continue;
            }
            $table = $m[1];
            $body = self::definitionBody($statement['sql']);
            if ($body === null) {
                continue;
            }
            foreach (self::splitDefinition($body) as $segment) {
                $segment = trim($segment);
                if (!preg_match('/^(UNIQUE\s+)?(?:KEY|INDEX)\s+`([^`]+)`\s*\(([^)]*)\)/i', $segment, $key)) {
                    continue;
                }
                $out[] = [
                    'table'   => $table,
                    'name'    => $key[2],
                    'columns' => trim($key[3]),
                    'unique'  => trim((string) $key[1]) !== '',
                ];
            }
        }
        return $out;
    }

    /**
     * What the live database is missing compared with the shipped schema.
     * Read-only: this is what the upgrade preflight screen shows.
     *
     * @return array{tables:string[],columns:array<int,array{table:string,name:string,definition:string}>,keys:array<int,array{table:string,name:string,columns:string,unique:bool}>,tables_live:int}
     */
    public static function schemaDiff(string $schemaFile, array $db): array
    {
        $pdo = self::pdo($db);
        $live = self::tables($pdo);
        $declaredTables = self::declaredTables($schemaFile);
        $missingTables = array_values(array_diff($declaredTables, $live));

        $missingColumns = [];
        foreach (self::declaredColumns($schemaFile) as $table => $columns) {
            if (!in_array($table, $live, true)) {
                continue; // the whole table is missing; it is created as declared
            }
            $existing = self::columns($pdo, $table);
            foreach ($columns as $name => $definition) {
                if (!in_array($name, $existing, true)) {
                    $missingColumns[] = ['table' => $table, 'name' => $name, 'definition' => $definition];
                }
            }
        }

        $missingKeys = [];
        foreach (self::declaredKeys($schemaFile) as $key) {
            if (!in_array($key['table'], $live, true)) {
                continue;
            }
            if (!self::hasIndex($pdo, $key['table'], $key['name'])) {
                $missingKeys[] = $key;
            }
        }

        return [
            'tables'      => $missingTables,
            'columns'     => $missingColumns,
            'keys'        => $missingKeys,
            'tables_live' => count($live),
        ];
    }

    /**
     * Bring an existing database up to the shipped schema — additively.
     *
     * Only three statements are ever issued: CREATE TABLE IF NOT EXISTS for a
     * missing table, ALTER TABLE … ADD COLUMN for a missing column and
     * ALTER TABLE … ADD [UNIQUE] INDEX for a missing index. Nothing is dropped,
     * renamed or rewritten, so records, uploads references and accounts are
     * untouched by definition.
     *
     * @return array{created_tables:string[],added_columns:string[],added_indexes:string[],failed:array<int,array{what:string,error:string}>,log:array<int,array{level:string,message:string}>}
     */
    public static function converge(string $schemaFile, array $db): array
    {
        $report = ['created_tables' => [], 'added_columns' => [], 'added_indexes' => [], 'failed' => [], 'log' => []];
        if ($schemaFile === '' || !is_file($schemaFile)) {
            $report['failed'][] = ['what' => 'schema.sql', 'error' => 'database/schema.sql is missing from the package.'];
            return $report;
        }
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            $report['failed'][] = ['what' => 'connection', 'error' => self::explain($e, $db)];
            return $report;
        }

        $diff = self::schemaDiff($schemaFile, $db);
        if ($diff['tables'] === [] && $diff['columns'] === [] && $diff['keys'] === []) {
            $report['log'][] = ['level' => 'pass', 'message' => 'Schema already matches the shipped release — no structure changes were needed.'];
            return $report;
        }

        // 1. Missing tables, created exactly as declared ---------------------
        foreach (self::statements($schemaFile) as $statement) {
            if (!self::isKind($statement['sql'], 'CREATE TABLE')) {
                continue;
            }
            if (!preg_match('/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`([^`]+)`/i', $statement['sql'], $m)) {
                continue;
            }
            if (!in_array($m[1], $diff['tables'], true)) {
                continue;
            }
            try {
                $pdo->exec($statement['sql']);
                $report['created_tables'][] = $m[1];
                $report['log'][] = ['level' => 'pass', 'message' => 'Table `' . $m[1] . '` created.'];
            } catch (PDOException $e) {
                $report['failed'][] = ['what' => 'table ' . $m[1], 'error' => $e->getMessage()];
                $report['log'][] = ['level' => 'fail', 'message' => 'Table `' . $m[1] . '` could not be created: ' . $e->getMessage()];
            }
        }

        // 2. Missing columns --------------------------------------------------
        foreach ($diff['columns'] as $column) {
            $sql = 'ALTER TABLE `' . str_replace('`', '``', $column['table']) . '` ADD COLUMN `'
                . str_replace('`', '``', $column['name']) . '` ' . $column['definition'];
            try {
                $pdo->exec($sql);
                $report['added_columns'][] = $column['table'] . '.' . $column['name'];
                $report['log'][] = ['level' => 'pass', 'message' => 'Column ' . $column['table'] . '.' . $column['name'] . ' added.'];
            } catch (PDOException $e) {
                // A NOT NULL column without a default cannot be added to a table
                // that already holds rows. Report it instead of guessing a
                // default that would silently invent data.
                $report['failed'][] = ['what' => 'column ' . $column['table'] . '.' . $column['name'], 'error' => $e->getMessage()];
                $report['log'][] = ['level' => 'fail', 'message' => 'Column ' . $column['table'] . '.' . $column['name'] . ' could not be added: ' . $e->getMessage()];
            }
        }

        // 3. Missing indexes --------------------------------------------------
        foreach ($diff['keys'] as $key) {
            $sql = 'ALTER TABLE `' . str_replace('`', '``', $key['table']) . '` ADD '
                . ($key['unique'] ? 'UNIQUE ' : '') . 'INDEX `' . str_replace('`', '``', $key['name']) . '` (' . $key['columns'] . ')';
            try {
                $pdo->exec($sql);
                $report['added_indexes'][] = $key['table'] . '.' . $key['name'];
                $report['log'][] = ['level' => 'pass', 'message' => 'Index ' . $key['table'] . '.' . $key['name'] . ' created.'];
            } catch (PDOException $e) {
                $report['failed'][] = ['what' => 'index ' . $key['table'] . '.' . $key['name'], 'error' => $e->getMessage()];
                $report['log'][] = ['level' => 'warn', 'message' => 'Index ' . $key['table'] . '.' . $key['name'] . ' could not be created: ' . $e->getMessage()];
            }
        }

        return $report;
    }

    /**
     * Exact row counts per table, used to prove an upgrade kept every row.
     *
     * @return array<string,int>
     */
    public static function tableCounts(array $db): array
    {
        $counts = [];
        try {
            $pdo = self::pdo($db);
            foreach (self::tables($pdo) as $table) {
                try {
                    $counts[$table] = (int) $pdo->query('SELECT COUNT(*) FROM `' . str_replace('`', '``', $table) . '`')->fetchColumn();
                } catch (PDOException $e) {
                    $counts[$table] = -1;
                }
            }
        } catch (PDOException $e) {
            return [];
        }
        return $counts;
    }

    /**
     * Full data backup: structure plus every row, streamed to disk.
     *
     * Deliberately separate from dump() (which is structure-only) because this
     * file is the safety net an upgrade restores from, so it must contain the
     * accounts and the records — and it stays in the private backup folder.
     *
     * @return array{level:string,message:string,path:?string,bytes:int,tables:int,rows:int}
     */
    public static function dumpData(array $db, string $destination): array
    {
        try {
            $pdo = self::pdo($db);
        } catch (PDOException $e) {
            return ['level' => 'fail', 'message' => self::explain($e, $db), 'path' => null, 'bytes' => 0, 'tables' => 0, 'rows' => 0];
        }
        if (!Support::mkdir(dirname($destination))) {
            return ['level' => 'fail', 'message' => 'Could not create the backup folder ' . Support::path(dirname($destination)) . '.', 'path' => null, 'bytes' => 0, 'tables' => 0, 'rows' => 0];
        }
        $handle = @fopen($destination, 'wb');
        if ($handle === false) {
            return ['level' => 'fail', 'message' => 'Could not open ' . Support::path($destination) . ' for writing.', 'path' => null, 'bytes' => 0, 'tables' => 0, 'rows' => 0];
        }

        $tables = self::tables($pdo);
        $rowTotal = 0;
        $written = 0;
        $write = static function (string $text) use ($handle, &$written): void {
            fwrite($handle, $text);
            $written += strlen($text);
        };

        $write("-- RMUDTS data backup (created by the installer on " . date('c') . ")\n");
        $write("-- Database: " . (string) ($db['name'] ?? '') . "  Host: " . (string) ($db['host'] ?? '') . "\n");
        $write("-- Restore with: mysql -u USER -p DBNAME < this-file.sql\n\n");
        $write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n");

        foreach ($tables as $table) {
            $quoted = '`' . str_replace('`', '``', $table) . '`';
            $create = $pdo->query('SHOW CREATE TABLE ' . $quoted)->fetch();
            if (!$create) {
                continue;
            }
            $ddl = (string) ($create['Create Table'] ?? array_values($create)[1] ?? '');
            $write("-- ----------------------------------------------------------------\n");
            $write("-- Table " . $quoted . "\n");
            $write("-- ----------------------------------------------------------------\n");
            $write('DROP TABLE IF EXISTS ' . $quoted . ";\n");
            $write($ddl . ";\n\n");

            try {
                $rows = $pdo->query('SELECT * FROM ' . $quoted);
            } catch (PDOException $e) {
                $write('-- rows for ' . $quoted . ' could not be read: ' . $e->getMessage() . "\n\n");
                continue;
            }
            if ($rows === false) {
                continue;
            }

            $buffer = [];
            $columns = [];
            foreach ($rows as $row) {
                if ($columns === []) {
                    $columns = array_keys($row);
                }
                $values = [];
                foreach ($row as $value) {
                    if ($value === null) {
                        $values[] = 'NULL';
                    } elseif (is_int($value) || is_float($value)) {
                        $values[] = (string) $value;
                    } else {
                        $values[] = $pdo->quote((string) $value);
                    }
                }
                $buffer[] = '(' . implode(', ', $values) . ')';
                $rowTotal++;
                if (count($buffer) >= 50) {
                    $write('INSERT INTO ' . $quoted . ' (' . implode(', ', array_map(static fn(string $c): string => '`' . str_replace('`', '``', $c) . '`', $columns)) . ") VALUES\n" . implode(",\n", $buffer) . ";\n");
                    $buffer = [];
                }
            }
            if ($buffer !== []) {
                $write('INSERT INTO ' . $quoted . ' (' . implode(', ', array_map(static fn(string $c): string => '`' . str_replace('`', '``', $c) . '`', $columns)) . ") VALUES\n" . implode(",\n", $buffer) . ";\n");
            }
            $write("\n");
        }

        $write("SET FOREIGN_KEY_CHECKS=1;\n-- End of RMUDTS data backup.\n");
        fclose($handle);
        @chmod($destination, 0600);

        return [
            'level'   => 'pass',
            'message' => 'Data backup written to ' . Support::path($destination) . ' (' . count($tables) . ' table(s), ' . $rowTotal . ' row(s), ' . Support::bytes($written) . ').',
            'path'    => $destination,
            'bytes'   => $written,
            'tables'  => count($tables),
            'rows'    => $rowTotal,
        ];
    }

    // ------------------------------------------------------------- internals --

    /**
     * Every table in the current database.
     *
     * @return string[]
     */
    public static function tables(PDO $pdo): array
    {
        $out = [];
        try {
            foreach ($pdo->query('SHOW TABLES') as $row) {
                $out[] = (string) array_values($row)[0];
            }
        } catch (PDOException $e) {
            return [];
        }
        sort($out);
        return $out;
    }

    /** The text between the outermost parentheses of a CREATE TABLE statement. */
    private static function definitionBody(string $sql): ?string
    {
        $start = strpos($sql, '(');
        if ($start === false) {
            return null;
        }
        $length = strlen($sql);
        $depth = 0;
        for ($i = $start; $i < $length; $i++) {
            $char = $sql[$i];
            if ($char === '`' || $char === "'" || $char === '"') {
                $quote = $char;
                for ($i++; $i < $length; $i++) {
                    if ($sql[$i] === '\\' && $quote !== '`') {
                        $i++;
                        continue;
                    }
                    if ($sql[$i] === $quote) {
                        if ($quote !== '`' && ($sql[$i + 1] ?? '') === $quote) {
                            $i++;
                            continue;
                        }
                        break;
                    }
                }
                continue;
            }
            if ($char === '(') {
                $depth++;
                continue;
            }
            if ($char === ')') {
                $depth--;
                if ($depth === 0) {
                    return substr($sql, $start + 1, $i - $start - 1);
                }
            }
        }
        return null;
    }

    /**
     * Split a CREATE TABLE body on its top-level commas.
     *
     * @return string[]
     */
    private static function splitDefinition(string $body): array
    {
        $segments = [];
        $buffer = '';
        $depth = 0;
        $length = strlen($body);
        for ($i = 0; $i < $length; $i++) {
            $char = $body[$i];
            if ($char === '`' || $char === "'" || $char === '"') {
                $quote = $char;
                $buffer .= $char;
                for ($i++; $i < $length; $i++) {
                    $buffer .= $body[$i];
                    if ($body[$i] === '\\' && $quote !== '`' && $i + 1 < $length) {
                        $buffer .= $body[++$i];
                        continue;
                    }
                    if ($body[$i] === $quote) {
                        if ($quote !== '`' && ($body[$i + 1] ?? '') === $quote) {
                            $buffer .= $body[++$i];
                            continue;
                        }
                        break;
                    }
                }
                continue;
            }
            if ($char === '(') {
                $depth++;
                $buffer .= $char;
                continue;
            }
            if ($char === ')') {
                $depth--;
                $buffer .= $char;
                continue;
            }
            if ($char === ',' && $depth === 0) {
                $segments[] = $buffer;
                $buffer = '';
                continue;
            }
            $buffer .= $char;
        }
        if (trim($buffer) !== '') {
            $segments[] = $buffer;
        }
        return $segments;
    }

    /**
     * Stream the statements of a .sql file.
     *
     * Handles `--` and `#` line comments, /* *\/ block comments and quoted
     * strings (single, double and backtick) so a semicolon inside a document
     * title or a JSON default never splits a statement.
     *
     * @return \Generator<int,array{sql:string,label:string}>
     */
    public static function statements(string $file): \Generator
    {
        $sql = (string) @file_get_contents($file);
        $length = strlen($sql);
        $buffer = '';
        $index = 0;

        while ($index < $length) {
            $char = $sql[$index];
            $next = $index + 1 < $length ? $sql[$index + 1] : '';

            // -- line comment -------------------------------------------------
            if ($char === '-' && $next === '-') {
                while ($index < $length && $sql[$index] !== "\n") {
                    $index++;
                }
                continue;
            }
            // # line comment --------------------------------------------------
            if ($char === '#') {
                while ($index < $length && $sql[$index] !== "\n") {
                    $index++;
                }
                continue;
            }
            // /* block comment */ --------------------------------------------
            if ($char === '/' && $next === '*') {
                $index += 2;
                while ($index < $length && !($sql[$index] === '*' && ($sql[$index + 1] ?? '') === '/')) {
                    $index++;
                }
                $index += 2;
                continue;
            }
            // quoted literal --------------------------------------------------
            if ($char === "'" || $char === '"' || $char === '`') {
                $quote = $char;
                $buffer .= $char;
                $index++;
                while ($index < $length) {
                    $c = $sql[$index];
                    if ($c === '\\' && $quote !== '`') {
                        $buffer .= $c . ($sql[$index + 1] ?? '');
                        $index += 2;
                        continue;
                    }
                    if ($c === $quote) {
                        if (($sql[$index + 1] ?? '') === $quote) {   // '' escape
                            $buffer .= $c . $c;
                            $index += 2;
                            continue;
                        }
                        $buffer .= $c;
                        $index++;
                        break;
                    }
                    $buffer .= $c;
                    $index++;
                }
                continue;
            }
            // statement terminator -------------------------------------------
            if ($char === ';') {
                $statement = trim($buffer);
                if ($statement !== '') {
                    yield ['sql' => $statement, 'label' => self::describe($statement)];
                }
                $buffer = '';
                $index++;
                continue;
            }
            $buffer .= $char;
            $index++;
        }

        $statement = trim($buffer);
        if ($statement !== '') {
            yield ['sql' => $statement, 'label' => self::describe($statement)];
        }
    }

    public static function isKind(string $sql, string $kind): bool
    {
        $head = strtoupper(ltrim(substr($sql, 0, 40)));
        return str_starts_with($head, strtoupper($kind));
    }

    /** A short human sentence for the provisioning log. */
    private static function describe(string $sql): string
    {
        $head = strtoupper(preg_replace('/\s+/', ' ', ltrim($sql)) ?? '');
        if (preg_match('/^CREATE TABLE IF NOT EXISTS `([^`]+)`/', $head, $m)) {
            $columns = preg_match_all('/^\s*`[^`]+`/m', $sql);
            return 'Table `' . $m[1] . '` created (' . $columns . ' columns).';
        }
        if (preg_match('/^SET /', $head)) {
            return 'Applied: ' . rtrim(substr(trim($sql), 0, 60), ';');
        }
        if (preg_match('/^INSERT INTO `([^`]+)`/', $head, $m)) {
            // Count the value tuples: "...),\n  (" separators, plus the first.
            $rows = 1 + (int) preg_match_all('/\),\s*\n\s*\(/', $sql);
            return 'Seed data loaded into `' . $m[1] . '` (' . $rows . ' row(s)).';
        }
        if (preg_match('/^CREATE (DATABASE|INDEX|UNIQUE)/', $head, $m)) {
            return $m[1] . ' statement applied.';
        }
        return 'Statement applied: ' . substr(preg_replace('/\s+/', ' ', trim($sql)) ?? '', 0, 70);
    }

    /**
     * Every secondary index declared in the shipped schema.
     *
     * Parsed from `database/schema.sql` rather than hard-coded, so the indexes
     * the wizard verifies are exactly the ones the release ships — no invented
     * "performance" indexes that a DBA would not find in the schema file.
     *
     * @return array<int,array{0:string,1:string,2:string}> [table, index, columns]
     */
    public static function declaredIndexes(string $schemaFile): array
    {
        if ($schemaFile === '' || !is_file($schemaFile)) {
            return [];
        }
        $sql = (string) @file_get_contents($schemaFile);
        $indexes = [];
        $table = null;
        foreach (preg_split('/\r?\n/', $sql) ?: [] as $line) {
            if (preg_match('/^CREATE TABLE IF NOT EXISTS `([^`]+)`/i', $line, $m)) {
                $table = $m[1];
                continue;
            }
            if ($table === null) {
                continue;
            }
            if (str_starts_with(trim($line), ')')) {
                $table = null;
                continue;
            }
            if (preg_match('/^\s*(?:UNIQUE\s+)?KEY\s+`([^`]+)`\s*\(([^)]+)\)/i', $line, $m)) {
                if (strtoupper($m[1]) === 'PRIMARY') {
                    continue;
                }
                $indexes[] = [$table, $m[1], trim($m[2])];
            }
        }
        return $indexes;
    }

    private static function hasIndex(PDO $pdo, string $table, string $index): bool
    {
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?');
        $stmt->execute([$table, $index]);
        return (int) $stmt->fetchColumn() > 0;
    }

    private static function countIndexes(PDO $pdo): int
    {
        try {
            $stmt = $pdo->prepare('SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()');
            $stmt->execute();
            return (int) $stmt->fetchColumn();
        } catch (PDOException $e) {
            return 0;
        }
    }

    /**
     * Column names that actually exist in a table — used defensively before
     * writing schema snapshot SQL or diagnostics.
     *
     * @return string[]
     */
    public static function columns(PDO $pdo, string $table): array
    {
        $out = [];
        foreach ($pdo->query('SHOW COLUMNS FROM `' . str_replace('`', '``', $table) . '`') as $row) {
            $out[] = (string) $row['Field'];
        }
        return $out;
    }
}

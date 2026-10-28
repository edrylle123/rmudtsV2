<?php
/**
 * RMUDTS Installer — Migrations
 * ---------------------------------------------------------------------------
 * The record of every change that has been applied to a live database.
 *
 * There are two kinds of upgrade work, and both live here:
 *
 *   1. **Structure** — the release's `database/schema.sql` is converged onto
 *      the live database by Database::converge(): missing tables, columns and
 *      indexes are added, nothing is ever dropped. That is version-independent
 *      and is what makes "install v1.0, upgrade to v1.1" work without a
 *      hand-written script for every column.
 *
 *   2. **Data** — the ordered registry below. Each entry is a named, idempotent
 *      set of statements that must run exactly once, in order, on copies that
 *      predate it. Applied ids are recorded in the `schema_migrations` ledger,
 *      so a second run is a no-op and an interrupted run resumes where it
 *      stopped.
 *
 * Adding a migration for the next release:
 *
 *     '2026_11_01_add_records_created_by' => [
 *         'description' => 'Attribute existing records to the account that created them.',
 *         'statements'  => [
 *             "UPDATE records SET created_by = 'System' WHERE created_by IS NULL",
 *         ],
 *     ],
 *
 * Rules for an entry: never DROP or TRUNCATE a table, never DELETE an account,
 * and make every statement safe to run twice (upsert, WHERE … IS NULL, etc.).
 * The ledger protects against repeats, but a half-applied migration must never
 * lose data when it is retried.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

use PDO;
use PDOException;

final class Migrations
{
    /** Ledger table: one row per applied migration (and per converged release). */
    public const LEDGER = 'schema_migrations';

    /**
     * Ordered, idempotent data migrations.
     *
     * Empty on purpose for v1.0.0: nothing has shipped yet that needs more than
     * converging the schema. The mechanism, the ledger and the runner are live
     * and are exercised by the upgrade verification harness, so the next release
     * only has to add an entry here.
     *
     * @return array<string,array{description:string,statements:string[]}>
     */
    public static function registry(): array
    {
        return [];
    }

    /** Create the ledger if this database does not have it yet. */
    public static function ensureLedger(PDO $pdo): bool
    {
        try {
            $pdo->exec(
                'CREATE TABLE IF NOT EXISTS `' . self::LEDGER . '` ('
                . '`id` varchar(191) NOT NULL,'
                . '`description` varchar(255) NOT NULL DEFAULT \'\','
                . '`version` varchar(32) NOT NULL DEFAULT \'\','
                . '`applied_at` timestamp NOT NULL DEFAULT current_timestamp(),'
                . 'PRIMARY KEY (`id`)'
                . ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
            );
            return true;
        } catch (PDOException $e) {
            return false;
        }
    }

    public static function hasLedger(PDO $pdo): bool
    {
        return in_array(self::LEDGER, Database::tables($pdo), true);
    }

    /**
     * @return array<string,array{id:string,description:string,version:string,applied_at:string}>
     */
    public static function applied(PDO $pdo): array
    {
        $out = [];
        if (!self::hasLedger($pdo)) {
            return $out;
        }
        try {
            foreach ($pdo->query('SELECT `id`, `description`, `version`, `applied_at` FROM `' . self::LEDGER . '` ORDER BY `id`') as $row) {
                $out[(string) $row['id']] = [
                    'id'          => (string) $row['id'],
                    'description' => (string) $row['description'],
                    'version'     => (string) $row['version'],
                    'applied_at'  => (string) $row['applied_at'],
                ];
            }
        } catch (PDOException $e) {
            return [];
        }
        return $out;
    }

    /**
     * Registry entries that this database has not seen yet, in order.
     *
     * @return array<string,array{description:string,statements:string[]}>
     */
    public static function pending(PDO $pdo): array
    {
        $applied = self::applied($pdo);
        $pending = [];
        foreach (self::registry() as $id => $spec) {
            if (!isset($applied[$id])) {
                $pending[$id] = $spec;
            }
        }
        return $pending;
    }

    /** Record one applied migration (idempotent). */
    public static function record(PDO $pdo, string $id, string $description, string $version): bool
    {
        if (!self::hasLedger($pdo) && !self::ensureLedger($pdo)) {
            return false;
        }
        // mbstring is optional in the installer requirements, so never call it
        // blindly (the ledger is written during an upgrade, not during a
        // requirements check).
        $short = function_exists('mb_substr') ? mb_substr($description, 0, 255) : substr($description, 0, 255);
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO `' . self::LEDGER . '` (`id`, `description`, `version`) VALUES (?, ?, ?)'
                . ' ON DUPLICATE KEY UPDATE `description` = VALUES(`description`), `version` = VALUES(`version`)'
            );
            $stmt->execute([$id, $short, $version]);
            return true;
        } catch (PDOException $e) {
            return false;
        }
    }

    /**
     * Run every pending data migration.
     *
     * @param callable(string,string):void $log level, message
     * @return array{applied:string[],failed:string[],log:array<int,array{level:string,message:string}>}
     */
    public static function run(PDO $pdo, string $version, callable $log): array
    {
        $out = ['applied' => [], 'failed' => [], 'log' => []];
        $emit = static function (string $level, string $message) use ($log, &$out): void {
            $out['log'][] = ['level' => $level, 'message' => $message];
            $log($level, $message);
        };

        if (!self::ensureLedger($pdo)) {
            $emit('warn', 'The migration ledger (`' . self::LEDGER . '`) could not be created; data migrations were skipped.');
            return $out;
        }

        $pending = self::pending($pdo);
        if ($pending === []) {
            $emit('pass', 'No data migrations are pending for this release.');
        }

        foreach ($pending as $id => $spec) {
            $description = (string) ($spec['description'] ?? $id);
            $statements = (array) ($spec['statements'] ?? []);
            $ok = true;
            foreach ($statements as $sql) {
                $sql = trim((string) $sql);
                if ($sql === '') {
                    continue;
                }
                try {
                    $pdo->exec($sql);
                } catch (PDOException $e) {
                    $ok = false;
                    $out['failed'][] = $id;
                    $emit('fail', 'Migration ' . $id . ' failed: ' . $e->getMessage());
                    break;
                }
            }
            if ($ok) {
                if (self::record($pdo, $id, $description, $version)) {
                    $out['applied'][] = $id;
                    $emit('pass', 'Migration ' . $id . ' applied — ' . $description);
                } else {
                    $out['failed'][] = $id;
                    $emit('warn', 'Migration ' . $id . ' ran but could not be recorded in the ledger; it will run again next time.');
                }
            }
        }

        return $out;
    }

    /**
     * Record that this database now matches the shipped release. Run after the
     * structure has been converged, so the ledger always says which code shape
     * the data is known-good against.
     */
    public static function recordBaseline(PDO $pdo, string $version): bool
    {
        return self::record($pdo, 'baseline:' . $version, 'Schema converged to the shipped release ' . $version . '.', $version);
    }
}

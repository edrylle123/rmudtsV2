<?php
/**
 * RMUDTS Installer — Integrity
 * ---------------------------------------------------------------------------
 * Step 2 answers one question before anything is written: "is this archive
 * complete and unmodified?" It reads the checksums.json produced by the
 * release builder, re-hashes every listed file and verifies the structure the
 * rest of the installation depends on.
 *
 * A missing or corrupted required file blocks the wizard. A file that is not
 * in the manifest (for example one the administrator dropped in by hand) is
 * reported as a warning, never a failure.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Integrity
{
    /** Files that must exist regardless of what checksums.json says. */
    private const REQUIRED = [
        'install/index.php',
        'install/lib/Installer.php',
        'install/lib/Upgrader.php',
        'client/index.html',
        'server/server.js',
        'server/package.json',
        'database/schema.sql',
        'templates/frontend.htaccess',
    ];

    /** Extensions an extracted web-root archive must never contain. */
    private const UNEXPECTED_EXECUTABLE = ['cgi', 'pl', 'py', 'sh', 'bat', 'cmd', 'exe'];

    /**
     * @return array{ok:bool,checks:array<int,array<string,mixed>>,summary:array<string,int>,manifest:array}
     */
    public static function verify(): array
    {
        $checks = [];
        $root = Paths::packageRoot();
        $manifest = Support::readJson(Paths::checksumsFile());
        $listed = (array) ($manifest['files'] ?? []);

        if ($listed === []) {
            $checks[] = self::check('Checksum manifest', 'warn', 'checksums.json is missing or empty — file integrity cannot be verified. Continue only if you trust where this archive came from.', false);
        } else {
            $checks[] = self::check('Checksum manifest', 'pass', count($listed) . ' file(s) listed in checksums.json (version ' . (string) ($manifest['version'] ?? 'unknown') . ')', false);
        }

        $mismatched = [];
        $checked = 0;
        foreach ($listed as $rel => $expected) {
            $file = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $rel);
            if (!is_file($file)) {
                $mismatched[] = $rel . ' (missing)';
                continue;
            }
            $checked++;
            $actual = hash_file('sha256', $file);
            if (!is_string($actual) || !hash_equals((string) $expected, $actual)) {
                $mismatched[] = (string) $rel;
            }
        }
        if ($listed !== []) {
            $checks[] = $mismatched === []
                ? self::check('File checksums', 'pass', $checked . ' file(s) match the release manifest', true)
                : self::check(
                    'File checksums',
                    'fail',
                    count($mismatched) . ' file(s) do not match the release: ' . implode(', ', array_slice($mismatched, 0, 6))
                        . '. Re-upload the original archive and extract it again.',
                    true
                );
        }

        $missing = [];
        foreach (self::REQUIRED as $rel) {
            $file = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (!is_file($file) || filesize($file) === 0) {
                $missing[] = $rel;
            }
        }
        $checks[] = $missing === []
            ? self::check('Required package files', 'pass', count(self::REQUIRED) . ' required files present', true)
            : self::check('Required package files', 'fail', 'Missing or empty: ' . implode(', ', $missing) . '. Re-upload the release archive.', true);

        $frontend = Paths::clientSource();
        $checks[] = $frontend !== null
            ? self::check('Frontend production build', 'pass', 'index.html + assets found in ' . Support::path($frontend), true)
            : self::check('Frontend production build', 'fail', 'client/index.html is missing. The archive does not contain a compiled React build.', true);

        $server = Paths::serverSource();
        $checks[] = is_file($server . DIRECTORY_SEPARATOR . 'server.js') && is_file($server . DIRECTORY_SEPARATOR . 'package.json')
            ? self::check('Backend package', 'pass', 'server.js and package.json present in ' . Support::path($server), true)
            : self::check('Backend package', 'fail', 'The backend is incomplete (server.js or package.json missing).', true);

        $checks[] = !is_dir($server . DIRECTORY_SEPARATOR . 'node_modules')
            ? self::check('No bundled node_modules', 'pass', 'Dependencies are installed on the server, not shipped in the ZIP', false)
            : self::check('No bundled node_modules', 'warn', 'The archive contains node_modules. Remove it before uploading to keep the package small and portable.', false);

        $schema = Paths::schemaFile();
        $sql = is_file($schema) ? (string) @file_get_contents($schema) : '';
        $tables = (int) preg_match_all('/CREATE TABLE/i', $sql);
        $checks[] = $sql !== ''
            ? self::check('Schema payload', 'pass', $tables . ' table definition(s) in database/schema.sql', true)
            : self::check('Schema payload', 'fail', 'database/schema.sql is missing or unreadable.', true);

        $checks[] = is_file(Paths::defaultDataFile())
            ? self::check('Default data', 'pass', 'database/default-data.sql present', false)
            : self::check('Default data', 'warn', 'database/default-data.sql is missing — default records will be skipped.', false);

        $templates = 0;
        foreach (['backend.env.example', 'frontend.env.production.example', 'frontend.htaccess', 'cpanel-node-setup.txt'] as $name) {
            if (is_file(Paths::templatesDir() . DIRECTORY_SEPARATOR . $name)) {
                $templates++;
            }
        }
        $checks[] = $templates === 4
            ? self::check('Installer templates', 'pass', 'All four deployment templates present', false)
            : self::check('Installer templates', 'warn', $templates . ' of 4 templates present — the installer can regenerate them, but the archive is incomplete.', false);

        // Anyone can add a file after extraction; executable files in the web
        // root are exactly what an attacker would leave behind.
        $unexpected = [];
        foreach ((array) @scandir($root) as $entry) {
            $entry = (string) $entry;
            if ($entry === '' || $entry === '.' || $entry === '..' || is_dir($root . DIRECTORY_SEPARATOR . $entry)) {
                continue;
            }
            $ext = strtolower((string) pathinfo($entry, PATHINFO_EXTENSION));
            $isPhp = $ext === 'php';
            if (in_array($ext, self::UNEXPECTED_EXECUTABLE, true) || ($isPhp && !in_array($entry, ['index.php'], true))) {
                $unexpected[] = $entry;
            }
        }
        $checks[] = $unexpected === []
            ? self::check('No unexpected executables', 'pass', 'No stray scripts in the document root', false)
            : self::check('No unexpected executables', 'warn', 'Unexpected executable file(s) in the web root: ' . implode(', ', $unexpected), false);

        $summary = ['pass' => 0, 'warn' => 0, 'fail' => 0];
        foreach ($checks as $check) {
            $summary[$check['level']]++;
        }
        $blocking = array_filter($checks, static fn(array $c): bool => $c['level'] === 'fail' && $c['critical']);

        return [
            'ok'       => $blocking === [],
            'checks'   => $checks,
            'summary'  => $summary,
            'manifest' => $manifest,
        ];
    }

    /** @return array{label:string,level:string,note:string,critical:bool} */
    private static function check(string $label, string $level, string $note, bool $critical): array
    {
        return ['label' => $label, 'level' => $level, 'note' => $note, 'critical' => $critical];
    }
}

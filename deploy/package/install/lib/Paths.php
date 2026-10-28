<?php
/**
 * RMUDTS Installer — Paths
 * ---------------------------------------------------------------------------
 * Knows where the installer runs from and where every writable location
 * should live. The golden rule enforced here: application data, configuration,
 * logs, uploads, backups and temporary files stay OUTSIDE public_html.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Paths
{
    /** Storage locations the administrator configures in step 3. */
    public const KEYS = [
        'public_root' => 'Web root (public_html)',
        'frontend'    => 'Frontend build (public_html/rmudts)',
        'app_root'    => 'Backend application',
        'config'      => 'Configuration (.env, config.php, installed.lock)',
        'data'        => 'Application data',
        'tmp'         => 'Temporary files',
        'cache'       => 'Cache',
        'logs'        => 'Logs',
        'uploads'     => 'Uploads',
        'backups'     => 'Backups',
        'restore'     => 'Restore staging',
    ];

    /** Folders the web server is allowed to serve. */
    public const PUBLIC_KEYS = ['public_root', 'frontend'];

    /** Short "why this exists" line shown next to each path. */
    public const PURPOSE = [
        'public_root' => 'Files the web server is allowed to hand out.',
        'frontend'    => 'Compiled React build served at /rmudts/ — public, no secrets.',
        'app_root'    => 'Node.js backend — never web-accessible.',
        'config'      => 'Secrets and generated config, outside the web root.',
        'data'        => 'Database dumps and persistent application state.',
        'tmp'         => 'Scratch space for PDF/imagemagick work.',
        'cache'       => 'Regenerable caches (safe to delete).',
        'logs'        => 'Application and installer logs.',
        'uploads'     => 'User document attachments — never executed.',
        'backups'     => 'Scheduled + manual database/upload backups.',
        'restore'     => 'Staging area for incoming restore archives.',
    ];

    /** Locations that must never sit inside the web root. */
    public const MUST_BE_PRIVATE = [
        'app_root', 'config', 'data', 'tmp', 'cache', 'logs', 'uploads', 'backups', 'restore',
    ];

    public static function installDir(): string
    {
        return dirname(__DIR__);            // .../public_html/install
    }

    /** Directory the ZIP was extracted into (parent of install/). */
    public static function packageRoot(): string
    {
        return dirname(self::installDir());
    }

    public static function stateFile(): string
    {
        return self::installDir() . DIRECTORY_SEPARATOR . '.install-state.json';
    }

    public static function lockFile(): string
    {
        return self::installDir() . DIRECTORY_SEPARATOR . 'installed.lock';
    }

    public static function assetsUrl(): string
    {
        return 'assets';
    }

    /**
     * Sensible defaults: everything private is a sibling of the web root, which
     * on cPanel means /home/<account>/rmudts-* — the layout recommended by the
     * hosting provider and by the installation guide.
     */
    public static function defaults(): array
    {
        $public = self::packageRoot();
        $account = dirname($public);
        if ($account === '.' || $account === '' || $account === $public) {
            $account = $public;              // docroot is the account root (rare)
        }
        $join = static fn(string $base, string $leaf): string => rtrim($base, '/\\') . DIRECTORY_SEPARATOR . $leaf;

        return [
            'public_root' => $public,
            'frontend'    => $join($public, 'rmudts'),
            'app_root'    => $join($account, 'rmudts-app'),
            'config'      => $join($account, 'rmudts-config'),
            'data'        => $join($account, 'rmudts-data'),
            'tmp'         => $join($join($account, 'rmudts-data'), 'tmp'),
            'cache'       => $join($join($account, 'rmudts-data'), 'cache'),
            'logs'        => $join($account, 'rmudts-logs'),
            'uploads'     => $join($account, 'rmudts-uploads'),
            'backups'     => $join($account, 'rmudts-backups'),
            'restore'     => $join($account, 'rmudts-restore'),
        ];
    }

    /** Backend source that ships inside the package. */
    public static function serverSource(): string
    {
        return self::packageRoot() . DIRECTORY_SEPARATOR . 'server';
    }

    /** Static frontend build that ships inside the package. */
    public static function clientSource(): ?string
    {
        $root = self::packageRoot();
        foreach (['client/build', 'client/dist', 'client'] as $candidate) {
            $dir = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $candidate);
            if (is_file($dir . DIRECTORY_SEPARATOR . 'index.html')) {
                return $dir;
            }
        }
        return null;
    }

    /** SQL payload that ships inside the package. */
    public static function schemaFile(): string
    {
        return self::packageRoot() . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'schema.sql';
    }

    /** Optional default records imported after the schema. */
    public static function defaultDataFile(): string
    {
        return self::packageRoot() . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'default-data.sql';
    }

    /** Upgrade migrations shipped with the archive. */
    public static function migrationsDir(): string
    {
        return self::packageRoot() . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'migrations';
    }

    /** Release manifest written by the packager (may be absent). */
    public static function checksumsFile(): string
    {
        return self::packageRoot() . DIRECTORY_SEPARATOR . 'checksums.json';
    }

    /** Deployment templates shipped with the archive. */
    public static function templatesDir(): string
    {
        return self::packageRoot() . DIRECTORY_SEPARATOR . 'templates';
    }

    /** Normalise a user supplied path: no trailing slash, forward slashes kept. */
    public static function normalise(string $path): string
    {
        $path = trim($path);
        if ($path === '') {
            return '';
        }
        $path = str_replace('\\', '/', $path);
        // Collapse duplicate separators (but keep a leading // for UNC paths).
        $path = preg_replace('#(?<!:)//+#', '/', $path) ?? $path;
        // Resolve . and .. segments textually — realpath() fails on paths that
        // do not exist yet, and these paths are created during installation.
        $absolute = $path[0] === '/';
        $parts = [];
        foreach (explode('/', $path) as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                if ($parts !== [] && end($parts) !== '..') {
                    array_pop($parts);
                } elseif (!$absolute) {
                    $parts[] = '..';
                }
                continue;
            }
            $parts[] = $part;
        }
        $joined = implode('/', $parts);
        if (preg_match('#^[A-Za-z]:#', $path)) {                 // C:/...
            return rtrim($path, '/') === $path ? $joined : $joined;
        }
        return $absolute ? '/' . $joined : $joined;
    }

    public static function isAbsolute(string $path): bool
    {
        return $path !== '' && ($path[0] === '/' || (bool) preg_match('#^[A-Za-z]:[/\\\\]#', $path));
    }

    /** Is $child inside (or equal to) $parent? Case-insensitive on Windows. */
    public static function isInside(string $child, string $parent): bool
    {
        $child = rtrim(self::normalise($child), '/');
        $parent = rtrim(self::normalise($parent), '/');
        if ($child === '' || $parent === '') {
            return false;
        }
        $a = DIRECTORY_SEPARATOR === '\\' ? strtolower($child) : $child;
        $b = DIRECTORY_SEPARATOR === '\\' ? strtolower($parent) : $parent;
        return $a === $b || str_starts_with($a, $b . '/');
    }

    /**
     * Validate one configured path.
     * @return array{level:string,message:string}
     */
    public static function validate(string $key, string $path, array $all): array
    {
        $label = self::KEYS[$key] ?? $key;
        if ($path === '') {
            return ['level' => 'fail', 'message' => $label . ' cannot be empty.'];
        }
        if (!self::isAbsolute($path)) {
            return ['level' => 'fail', 'message' => $label . ' must be an absolute path (got “' . Support::path($path) . '”).'];
        }
        if (in_array($key, self::MUST_BE_PRIVATE, true) && isset($all['public_root']) && $all['public_root'] !== '') {
            if (self::isInside($path, $all['public_root']) && !self::isInside($path, rtrim($all['public_root'], '/') . '/../')) {
                return [
                    'level' => 'fail',
                    'message' => $label . ' is inside the web root (' . Support::path($all['public_root']) . '). '
                        . 'Sensitive files must live outside public_html.',
                ];
            }
        }
        // A non-existent path is fine as long as its nearest existing parent is writable.
        $parent = $path;
        while ($parent !== '' && !is_dir($parent)) {
            $next = dirname($parent);
            if ($next === $parent) {
                break;
            }
            $parent = $next;
        }
        if ($parent === '' || !is_dir($parent)) {
            return ['level' => 'fail', 'message' => $label . ' — no existing parent directory could be found for ' . Support::path($path) . '.'];
        }
        if (!is_writable($parent)) {
            return ['level' => 'fail', 'message' => $label . ' — ' . Support::path($parent) . ' is not writable by the PHP user (' . self::phpUser() . ').'];
        }
        if (is_dir($path) && !is_writable($path)) {
            return ['level' => 'fail', 'message' => $label . ' exists but is not writable (' . Support::path($path) . ').'];
        }
        return ['level' => 'pass', 'message' => $label . ' → ' . Support::path($path)];
    }

    public static function phpUser(): string
    {
        if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
            $info = @posix_getpwuid(posix_geteuid());
            if (is_array($info) && !empty($info['name'])) {
                return (string) $info['name'];
            }
        }
        if (function_exists('get_current_user')) {
            $user = get_current_user();
            if ($user) {
                return $user;
            }
        }
        return getenv('USERNAME') ?: (getenv('USER') ?: 'unknown');
    }

    /** Free disk space on the volume that holds $path, or null when unknown. */
    public static function freeSpace(string $path): ?int
    {
        while ($path !== '' && !is_dir($path)) {
            $next = dirname($path);
            if ($next === $path) {
                break;
            }
            $path = $next;
        }
        if ($path === '' || !is_dir($path)) {
            return null;
        }
        $free = @disk_free_space($path);
        return $free === false ? null : (int) $free;
    }
}

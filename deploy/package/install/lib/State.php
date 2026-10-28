<?php
/**
 * RMUDTS Installer — State
 * ---------------------------------------------------------------------------
 * The wizard is a ten-step form flow, so everything the administrator types
 * has to survive step changes, a page reload, a lost session or a browser
 * restart. State therefore lives in two places at once:
 *
 *   1. PHP session  — fast, per-visitor, no disk writes.
 *   2. A JSON file  — `install/.install-state.json`, so a session timeout (very
 *                     common on shared hosting) does not throw the whole
 *                     installation away.
 *
 * Secrets never leave the state file: the database password is written with
 * mode 0600 and can be erased once the configuration files exist, and the
 * administrator password is hashed with bcrypt at collection time so the plain
 * text never touches the disk.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class State
{
    public const TOTAL_STEPS = 10;
    public const SESSION_KEY = 'rmudts_install_state';

    /** Abandoned wizards expire after four hours (in seconds). */
    public const TTL = 14400;

    /** Step titles, used by the wizard shell and the report. */
    public const STEPS = [
        1  => 'Welcome',
        2  => 'Requirements Check',
        3  => 'File Storage Configuration',
        4  => 'Database Configuration',
        5  => 'Database Provisioning',
        6  => 'Application Configuration',
        7  => 'Super Administrator',
        8  => 'Security Configuration',
        9  => 'Installation Summary',
        10 => 'Complete',
    ];

    private static bool $started = false;

    private static array $data = [];

    /** Where the state file currently lives (install/, then config/, then tmp). */
    private static string $statePath = '';

    // ---------------------------------------------------------------- boot --

    public static function start(): void
    {
        if (self::$started) {
            return;
        }
        self::$started = true;

        self::startSession();
        self::$statePath = self::resolveStatePath();

        $file = Support::readJson(self::$statePath);
        $session = (array) ($_SESSION[self::SESSION_KEY] ?? []);
        // The file is more durable than the session, so it wins on conflicts.
        self::$data = array_replace_recursive($session, $file);

        // A finished installation needs no wizard state. Persisting `opened_at`
        // here would recreate the file the lock screen is supposed to leave
        // behind, so stop before anything is written.
        if (self::$data === [] && Lock::exists()) {
            return;
        }

        // Abandoned installation sessions expire: a half-finished wizard that
        // nobody completed must not be resumed a week later with stale paths.
        $started = (int) (self::$data['opened_at'] ?? 0);
        if ($started > 0 && (time() - $started) > self::TTL && !self::isComplete(self::TOTAL_STEPS)) {
            self::reset();
            self::$data = ['opened_at' => time()];
            self::persist();
            return;
        }
        if ($started === 0) {
            self::$data['opened_at'] = time();
            self::persist();
        }
    }

    private static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        if (session_status() === PHP_SESSION_DISABLED) {
            return;
        }
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        @ini_set('session.use_strict_mode', '1');
        @ini_set('session.use_only_cookies', '1');
        @ini_set('session.cookie_httponly', '1');
        @session_set_cookie_params([
            'httponly' => true,
            'secure'   => $secure,
            'samesite' => 'Lax',
            'path'     => '/',
        ]);
        @session_name('RMUDTSINSTALL');
        @session_start();
    }

    /**
     * Prefer the installer directory (it is guaranteed writable — the lock file
     * goes there), fall back to the configured config folder, then to the
     * system temp directory so the wizard always has somewhere to remember
     * progress.
     */
    private static function resolveStatePath(): string
    {
        $candidates = [Paths::stateFile()];
        $config = (string) (self::peek()['paths']['config'] ?? '');
        if ($config !== '') {
            $candidates[] = rtrim($config, '/\\') . DIRECTORY_SEPARATOR . 'install-state.json';
        }
        $candidates[] = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'rmudts-install-state.json';

        foreach ($candidates as $candidate) {
            $dir = dirname($candidate);
            if (Support::isWritable($dir)) {
                return $candidate;
            }
        }
        return $candidates[0];
    }

    /** Read what is already on disk without starting a session (bootstrapping). */
    private static function peek(): array
    {
        return Support::readJson(Paths::stateFile());
    }

    // --------------------------------------------------------------- access --

    public static function all(): array
    {
        return self::$data;
    }

    public static function get(string $key, $default = null)
    {
        return self::$data[$key] ?? $default;
    }

    public static function set(array $values): void
    {
        self::$data = array_replace_recursive(self::$data, $values);
        self::persist();
    }

    /** Overwrite a whole branch, e.g. set('db', [...]) replacing db entirely. */
    public static function put(string $key, array $values): void
    {
        self::$data[$key] = $values;
        self::persist();
    }

    public static function forget(string $key): void
    {
        unset(self::$data[$key]);
        self::persist();
    }

    public static function has(string $key): bool
    {
        return isset(self::$data[$key]) && self::$data[$key] !== '' && self::$data[$key] !== [];
    }

    // ----------------------------------------------------------- step model --

    public static function step(): int
    {
        $step = (int) (self::$data['step'] ?? 1);
        return max(1, min(self::TOTAL_STEPS, $step));
    }

    public static function goTo(int $step): void
    {
        self::$data['step'] = max(1, min(self::TOTAL_STEPS, $step));
        self::persist();
    }

    /** Step numbers whose action has completed successfully. */
    public static function completed(): array
    {
        $done = self::$data['completed'] ?? [];
        $done = is_array($done) ? array_map('intval', $done) : [];
        sort($done);
        return $done;
    }

    public static function isComplete(int $step): bool
    {
        return in_array($step, self::completed(), true);
    }

    public static function markComplete(int $step): void
    {
        $done = self::completed();
        if (!in_array($step, $done, true)) {
            $done[] = $step;
        }
        self::$data['completed'] = $done;
        self::persist();
    }

    public static function unmarkFrom(int $step): void
    {
        self::$data['completed'] = array_values(array_filter(
            self::completed(),
            static fn(int $n): bool => $n < $step
        ));
        self::persist();
    }

    /** Lowest step that still needs work — used by "resume installation". */
    public static function resumeStep(): int
    {
        for ($i = 2; $i <= self::TOTAL_STEPS; $i++) {
            if (!self::isComplete($i)) {
                return $i;
            }
        }
        return self::TOTAL_STEPS;
    }

    public static function percent(): int
    {
        $done = count(array_filter(self::completed(), static fn(int $n): bool => $n > 0 && $n < self::TOTAL_STEPS));
        return (int) min(100, round($done / (self::TOTAL_STEPS - 1) * 100));
    }

    /** Seconds remaining before this wizard session expires automatically. */
    public static function expiresIn(): int
    {
        $started = (int) (self::$data['opened_at'] ?? time());
        return max(0, $started + self::TTL - time());
    }

    /** Restart the expiry clock (called after every successful step). */
    public static function touch(): void
    {
        self::$data['opened_at'] = time();
        self::persist();
    }

    // ------------------------------------------------------------------ log --

    public static function log(string $level, string $message): void
    {
        $entries = self::$data['log'] ?? [];
        $entries[] = ['at' => date('c'), 'level' => $level, 'message' => $message];
        // Keep the tail bounded; the full log is mirrored to the log directory.
        if (count($entries) > 500) {
            $entries = array_slice($entries, -500);
        }
        self::$data['log'] = $entries;
        self::persist();
    }

    public static function logEntries(): array
    {
        $entries = self::$data['log'] ?? [];
        return is_array($entries) ? $entries : [];
    }

    // -------------------------------------------------------------- persist --

    private static function persist(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION[self::SESSION_KEY] = self::$data;
        }
        if (self::$statePath === '') {
            return;
        }
        Support::writeJson(self::$statePath, self::$data);
    }

    public static function statePath(): string
    {
        return self::$statePath;
    }

    /** Remove the state file + session; used by the Cancel button. */
    public static function reset(bool $removeFile = true): void
    {
        self::$data = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION[self::SESSION_KEY] = [];
            session_regenerate_id(true);
        }
        if ($removeFile && self::$statePath !== '' && is_file(self::$statePath)) {
            @unlink(self::$statePath);
        }
    }

    /** Drop the database password once it has been written to .env. */
    public static function shredDatabasePassword(): void
    {
        if (isset(self::$data['db']['pass'])) {
            self::$data['db']['pass'] = '';
            self::persist();
        }
    }
}

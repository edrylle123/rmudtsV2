<?php
/**
 * RMUDTS Installer — Lock
 * ---------------------------------------------------------------------------
 * `rmudts-config/installed.lock` is the single source of truth for "this copy
 * is live".
 *
 * While the lock exists the whole installer refuses to run, every request is
 * redirected to the application and the message
 *
 *     RMUDTS is already installed.
 *
 * is shown. Only a system administrator who deletes the lock file by hand (in
 * cPanel → File Manager, or over SSH) can re-open the wizard — which is
 * exactly the recovery path documented in docs/INSTALL.md.
 *
 * The lock is written last, after the database, configuration, administrator
 * account and security hardening have all succeeded, so its presence really
 * does mean "nothing left to do".
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Lock
{
    public const FILENAME = 'installed.lock';

    /**
     * Locations checked for the lock, in order. The private configuration
     * folder is canonical; the legacy installer directory is still honoured so
     * a copy installed by an older package stays recognisably installed.
     */
    public static function candidates(): array
    {
        $paths = Paths::defaults();
        $configured = State::get('paths');
        if (is_array($configured) && !empty($configured['config'])) {
            $paths['config'] = (string) $configured['config'];
        }
        $config = rtrim((string) ($paths['config'] ?? ''), '/\\');
        $candidates = [];
        if ($config !== '') {
            $candidates[] = $config . DIRECTORY_SEPARATOR . self::FILENAME;
        }
        $candidates[] = Paths::lockFile();
        $candidates[] = Paths::installDir() . DIRECTORY_SEPARATOR . self::FILENAME;
        return array_values(array_unique($candidates));
    }

    public static function path(): ?string
    {
        foreach (self::candidates() as $candidate) {
            if ($candidate !== '' && is_file($candidate)) {
                return $candidate;
            }
        }
        return null;
    }

    public static function exists(): bool
    {
        foreach (self::candidates() as $candidate) {
            if ($candidate !== '' && is_file($candidate)) {
                return true;
            }
        }
        return false;
    }

    /** @return array<string,mixed> */
    public static function read(): array
    {
        $path = self::path();
        if ($path === null) {
            return [];
        }
        $raw = (string) @file_get_contents($path);
        $data = json_decode($raw, true);
        if (is_array($data)) {
            $data['_path'] = $path;
            return $data;
        }
        return ['_path' => $path, 'installed_at' => trim($raw)];
    }

    /**
     * Write the lock everywhere the installer directory is writable. Returns
     * the list of files created so step 10 can show exactly what happened.
     *
     * @return string[]
     */
    public static function write(array $details): array
    {
        $payload = array_merge(
            [
                'product'      => 'RMUDTS',
                'version'      => Installer::VERSION,
                'installed_at' => date('c'),
                'installed_by' => php_uname('n'),
                'php_version'  => PHP_VERSION,
            ],
            $details
        );
        $contents = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";

        $written = [];
        foreach (self::candidates() as $candidate) {
            if ($candidate === '') {
                continue;
            }
            if (Support::writeFile($candidate, $contents, 0640)) {
                $written[] = $candidate;
            }
        }
        return array_values(array_unique($written));
    }

    /** Human friendly one-liner for the "already installed" screen. */
    public static function message(): string
    {
        $data = self::read();
        $when = (string) ($data['installed_at'] ?? '');
        $version = (string) ($data['version'] ?? Installer::VERSION);
        $stamp = $when !== '' ? date('j F Y \a\t H:i', strtotime($when) ?: time()) : 'an earlier session';
        return 'RMUDTS ' . $version . ' was installed on ' . $stamp . '.';
    }
}

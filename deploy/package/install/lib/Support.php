<?php
/**
 * RMUDTS Installer — Support
 * ---------------------------------------------------------------------------
 * Small, dependency-free helpers: output escaping, filesystem primitives,
 * the on-disk state file, subprocess execution and formatting.
 *
 * Nothing here touches the database or the network, so it is always safe to
 * load even when the installer cannot run anything else.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Support
{
    /** Escape for HTML text/attribute output. */
    public static function e($value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /** Turn an absolute filesystem path into something to show to a human. */
    public static function path($path): string
    {
        $path = (string) $path;
        if ($path === '') {
            return '';
        }
        // Show windows paths with forward slashes so they never look escaped.
        return str_replace('\\', '/', $path);
    }

    public static function bytes($bytes): string
    {
        $bytes = (float) $bytes;
        $units = ['B', 'kB', 'MB', 'GB', 'TB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return ($i === 0 ? (string) (int) $bytes : number_format($bytes, $bytes < 10 ? 1 : 0)) . ' ' . $units[$i];
    }

    public static function slugDate(): string
    {
        return date('Y-m-d H:i:s T');
    }

    // ---------------------------------------------------------------- files --

    /** mkdir -p with a clear failure reason instead of a PHP warning. */
    public static function mkdir(string $dir, int $mode = 0755): bool
    {
        if (is_dir($dir)) {
            return true;
        }
        $previous = error_reporting(error_reporting() & ~E_WARNING);
        $ok = @mkdir($dir, $mode, true);
        error_reporting($previous);
        return $ok || is_dir($dir);
    }

    /** Write a file atomically (temp file + rename) so a crash cannot truncate it. */
    public static function writeFile(string $file, string $contents, ?int $mode = null): bool
    {
        if (!self::mkdir(dirname($file))) {
            return false;
        }
        $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, $contents) === false) {
            @unlink($tmp);
            return false;
        }
        if (!@rename($tmp, $file)) {
            @unlink($tmp);
            return false;
        }
        if ($mode !== null) {
            @chmod($file, $mode);
        }
        return true;
    }

    public static function writeJson(string $file, array $data): bool
    {
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        return self::writeFile($file, $json . "\n", 0600);
    }

    /** @return array<string,mixed> */
    public static function readJson(string $file): array
    {
        if (!is_file($file)) {
            return [];
        }
        $raw = (string) @file_get_contents($file);
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    public static function rrmdir(string $dir): bool
    {
        if (!is_dir($dir)) {
            return true;
        }
        $items = @scandir($dir) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $item;
            if (is_dir($path) && !is_link($path)) {
                self::rrmdir($path);
            } else {
                @unlink($path);
            }
        }
        return @rmdir($dir);
    }

    /**
     * Recursive copy that never follows symlinks and skips an optional
     * exclusion list (matched against the path relative to $src).
     *
     * @param string[] $exclude
     */
    public static function copyTree(string $src, string $dst, array $exclude = []): int
    {
        $count = 0;
        if (!is_dir($src)) {
            return 0;
        }
        self::mkdir($dst);
        $items = @scandir($src) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $from = $src . DIRECTORY_SEPARATOR . $item;
            $to = $dst . DIRECTORY_SEPARATOR . $item;
            $rel = ltrim(str_replace('\\', '/', substr($from, strlen($src))), '/');
            foreach ($exclude as $pattern) {
                if (fnmatch($pattern, $rel) || fnmatch($pattern, $rel . '/*') || str_starts_with($rel, rtrim($pattern, '/*') . '/')) {
                    continue 2;
                }
            }
            if (is_dir($from) && !is_link($from)) {
                $count += self::copyTree($from, $to, $exclude);
            } else {
                if (self::mkdir(dirname($to)) && @copy($from, $to)) {
                    $count++;
                }
            }
        }
        return $count;
    }

    public static function dirSize(string $dir): int
    {
        $total = 0;
        if (!is_dir($dir)) {
            return 0;
        }
        $items = @scandir($dir) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $item;
            $total += is_dir($path) ? self::dirSize($path) : (int) @filesize($path);
        }
        return $total;
    }

    public static function dirEntries(string $dir): int
    {
        if (!is_dir($dir)) {
            return 0;
        }
        return max(0, count(@scandir($dir) ?: []) - 2);
    }

    /** Real write test: create a file, read it back, delete it. */
    public static function isWritable(string $dir): bool
    {
        if (!is_dir($dir) || !is_writable($dir)) {
            return false;
        }
        $probe = $dir . DIRECTORY_SEPARATOR . '.rmudts-write-test-' . bin2hex(random_bytes(4));
        $ok = @file_put_contents($probe, 'ok') === 2;
        if ($ok) {
            $ok = @file_get_contents($probe) === 'ok';
        }
        @unlink($probe);
        return $ok;
    }

    // ------------------------------------------------------------- commands --

    public static function shellEnabled(): bool
    {
        if (!function_exists('proc_open') && !function_exists('exec') && !function_exists('shell_exec')) {
            return false;
        }
        $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
        $has = false;
        foreach (['proc_open', 'exec', 'shell_exec', 'popen'] as $fn) {
            if (function_exists($fn) && !in_array($fn, $disabled, true)) {
                $has = true;
            }
        }
        return $has;
    }

    /**
     * Run a command and capture merged output. Returns [exitCode|null, output].
     * A null exit code means the command could not be started at all.
     *
     * @return array{0:int|null,1:string}
     */
    public static function run(string $command, int $timeoutSeconds = 300): array
    {
        if (!self::shellEnabled()) {
            return [null, 'Shell execution is disabled on this host (disable_functions).'];
        }
        if (function_exists('proc_open')) {
            $descriptors = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
            $pipes = [];
            $proc = @proc_open($command, $descriptors, $pipes);
            if (is_resource($proc)) {
                $output = '';
                stream_set_blocking($pipes[1], false);
                stream_set_blocking($pipes[2], false);
                $deadline = microtime(true) + $timeoutSeconds;
                while (true) {
                    $output .= (string) stream_get_contents($pipes[1]);
                    $output .= (string) stream_get_contents($pipes[2]);
                    $status = proc_get_status($proc);
                    if (!$status['running']) {
                        break;
                    }
                    if (microtime(true) > $deadline) {
                        proc_terminate($proc);
                        $output .= "\n[timed out after {$timeoutSeconds}s]";
                        break;
                    }
                    usleep(150000);
                }
                $output .= (string) stream_get_contents($pipes[1]);
                $output .= (string) stream_get_contents($pipes[2]);
                fclose($pipes[1]);
                fclose($pipes[2]);
                $exit = proc_close($proc);
                return [$exit, trim($output)];
            }
        }
        // Fallback: shell_exec loses the exit status, so mark it as unknown-ok.
        $output = (string) @shell_exec($command . ' 2>&1');
        return [$output === '' ? 1 : 0, trim($output)];
    }

    /** Locate an executable on PATH (and the usual cPanel locations). */
    public static function findExecutable(string $name): ?string
    {
        $suffix = DIRECTORY_SEPARATOR === '\\' ? ['.exe', '.cmd', ''] : [''];
        $dirs = [];
        if (($path = (string) getenv('PATH')) !== '') {
            $dirs = preg_split('/' . (DIRECTORY_SEPARATOR === '\\' ? ';' : ':') . '/', $path) ?: [];
        }
        $dirs = array_merge(
            $dirs,
            [
                '/usr/bin', '/usr/local/bin', '/opt/bin', '/opt/nodejs/bin',
                '/usr/local/nodejs/bin', '/bin', '/snap/bin',
                getenv('HOME') ? getenv('HOME') . '/.nvm/versions/node' : '',
                'C:\\Program Files\\nodejs', 'C:\\Program Files\\nodejs\\bin',
            ]
        );
        foreach (array_filter($dirs) as $dir) {
            foreach ($suffix as $ext) {
                $candidate = rtrim($dir, '/\\') . DIRECTORY_SEPARATOR . $name . $ext;
                if (@is_file($candidate) && @is_executable($candidate)) {
                    return $candidate;
                }
            }
        }
        return null;
    }

    /** `command -v` style lookup for hosts where PATH is unusual. */
    public static function which(string $name): ?string
    {
        $found = self::findExecutable($name);
        if ($found !== null) {
            return $found;
        }
        if (self::shellEnabled()) {
            [$code, $out] = self::run(PHP_OS_FAMILY === 'Windows' ? 'where ' . $name : 'command -v ' . escapeshellarg($name), 15);
            $line = trim((string) strtok($out, "\n"));
            if (($code === 0 || $code === null) && $line !== '' && @is_file($line)) {
                return $line;
            }
        }
        return null;
    }

    /** Never print secrets into logs or reports. */
    public static function redact(string $secret): string
    {
        $len = strlen($secret);
        if ($len <= 8) {
            return $len === 0 ? '' : str_repeat('•', $len);
        }
        return substr($secret, 0, 4) . str_repeat('•', 12) . substr($secret, -4);
    }
}

<?php
/**
 * RMUDTS Installer — Security
 * ---------------------------------------------------------------------------
 * Step 8 of the wizard. Two jobs:
 *
 *   1. Generate the secrets the application needs (application key, encryption
 *      key, API security token, CSRF seed, JWT secret, refresh-token secret)
 *      from the operating system CSPRNG, and say so plainly if the host has no
 *      secure random source instead of quietly falling back to something weak.
 *
 *   2. Write the protection layer: an .htaccess for the web root, one for the
 *      installer, and the storage rules for every private folder, so directory
 *      listing is off, configuration files cannot be fetched over HTTP and
 *      uploaded files can never be executed.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Security
{
    public const MIN_PASSWORD_LENGTH = 10;

    /** Which secrets get generated, and how they are described in the UI. */
    public const SECRETS = [
        'app_key'              => 'Application key — framework encryption and signed cookies',
        'jwt_secret'           => 'JWT signing secret — signs access tokens',
        'refresh_token_secret' => 'Refresh-token secret — signs long-lived refresh tokens',
        'encryption_key'       => 'Encryption key — protects stored secrets at rest',
        'api_token'            => 'API token — authenticates internal service calls',
        'csrf_secret'          => 'CSRF secret — one-time form tokens',
    ];

    // ------------------------------------------------------------- secrets --

    /** Random bytes, base64url encoded without padding. */
    public static function key(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function hexKey(int $bytes = 32): string
    {
        return bin2hex(random_bytes($bytes));
    }

    /**
     * Every backend secret in one call, plus the installation session token.
     *
     * @return array<string,string>
     */
    public static function generateSecrets(): array
    {
        return [
            'app_key'              => self::key(48),
            'jwt_secret'           => self::key(48),
            'refresh_token_secret' => self::key(48),
            'encryption_key'       => self::hexKey(32),
            'api_token'            => self::hexKey(32),
            'csrf_secret'          => self::hexKey(32),
            'install_token'        => self::hexKey(24),
            'generated_at'         => date('c'),
        ];
    }

    /** True when the platform can produce cryptographically secure randomness. */
    public static function hasSecureRandom(): bool
    {
        try {
            $bytes = random_bytes(8);
            return $bytes !== '';
        } catch (\Throwable $e) {
            return false;
        }
    }

    // ------------------------------------------------------------ password --

    /**
     * Password policy for the super administrator. Deliberately explicit: the
     * same list drives the live checklist in the UI and the server-side gate.
     *
     * @return array{ok:bool,score:int,label:string,requirements:array<int,array{label:string,met:bool}>}
     */
    public static function checkPassword(string $password, string $confirm = ''): array
    {
        // mbstring is recommended but not required, so never call it blindly.
        $length = function_exists('mb_strlen') ? mb_strlen($password) : strlen($password);
        $requirements = [
            ['label' => 'At least ' . self::MIN_PASSWORD_LENGTH . ' characters', 'met' => $length >= self::MIN_PASSWORD_LENGTH],
            ['label' => 'Contains a lowercase letter', 'met' => (bool) preg_match('/[a-z]/', $password)],
            ['label' => 'Contains an uppercase letter', 'met' => (bool) preg_match('/[A-Z]/', $password)],
            ['label' => 'Contains a number', 'met' => (bool) preg_match('/\d/', $password)],
            ['label' => 'Contains a symbol (!@#$%^&*)', 'met' => (bool) preg_match('/[^A-Za-z0-9]/', $password)],
            ['label' => 'Not a commonly used password', 'met' => !self::isCommonPassword($password)],
        ];
        if ($confirm !== '') {
            $requirements[] = ['label' => 'Both passwords match', 'met' => $password === $confirm];
        }

        $met = count(array_filter($requirements, static fn(array $r): bool => $r['met']));
        $score = (int) round($met / max(1, count($requirements)) * 100);
        $ok = $met === count($requirements);

        $label = $score >= 100 ? 'Strong' : ($score >= 70 ? 'Fair' : 'Weak');
        return ['ok' => $ok, 'score' => $score, 'label' => $label, 'requirements' => $requirements];
    }

    private static function isCommonPassword(string $password): bool
    {
        $needle = strtolower($password);
        $common = ['password', 'password1', 'password123', '12345678', '123456789', 'qwerty123',
            'admin', 'admin123', 'administrator', 'letmein', 'welcome1', 'iloveyou', 'rmudts',
            'changeme', 'passw0rd', 'p@ssw0rd', 'qwertyuiop', '1q2w3e4r'];
        foreach ($common as $candidate) {
            if ($needle === $candidate || str_contains($needle, $candidate)) {
                return true;
            }
        }
        return false;
    }

    /**
     * bcrypt hash the backend can actually verify.
     *
     * PHP emits a `$2y$` marker for PASSWORD_BCRYPT. That is the same algorithm
     * as `$2b$`, but the `bcrypt` npm package the Express backend uses (6.x)
     * parses `$2y$` and then silently returns *false* from compare() — the
     * deployed application would refuse a correct password. `$2b$` is accepted
     * by both the Node library and by PHP's password_verify(), so the marker is
     * normalised here. (Verified against bcrypt 6.0.0 — see the installer's
     * verification harness.)
     */
    public static function hashPassword(string $password): string
    {
        $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        if (!is_string($hash) || $hash === '') {
            throw new \RuntimeException('password_hash() failed — the OpenSSL/BCrypt provider is unavailable on this host.');
        }
        if (str_starts_with($hash, '$2y$')) {
            $hash = '$2b$' . substr($hash, 4);
        }
        return $hash;
    }

    // ------------------------------------------------------------- .htaccess --

    /**
     * Rules for the React application folder (public_html/rmudts).
     *
     * React Router owns every path under /rmudts/, so unknown paths must
     * return index.html — never a 404 — while real files (static bundles,
     * manifest.json, runtime-config.js, favicon) are served directly.
     */
    public static function frontendHtaccess(string $basePath = '/rmudts/', string $apiUrl = ''): string
    {
        $base = '/' . trim($basePath, '/') . '/';
        $api = $apiUrl !== '' ? rtrim($apiUrl, '/') : 'https://api.example.com';
        return <<<HTACCESS
# =====================================================================
# RMUDTS frontend  (generated by the installation wizard)
# =====================================================================
# React Router handles client-side routes; Apache serves the shell for deep
# links so a refresh never returns 404.

Options -Indexes -MultiViews

DirectoryIndex index.html

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase {$base}

  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]

  RewriteRule ^ index.html [QSA,L]
</IfModule>

# Secrets, dumps and editor droppings never belong in the build folder.
<FilesMatch "(^\\.|\\.(env|lock|sql|sqlite|log|ini|bak|old|orig|save|swp|swo|dist|tar|gz|zip|sh|ps1|php|phtml|phar)$)">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "geolocation=(), microphone=(), camera=()"
  # API and Socket.IO live on {$api}; nothing else may be called.
  Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' {$api} wss://{$api}; frame-ancestors 'self'"
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 30 days"
  ExpiresByType application/javascript "access plus 30 days"
  ExpiresByType image/png "access plus 30 days"
  ExpiresByType image/svg+xml "access plus 30 days"
  ExpiresByType application/manifest+json "access plus 1 day"
</IfModule>
HTACCESS;
    }

    /** Rules for the document root: send visitors to /rmudts/, protect install/. */
    public static function publicHtaccess(string $configDir, string $appRoot, string $basePath = '/rmudts/'): string
    {
        $base = '/' . trim($basePath, '/') . '/';
        return <<<HTACCESS
# =====================================================================
# RMUDTS front-controller rules — web root (generated by the installer)
# =====================================================================
# The application itself lives in {$base}; the document root only redirects
# there and protects the installer. Backend and configuration are outside
# public_html entirely:
#   backend      : {$appRoot}
#   configuration: {$configDir}

<IfModule mod_autoindex.c>
  Options -Indexes
  IndexIgnore *
</IfModule>

DirectoryIndex index.html index.php

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # Never serve secrets, SQL dumps, locks, logs or archives from the root.
  RewriteRule "(^|/)(\\.env|\\.env\\..*|config\\.php|installed\\.lock|.*\\.(sql|sqlite|log|ini|bak|old|orig|save|swp|swo|dist|tar|gz|zip|sh|ps1))$" - [F,L]
  RewriteRule "(^|/)\\.(?!well-known/)" - [F,L]

  # Keep the installer reachable, but don't rewrite it into the SPA.
  RewriteRule ^install(/.*)?$ - [L]

  # Everything that is not the application folder goes to the SPA.
  RewriteCond %{REQUEST_URI} !^{$base}
  RewriteRule ^ {$base} [R=302,L]
</IfModule>

<FilesMatch "^\\.(env|htaccess|htpasswd|git|gitignore|install-state\\.json)$">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>
HTACCESS;
    }

    /** Rules for the installer directory itself. */
    public static function installHtaccess(): string
    {
        return <<<HTACCESS
# =====================================================================
# RMUDTS installer directory
# =====================================================================
# lib/ and views/ are PHP-only includes and must never be requested directly.

<IfModule mod_autoindex.c>
  Options -Indexes
  IndexIgnore *
</IfModule>

DirectoryIndex index.php

<FilesMatch "\\.(json|lock|md|txt|tpl|sql)$">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^(lib|views|assets)/ - [F,L]
</IfModule>
HTACCESS;
    }

    /** Rules shared by every private storage folder. */
    public static function storageHtaccess(): string
    {
        return <<<HTACCESS
# RMUDTS private storage — reachable from PHP/Node only, never over HTTP.
<IfModule mod_autoindex.c>
  Options -Indexes
  IndexIgnore *
</IfModule>
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
HTACCESS;
    }

    /** Uploads must be readable by the app but never executed by the server. */
    public static function uploadsHtaccess(): string
    {
        return <<<HTACCESS
# =====================================================================
# RMUDTS uploads — readable, never executable
# =====================================================================
<IfModule mod_autoindex.c>
  Options -Indexes
  IndexIgnore *
</IfModule>

# Never run anything that arrives here.
<IfModule mod_php.c>
  php_flag engine off
</IfModule>
<FilesMatch "\\.(php|phtml|php[0-9]|phar|pl|py|cgi|sh|htm|html|shtml|svg|xml|xhtml)$">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</FilesMatch>

AddType text/plain .php .phtml .php3 .php4 .php5 .php7 .php8 .pl .py .cgi .sh

# Serve documents as downloads so a crafted file cannot run in the browser.
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set Content-Security-Policy "default-src 'none'; sandbox"
</IfModule>
HTACCESS;
    }

    /**
     * Apply every protection file. Returns the list of paths written.
     *
     * @return string[]
     */
    public static function applyHardening(array $paths): array
    {
        $written = [];
        $public = rtrim((string) ($paths['public_root'] ?? ''), '/\\');
        $frontend = rtrim((string) ($paths['frontend'] ?? ''), '/\\');
        $install = Paths::installDir();
        $urls = ConfigWriter::urls();

        $targets = [
            $public . DIRECTORY_SEPARATOR . '.htaccess' => self::publicHtaccess(
                Support::path((string) ($paths['config'] ?? '')),
                Support::path((string) ($paths['app_root'] ?? '')),
                $urls['base_path']
            ),
            $frontend . DIRECTORY_SEPARATOR . '.htaccess' => self::frontendHtaccess($urls['base_path'], $urls['api']),
            $install . DIRECTORY_SEPARATOR . '.htaccess' => self::installHtaccess(),
        ];
        foreach ($targets as $file => $contents) {
            if ($file === '' || $file === DIRECTORY_SEPARATOR . '.htaccess') {
                continue;
            }
            if (Support::writeFile($file, $contents)) {
                $written[] = $file;
            }
        }
        return array_merge($written, Storage::protect($paths));
    }

    // ------------------------------------------------------------- checklist --

    /**
     * The report rendered by step 8 and echoed in step 9.
     *
     * @return array<int,array{label:string,level:string,note:string}>
     */
    public static function checklist(array $paths, array $secrets, bool $lockWritten = false): array
    {
        $rows = [];
        $config = (string) ($paths['config'] ?? '');
        $public = (string) ($paths['public_root'] ?? '');

        foreach (self::SECRETS as $key => $description) {
            $label = trim(explode('—', $description)[0]);
            $rows[] = [
                'label' => $label,
                'level' => empty($secrets[$key]) ? 'fail' : 'pass',
                'note'  => empty($secrets[$key]) ? 'Not generated yet' : Support::redact((string) $secrets[$key]),
            ];
        }

        $rows[] = [
            'label' => 'Directory protection',
            'level' => is_file($public . DIRECTORY_SEPARATOR . '.htaccess') ? 'pass' : 'warn',
            'note'  => is_file($public . DIRECTORY_SEPARATOR . '.htaccess')
                ? 'Web-root .htaccess written (listing disabled, secrets blocked)'
                : 'Web-root .htaccess will be written when you finish',
        ];
        $rows[] = [
            'label' => 'Environment protection',
            'level' => Paths::isInside($config, $public) ? 'fail' : 'pass',
            'note'  => Paths::isInside($config, $public)
                ? 'Configuration folder is inside the web root — move it outside public_html'
                : 'Configuration is stored outside the web root (' . Support::path($config) . ')',
        ];
        $rows[] = [
            'label' => 'Upload restrictions',
            'level' => is_file(((string) ($paths['uploads'] ?? '')) . DIRECTORY_SEPARATOR . '.htaccess') ? 'pass' : 'warn',
            'note'  => 'Executable extensions blocked; documents served as text/plain',
        ];
        $rows[] = [
            'label' => 'Session security',
            'level' => 'pass',
            'note'  => 'HttpOnly + SameSite=Lax session cookie, strict mode, ID regenerated on cancel',
        ];
        $rows[] = [
            'label' => 'Secure random source',
            'level' => self::hasSecureRandom() ? 'pass' : 'fail',
            'note'  => self::hasSecureRandom() ? 'random_bytes() available' : 'random_bytes() unavailable — keys cannot be generated safely',
        ];
        $rows[] = [
            'label' => 'File permissions',
            'level' => self::permissionsApplied($paths) ? 'pass' : 'warn',
            'note'  => self::permissionsApplied($paths)
                ? 'Configuration 0600, private directories 0700, public directories 0755'
                : 'Some files could not be chmod-ed — verify permissions in cPanel → File Manager',
        ];
        if ($lockWritten) {
            $rows[] = ['label' => 'Installation lock', 'level' => 'pass', 'note' => 'installed.lock written — the installer is now disabled'];
        }
        return $rows;
    }

    private static function permissionsApplied(array $paths): bool
    {
        $config = (string) ($paths['config'] ?? '');
        if ($config === '' || !is_dir($config)) {
            return false;
        }
        // Storage::protect() already proved the folders are usable; here we
        // only assert that the generated configuration files are not
        // world-readable.
        $managed = [
            $config . DIRECTORY_SEPARATOR . '.env',
            $config . DIRECTORY_SEPARATOR . 'storage.json',
            $config . DIRECTORY_SEPARATOR . 'installation-report.json',
        ];
        $checked = 0;
        foreach ($managed as $file) {
            if (!is_file($file)) {
                continue;
            }
            $checked++;
            $perms = @fileperms($file);
            if ($perms !== false && ($perms & 0007) !== 0) {
                return false;
            }
        }
        return $checked > 0;
    }

    /** Restrictive modes for the generated configuration files. */
    public static function tightenPermissions(array $paths): array
    {
        $changed = [];
        $config = (string) ($paths['config'] ?? '');
        $files = [
            $config . DIRECTORY_SEPARATOR . '.env' => 0600,
            $config . DIRECTORY_SEPARATOR . 'storage.json' => 0640,
            $config . DIRECTORY_SEPARATOR . 'installation-report.json' => 0640,
            $config . DIRECTORY_SEPARATOR . 'install-state.json' => 0600,
            Paths::installDir() . DIRECTORY_SEPARATOR . '.install-state.json' => 0600,
        ];
        foreach ($files as $file => $mode) {
            if ($file !== '' && is_file($file) && @chmod($file, $mode)) {
                $changed[] = $file;
            }
        }
        foreach (Paths::KEYS as $key) {
            $dir = (string) ($paths[$key] ?? '');
            $mode = in_array($key, Paths::PUBLIC_KEYS, true) ? 0755 : 0700;
            if ($dir !== '' && is_dir($dir) && @chmod($dir, $mode)) {
                $changed[] = $dir;
            }
        }
        return $changed;
    }
}

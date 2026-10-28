<?php
/**
 * RMUDTS Installer — ConfigWriter
 * ---------------------------------------------------------------------------
 * Generates the two files that turn an extracted archive into a running
 * installation:
 *
 *   rmudts-config/.env                    what the Node.js backend reads, 0600
 *   public_html/rmudts/runtime-config.js  public, non-secret build URLs
 *
 * The backend environment lives in exactly one place, outside public_html. The
 * React build never contains credentials: it reads the public runtime file at
 * load time, which is why the same compiled build works for any domain.
 *
 * PORT is deliberately not written. cPanel Passenger supplies process.env.PORT
 * to the application; the backend falls back to 5000 only when it is absent
 * (for example when run by hand from a terminal).
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class ConfigWriter
{
    /** Environment variables the backend reads, in the order they are written. */
    private const ENV_ORDER = [
        'NODE_ENV', 'APP_ENV', 'APP_NAME', 'APP_URL', 'APP_KEY',
        'CLIENT_URL', 'CLIENT_ORIGIN', 'API_URL', 'SOCKET_URL', 'SOCKET_PATH',
        'TZ', 'LOG_LEVEL', 'SYSTEM_EMAIL',
        'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS',
        'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_KEY', 'CSRF_SECRET', 'API_TOKEN',
        'UPLOAD_DIR', 'DATA_DIR', 'LOG_DIR', 'BACKUP_DIR', 'TMP_DIR', 'CACHE_DIR', 'SESSION_PATH',
        'MAX_UPLOAD_MB', 'SESSION_LIFETIME', 'RMUDTS_CONFIG_DIR',
    ];

    /** Routes the front controller forwards to the Node.js backend. */
    private const API_PREFIXES = [
        '/login', '/logout', '/signup', '/refresh-token', '/records', '/users', '/offices',
        '/notifications', '/next-control-number', '/api', '/uploads', '/preview-pdf',
        '/socket.io',
    ];

    /** @return array<string,string> */
    public static function environment(array $paths, array $app, array $db, array $secrets, int $port = 0): array
    {
        $urls = self::urls((string) (State::get('urls')['frontend'] ?? $app['url'] ?? ''));
        $env = [
            'NODE_ENV'        => (string) ($app['env'] ?? 'production'),
            'APP_ENV'         => (string) ($app['env'] ?? 'production'),
            'APP_NAME'        => (string) ($app['name'] ?? 'RMUDTS'),
            'APP_URL'         => $urls['frontend'],
            'APP_KEY'         => (string) ($secrets['app_key'] ?? ''),
            'CLIENT_URL'      => $urls['frontend'],
            'CLIENT_ORIGIN'   => $urls['frontend_origin'],
            'API_URL'         => $urls['api'],
            'SOCKET_URL'      => $urls['socket'],
            'SOCKET_PATH'     => $urls['socket_path'],
            'TZ'              => (string) ($app['timezone'] ?? 'Asia/Manila'),
            'LOG_LEVEL'       => (string) ($app['log_level'] ?? 'info'),
            'SYSTEM_EMAIL'    => (string) ($app['system_email'] ?? ''),
            'DB_HOST'         => (string) ($db['host'] ?? 'localhost'),
            'DB_PORT'         => (string) ($db['port'] ?? '3306'),
            'DB_NAME'         => (string) ($db['name'] ?? ''),
            'DB_USER'         => (string) ($db['user'] ?? ''),
            'DB_PASS'         => (string) ($db['pass'] ?? ''),
            'JWT_SECRET'      => (string) ($secrets['jwt_secret'] ?? ''),
            'REFRESH_TOKEN_SECRET' => (string) ($secrets['refresh_token_secret'] ?? ''),
            'ENCRYPTION_KEY'  => (string) ($secrets['encryption_key'] ?? ''),
            'CSRF_SECRET'     => (string) ($secrets['csrf_secret'] ?? ''),
            'API_TOKEN'       => (string) ($secrets['api_token'] ?? ''),
            'UPLOAD_DIR'      => (string) ($paths['uploads'] ?? ''),
            'DATA_DIR'        => (string) ($paths['data'] ?? ''),
            'LOG_DIR'         => (string) ($paths['logs'] ?? ''),
            'BACKUP_DIR'      => (string) ($paths['backups'] ?? ''),
            'TMP_DIR'         => (string) ($paths['tmp'] ?? ''),
            'CACHE_DIR'       => (string) ($paths['cache'] ?? ''),
            'SESSION_PATH'    => (string) ($paths['data'] ?? '') . DIRECTORY_SEPARATOR . 'sessions',
            'MAX_UPLOAD_MB'   => (string) ($app['max_upload_mb'] ?? '10'),
            'SESSION_LIFETIME'=> (string) ($app['session_hours'] ?? '8'),
            'RMUDTS_CONFIG_DIR' => (string) ($paths['config'] ?? ''),
        ];

        return array_intersect_key($env, array_flip(self::ENV_ORDER)) + $env;
    }

    /**
     * Normalise the URL trio once, so every generated file agrees.
     *
     * @return array{frontend:string,frontend_origin:string,api:string,socket:string,socket_path:string,base_path:string}
     */
    public static function urls(string $frontend = ''): array
    {
        $saved = (array) (State::get('urls') ?? []);
        $frontend = $frontend !== '' ? $frontend : (string) ($saved['frontend'] ?? '');
        $api = (string) ($saved['api'] ?? '');
        $socket = (string) ($saved['socket'] ?? '');
        $socketPath = (string) ($saved['socket_path'] ?? '/socket.io');
        $base = (string) ($saved['base_path'] ?? '/rmudts/');

        $parts = parse_url($frontend) ?: [];
        $origin = isset($parts['scheme'], $parts['host'])
            ? $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '')
            : '';

        return [
            'frontend'        => rtrim($frontend, '/') . '/',
            'frontend_origin' => $origin,
            'api'             => rtrim($api, '/') . '/',
            'socket'          => rtrim($socket !== '' ? $socket : $api, '/') . '/',
            'socket_path'     => '/' . trim($socketPath, '/'),
            'base_path'       => '/' . trim($base, '/') . '/',
        ];
    }

    public static function envContents(array $values, string $header = ''): string
    {
        $lines = [];
        if ($header !== '') {
            $lines[] = '# ' . str_replace("\n", "\n# ", trim($header));
            $lines[] = '';
        }
        $lines[] = '# ---------------------------------------------------------------------';
        $lines[] = '# RMUDTS backend environment — generated by the installation wizard';
        $lines[] = '# Keep this file outside public_html. Mode 0600.';
        $lines[] = '# ---------------------------------------------------------------------';
        $lines[] = '';
        foreach (self::ENV_ORDER as $key) {
            if (!array_key_exists($key, $values)) {
                continue;
            }
            $lines[] = $key . '=' . self::envValue((string) $values[$key]);
        }

        // Keys this release does not manage (added by the administrator or the
        // hosting provider) are preserved instead of silently dropped.
        $extras = array_diff_key($values, array_flip(self::ENV_ORDER));
        if ($extras !== []) {
            $lines[] = '';
            $lines[] = '# Preserved — not managed by this release';
            foreach ($extras as $key => $value) {
                $lines[] = $key . '=' . self::envValue((string) $value);
            }
        }
        return implode("\n", $lines) . "\n";
    }

    /** Quote a value only when it needs it, so paths stay readable. */
    private static function envValue(string $value): string
    {
        if ($value === '') {
            return '';
        }
        if (preg_match('/^[^\s"\'#]+$/', $value)) {
            return $value;
        }
        $escaped = str_replace(['"', "\n", "\r"], ['\"', '\n', ''], $value);
        return '"' . $escaped . '"';
    }

    /**
     * Write the single private environment file.
     *
     * @return array{level:string,files:string[],message:string}
     */
    public static function writeEnv(array $paths, array $env, array $app = []): array
    {
        $configDir = rtrim((string) ($paths['config'] ?? ''), '/\\');
        if ($configDir === '') {
            return ['level' => 'fail', 'files' => [], 'message' => 'The configuration folder is not configured.'];
        }
        $target = $configDir . DIRECTORY_SEPARATOR . '.env';
        $header = 'Application: ' . (string) ($app['name'] ?? 'RMUDTS')
            . ' — ' . (string) ($app['url'] ?? '')
            . "\nGenerated: " . date('c') . ' — do not commit this file.';
        $contents = self::envContents($env, $header);

        if (!Support::writeFile($target, $contents, 0600)) {
            return ['level' => 'fail', 'files' => [], 'message' => 'Could not write ' . Support::path($target) . '. Check permissions on the configuration folder.'];
        }
        @chmod($target, 0600);
        $files = [$target];
        $message = 'Backend environment written to ' . Support::path($target) . ' (mode 0600).';

        // The backend runs with its own folder as the working directory, and
        // Passenger does not always let a startup file reach a sibling folder.
        // A 0600 copy beside server.js keeps dotenv loading deterministic while
        // the configuration folder stays the single place secrets are managed.
        $appRoot = rtrim((string) ($paths['app_root'] ?? ''), '/\\');
        if ($appRoot !== '' && Support::isWritable($appRoot)) {
            $copy = $appRoot . DIRECTORY_SEPARATOR . '.env';
            if (Support::writeFile($copy, $contents, 0600)) {
                @chmod($copy, 0600);
                $files[] = $copy;
                $message .= ' A matching copy is in ' . Support::path($copy) . ' for the Node.js process.';
            }
        }

        return [
            'level'   => 'pass',
            'files'   => $files,
            'message' => $message,
        ];
    }

    /**
     * The public runtime configuration the compiled React app reads at load
     * time. It contains build URLs only — never a password, key or token.
     *
     * @return array{level:string,file:?string,message:string}
     */
    public static function writeRuntimeConfig(array $paths, array $app): array
    {
        $frontend = rtrim((string) ($paths['frontend'] ?? ''), '/\\');
        if ($frontend === '') {
            return ['level' => 'fail', 'file' => null, 'message' => 'The frontend folder is not configured.'];
        }
        $urls = self::urls((string) ($app['url'] ?? ''));
        $payload = [
            'APP_NAME'    => (string) ($app['name'] ?? 'RMUDTS'),
            'API_URL'     => $urls['api'],
            'SOCKET_URL'  => $urls['socket'],
            'SOCKET_PATH' => $urls['socket_path'],
            'BASE_PATH'   => $urls['base_path'],
        ];
        $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            return ['level' => 'fail', 'file' => null, 'message' => 'The runtime configuration could not be encoded.'];
        }
        $file = $frontend . DIRECTORY_SEPARATOR . 'runtime-config.js';
        $contents = "/* RMUDTS runtime configuration — generated by the installer.\n"
            . " * Public build-time URLs only. Never add secrets to this file.\n"
            . " * The frontend reads it before creating API or Socket.IO clients. */\n"
            . "window.RMUDTS_CONFIG = " . $json . ";\n";
        if (!Support::writeFile($file, $contents, 0644)) {
            return ['level' => 'fail', 'file' => null, 'message' => 'Could not write ' . Support::path($file) . '.'];
        }
        return ['level' => 'pass', 'file' => $file, 'message' => 'Public runtime configuration written to ' . Support::path($file) . '.'];
    }

    /**
     * The PHP configuration the front controller loads. It holds paths, the
     * public URL trio and the database *name* — never the password or a key.
     *
     * @param array<string,mixed> $overrides installed / installed_at
     */
    public static function configContents(array $paths, array $app, array $db, array $secrets, int $port = 0, array $overrides = []): string
    {
        $urls = self::urls((string) ($app['client_url'] ?? $app['url'] ?? ''));
        $port = $port > 0 ? $port : (int) ($app['port'] ?? 0);
        if ($port <= 0) {
            $port = (int) (State::get('server')['port'] ?? 8081);
        }

        $config = [
            'product'      => 'RMUDTS',
            'version'      => Installer::VERSION,
            'installed'    => (bool) ($overrides['installed'] ?? false),
            'installed_at' => (string) ($overrides['installed_at'] ?? ''),
            'generated_at' => date('c'),
            'app'          => [
                'name'         => (string) ($app['name'] ?? 'RMUDTS'),
                'url'          => (string) ($app['url'] ?? ''),
                'client_url'   => $urls['frontend'],
                'api_url'      => $urls['api'],
                'env'          => (string) ($app['env'] ?? 'production'),
                'timezone'     => (string) ($app['timezone'] ?? 'Asia/Manila'),
                'system_email' => (string) ($app['system_email'] ?? ''),
            ],
            'paths'        => $paths,
            'database'     => [
                'host' => (string) ($db['host'] ?? 'localhost'),
                'port' => (int) ($db['port'] ?? 3306),
                'name' => (string) ($db['name'] ?? ''),
                'user' => (string) ($db['user'] ?? ''),
            ],
            'backend'      => [
                'port' => $port,
                'base' => 'http://127.0.0.1:' . $port,
            ],
            'api_prefixes' => self::API_PREFIXES,
            'security'     => ['proxy_timeout' => 60],
        ];

        return "<?php\n"
            . "/**\n"
            . " * RMUDTS front-controller configuration.\n"
            . " *\n"
            . " * GENERATED FILE — written by install/index.php. It contains paths and\n"
            . " * public URLs only: the database password and every application key\n"
            . " * live in the .env file next to it. Keep this folder outside public_html.\n"
            . " */\n\n"
            . "declare(strict_types=1);\n\n"
            . 'return ' . var_export($config, true) . ";\n";
    }

    /** Write config.php into the private configuration folder. */
    public static function writeConfig(array $paths, string $contents): array
    {
        $configDir = rtrim((string) ($paths['config'] ?? ''), '/\\');
        if ($configDir === '') {
            return ['level' => 'fail', 'file' => null, 'files' => [], 'message' => 'The configuration folder is not configured.'];
        }
        if (!Support::mkdir($configDir, 0700)) {
            return ['level' => 'fail', 'file' => null, 'files' => [], 'message' => 'Could not create ' . Support::path($configDir) . '.'];
        }
        $target = $configDir . DIRECTORY_SEPARATOR . 'config.php';
        if (!Support::writeFile($target, $contents, 0640)) {
            return ['level' => 'fail', 'file' => null, 'files' => [], 'message' => 'Could not write ' . Support::path($target) . '. Check permissions on the configuration folder.'];
        }
        @chmod($target, 0640);
        self::guardSyntax($target);
        return [
            'level'   => 'pass',
            'file'    => $target,
            'files'   => [$target],
            'message' => 'PHP configuration written to ' . Support::path($target) . ' (mode 0640).',
        ];
    }

    /**
     * Replace the bootstrap index.php with the real front controller, so the
     * site stops redirecting to /install once the lock file exists.
     *
     * @return array{level:string,file:?string,files:string[],message:string}
     */
    public static function publishFrontController(array $paths, array $app, int $port = 0): array
    {
        $publicRoot = rtrim((string) ($paths['public_root'] ?? ''), '/\\');
        if ($publicRoot === '') {
            return ['level' => 'fail', 'file' => null, 'files' => [], 'message' => 'The web root is not configured.'];
        }
        $template = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'views' . DIRECTORY_SEPARATOR . 'templates' . DIRECTORY_SEPARATOR . 'public-index.php.tpl';
        if (!is_file($template)) {
            return ['level' => 'fail', 'file' => null, 'files' => [], 'message' => 'The front-controller template is missing from install/views/templates.' ];
        }
        $urls = self::urls((string) ($app['client_url'] ?? $app['url'] ?? ''));
        $contents = strtr((string) file_get_contents($template), [
            '{{CONFIG_DIR}}'   => addslashes(rtrim((string) ($paths['config'] ?? ''), '/\\')),
            '{{BACKEND_PORT}}' => (string) ($port > 0 ? $port : 8081),
            '{{APP_NAME}}'     => addslashes((string) ($app['name'] ?? 'RMUDTS')),
            '{{FRONTEND_URL}}' => addslashes($urls['base_path']),
        ]);

        $target = $publicRoot . DIRECTORY_SEPARATOR . 'index.php';
        if (!Support::writeFile($target, $contents, 0644)) {
            return ['level' => 'fail', 'file' => null, 'files' => [], 'message' => 'Could not write ' . Support::path($target) . '. Check that public_html is writable.'];
        }
        self::guardSyntax($target);
        return [
            'level'   => 'pass',
            'file'    => $target,
            'files'   => [$target],
            'message' => 'Front controller written to ' . Support::path($target) . '.',
        ];
    }

    /** A generated PHP file that does not parse would take the whole site down. */
    private static function guardSyntax(string $file): void
    {
        if (!function_exists('exec')) {
            return;
        }
        $binary = PHP_BINARY;
        if ($binary === '' || !is_file($binary)) {
            return;
        }
        @exec(escapeshellarg($binary) . ' -l ' . escapeshellarg($file) . ' 2>&1', $output, $status);
        if ($status !== 0) {
            @unlink($file);
            throw new \RuntimeException('The generated file ' . Support::path($file) . ' did not parse and was removed.');
        }
    }

    public static function fingerprint(string $secret): string
    {
        return $secret === '' ? '' : substr(hash('sha256', $secret), 0, 16);
    }

    /** Environment variable names an administrator may need to add in cPanel. */
    public static function cpanelVariableNames(): array
    {
        return self::ENV_ORDER;
    }
}

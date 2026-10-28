<?php
/**
 * RMUDTS Installer — Storage
 * ---------------------------------------------------------------------------
 * Turns the paths chosen in step 4 into a real deployment:
 *
 *   • creates every configured directory (frontend, backend, config, storage,
 *     cache, sessions, temp, uploads, backups, logs) and proves it is writable;
 *   • publishes the compiled React build into public_html/rmudts together with
 *     runtime-config.js and the router .htaccess;
 *   • copies the Node.js backend into rmudts-server (never into public_html);
 *   • drops the protection files that keep private folders from being listed,
 *     executed or served.
 *
 * Nothing here deletes user data. Re-running is safe: files are overwritten,
 * directories are reused and unknown content outside the build is left alone.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Storage
{
    /** Subdirectories the application expects inside uploads/. */
    private const UPLOAD_SUBDIRS = ['documents', 'attachments', 'routing-slips', 'avatars', 'tmp'];

    /** Subdirectories under the logs folder. */
    private const LOG_SUBDIRS = ['error', 'access', 'installer', 'database'];

    /** Subdirectories under the backups folder. */
    private const BACKUP_SUBDIRS = ['daily', 'weekly', 'manual'];

    /**
     * Files in the frontend folder that belong to the deployment rather than
     * the build and must survive a frontend refresh.
     */
    private const BUILD_PROTECTED = ['.htaccess', 'runtime-config.js'];

    /** Never copied out of the packaged backend. */
    public const BACKEND_EXCLUDE = [
        'node_modules',
        'node_modules/*',
        '.env',
        '.env.*',
        '*.log',
        '*.tmp',
        '.DS_Store',
        'Thumbs.db',
        'test-attach.pdf',
        'uploads',
        'uploads/*',
    ];

    // -------------------------------------------------------------- create --

    /**
     * Create every configured directory (plus the conventional subfolders) and
     * return a per-location report.
     *
     * @return array<int,array{key:string,label:string,path:string,level:string,message:string}>
     */
    public static function prepare(array $paths): array
    {
        $report = [];
        foreach (Paths::KEYS as $key => $label) {
            $path = (string) ($paths[$key] ?? '');
            if ($path === '') {
                continue;
            }
            // Public folders are 755; private folders are 700 on shared hosting.
            $mode = in_array($key, Paths::PUBLIC_KEYS, true) ? 0755 : 0700;
            $created = self::ensureDir($path, $mode);
            $report[] = [
                'key'     => $key,
                'label'   => $label,
                'path'    => $path,
                'level'   => $created['level'],
                'message' => $created['message'],
            ];
        }

        foreach (self::subdirectories($paths) as $sub) {
            $created = self::ensureDir($sub, 0700);
            $report[] = [
                'key'     => 'sub',
                'label'   => 'Subfolder',
                'path'    => $sub,
                'level'   => $created['level'],
                'message' => $created['message'],
            ];
        }
        return $report;
    }

    /** @return array<int,array{key:string,label:string,path:string,level:string,message:string}> */
    public static function verify(array $paths): array
    {
        $report = [];
        foreach (Paths::KEYS as $key => $label) {
            $path = (string) ($paths[$key] ?? '');
            if ($path === '') {
                continue;
            }
            $level = 'pass';
            $message = Support::path($path) . ' is writable.';
            if (!is_dir($path)) {
                $level = 'fail';
                $message = Support::path($path) . ' does not exist.';
            } elseif (!is_writable($path)) {
                $level = 'fail';
                $message = Support::path($path) . ' is not writable by ' . Paths::phpUser() . '.';
            }
            $report[] = ['key' => $key, 'label' => $label, 'path' => $path, 'level' => $level, 'message' => $message];
        }
        return $report;
    }

    /** @return string[] */
    public static function subdirectories(array $paths): array
    {
        $out = [];
        $storage = (string) ($paths['storage'] ?? '');
        $uploads = (string) ($paths['uploads'] ?? '');
        $logs = (string) ($paths['logs'] ?? '');
        $backups = (string) ($paths['backups'] ?? '');

        // The three storage buckets are also configured keys; create their
        // common children so the application never has to mkdir at runtime.
        foreach (['cache' => ['data', 'views'], 'sessions' => [], 'temp' => ['pdf', 'images']] as $bucket => $children) {
            $base = (string) ($paths[$bucket] ?? '');
            if ($base === '' && $storage !== '') {
                $base = $storage . DIRECTORY_SEPARATOR . $bucket;
            }
            foreach ($children as $child) {
                if ($base !== '') {
                    $out[] = $base . DIRECTORY_SEPARATOR . $child;
                }
            }
        }
        foreach (self::UPLOAD_SUBDIRS as $dir) {
            if ($uploads !== '') {
                $out[] = $uploads . DIRECTORY_SEPARATOR . $dir;
            }
        }
        foreach (self::LOG_SUBDIRS as $dir) {
            if ($logs !== '') {
                $out[] = $logs . DIRECTORY_SEPARATOR . $dir;
            }
        }
        foreach (self::BACKUP_SUBDIRS as $dir) {
            if ($backups !== '') {
                $out[] = $backups . DIRECTORY_SEPARATOR . $dir;
            }
        }
        return $out;
    }

    /** @return array{level:string,message:string} */
    private static function ensureDir(string $path, int $mode = 0755): array
    {
        if (is_dir($path)) {
            if (!is_writable($path)) {
                return ['level' => 'fail', 'message' => Support::path($path) . ' exists but is not writable. Set it to 700 (755 for public folders).'];
            }
            @chmod($path, $mode);
            return ['level' => 'pass', 'message' => Support::path($path) . ' — ready'];
        }
        if (!Support::mkdir($path, $mode)) {
            return ['level' => 'fail', 'message' => 'Could not create ' . Support::path($path) . '. Create it manually in cPanel → File Manager and try again.'];
        }
        @chmod($path, $mode);
        if (!Support::isWritable($path)) {
            return ['level' => 'warn', 'message' => Support::path($path) . ' was created but the write test failed — check permissions.'];
        }
        return ['level' => 'pass', 'message' => Support::path($path) . ' — created'];
    }

    // ------------------------------------------------------------ protection --

    /**
     * Write the safety files that make a storage folder usable but not
     * browsable, executed, or readable over HTTP.
     *
     * @return string[] absolute paths written
     */
    public static function protect(array $paths): array
    {
        $written = [];
        $htaccess = Security::storageHtaccess();
        $guard = "<!-- RMUDTS: this directory is not web-accessible. -->\n<h1>403 Forbidden</h1>\n";

        foreach (Paths::MUST_BE_PRIVATE as $key) {
            $path = (string) ($paths[$key] ?? '');
            if ($path === '' || !is_dir($path)) {
                continue;
            }
            if (Support::writeFile($path . DIRECTORY_SEPARATOR . '.htaccess', $htaccess)) {
                $written[] = $path . DIRECTORY_SEPARATOR . '.htaccess';
            }
            if (Support::writeFile($path . DIRECTORY_SEPARATOR . 'index.html', $guard)) {
                $written[] = $path . DIRECTORY_SEPARATOR . 'index.html';
            }
        }

        // Uploads must stay readable to the application but never executable.
        $uploads = (string) ($paths['uploads'] ?? '');
        if ($uploads !== '' && is_dir($uploads)) {
            if (Support::writeFile($uploads . DIRECTORY_SEPARATOR . '.htaccess', Security::uploadsHtaccess())) {
                $written[] = $uploads . DIRECTORY_SEPARATOR . '.htaccess';
            }
        }

        // The public frontend needs its own router rules.
        $frontend = (string) ($paths['frontend'] ?? '');
        if ($frontend !== '' && is_dir($frontend)) {
            $urls = ConfigWriter::urls();
            if (Support::writeFile($frontend . DIRECTORY_SEPARATOR . '.htaccess', Security::frontendHtaccess($urls['base_path'], $urls['api']))) {
                $written[] = $frontend . DIRECTORY_SEPARATOR . '.htaccess';
            }
        }
        return $written;
    }

    // ------------------------------------------------------------- frontend --

    /**
     * Publish the compiled React application into public_html/rmudts.
     *
     * @return array{level:string,files:int,message:string,notes:string[]}
     */
    public static function publishFrontend(string $source, array $paths, array $app = []): array
    {
        $frontend = rtrim((string) ($paths['frontend'] ?? ''), '/\\');
        $notes = [];
        if ($source === '' || !is_dir($source)) {
            return ['level' => 'fail', 'files' => 0, 'message' => 'No compiled frontend was found in the package (expected client/index.html).', 'notes' => []];
        }
        if ($frontend === '') {
            return ['level' => 'fail', 'files' => 0, 'message' => 'The frontend directory is not configured.', 'notes' => []];
        }
        if (!Support::mkdir($frontend, 0755)) {
            return ['level' => 'fail', 'files' => 0, 'message' => 'Could not create ' . Support::path($frontend) . '.', 'notes' => []];
        }

        $files = Support::copyTree($source, $frontend, self::BUILD_PROTECTED);
        $indexHtml = $frontend . DIRECTORY_SEPARATOR . 'index.html';
        if (!is_file($indexHtml)) {
            return ['level' => 'fail', 'files' => $files, 'message' => 'The frontend copy finished but index.html is missing from ' . Support::path($frontend) . '.', 'notes' => []];
        }

        // A new build hashes its bundles, so the previous release's files are
        // orphaned the moment the copy lands. Remove them, or every upgrade
        // leaves another complete copy of the frontend in the web root.
        $pruned = self::pruneStaleBuildFiles($source, $frontend);

        // Public, non-secret runtime configuration + router rules.
        $runtime = ConfigWriter::writeRuntimeConfig($paths, $app);
        if ($runtime['level'] === 'fail') {
            return ['level' => 'fail', 'files' => $files, 'message' => $runtime['message'], 'notes' => $notes];
        }
        $urls = ConfigWriter::urls();
        Support::writeFile($frontend . DIRECTORY_SEPARATOR . '.htaccess', Security::frontendHtaccess($urls['base_path'], $urls['api']));

        // The build is only usable if the shell can still reach the bundles it
        // names — a truncated or half-copied build must be reported, not served.
        $missing = self::missingBuildAssets($frontend);
        if ($missing !== []) {
            return [
                'level'   => 'fail',
                'files'   => $files,
                'message' => 'index.html refers to ' . count($missing) . ' asset(s) that are not in ' . Support::path($frontend)
                    . ': ' . implode(', ', array_slice($missing, 0, 5)) . '. The frontend build is incomplete — re-upload the release and run the upgrade again.',
                'notes'   => $notes,
            ];
        }

        $notes[] = 'runtime-config.js points the SPA at ' . $urls['api'] . ' (API) and ' . $urls['socket'] . $urls['socket_path'] . ' (Socket.IO).';

        return [
            'level'   => 'pass',
            'files'   => $files,
            'pruned'  => count($pruned),
            'message' => $files . ' frontend file(s) published into ' . Support::path($frontend)
                . ($pruned !== [] ? '; ' . count($pruned) . ' stale file(s) from the previous build removed (superseded hashed bundles)' : '')
                . '.',
            'notes'   => $notes,
        ];
    }

    /**
     * Delete files in the frontend folder that the previous build produced and
     * the new one no longer ships.
     *
     * Only entries the new build provides are considered, and only inside them:
     * `.htaccess` and `runtime-config.js` are never touched. Called after a
     * successful copy, so a failed copy cannot leave the site empty.
     *
     * @return string[] absolute paths removed
     */
    public static function pruneStaleBuildFiles(string $source, string $public): array
    {
        $removed = [];
        if ($source === '' || $public === '' || !is_dir($source) || !is_dir($public)) {
            return $removed;
        }
        foreach ((array) @scandir($source) as $entry) {
            $entry = (string) $entry;
            if ($entry === '' || $entry === '.' || $entry === '..' || in_array($entry, self::BUILD_PROTECTED, true)) {
                continue;
            }
            $from = $source . DIRECTORY_SEPARATOR . $entry;
            $to = $public . DIRECTORY_SEPARATOR . $entry;
            if (!is_dir($from) || is_link($from) || !is_dir($to) || is_link($to)) {
                continue;                    // plain files were just overwritten
            }
            self::pruneDirectory($from, $to, $removed);
        }
        return $removed;
    }

    /** @param string[] $removed */
    private static function pruneDirectory(string $source, string $public, array &$removed): void
    {
        foreach ((array) @scandir($public) as $entry) {
            $entry = (string) $entry;
            if ($entry === '' || $entry === '.' || $entry === '..') {
                continue;
            }
            $mirror = $source . DIRECTORY_SEPARATOR . $entry;
            $target = $public . DIRECTORY_SEPARATOR . $entry;
            if (!file_exists($mirror)) {
                self::removePath($target, $removed);  // not in this release any more
                continue;
            }
            if (is_dir($mirror) && is_dir($target) && !is_link($target)) {
                self::pruneDirectory($mirror, $target, $removed);
            }
        }
    }

    /** @param string[] $removed */
    private static function removePath(string $path, array &$removed): void
    {
        if (is_dir($path) && !is_link($path)) {
            foreach ((array) @scandir($path) as $entry) {
                $entry = (string) $entry;
                if ($entry === '' || $entry === '.' || $entry === '..') {
                    continue;
                }
                self::removePath($path . DIRECTORY_SEPARATOR . $entry, $removed);
            }
            @rmdir($path);
            return;
        }
        if (@unlink($path)) {
            $removed[] = $path;
        }
    }

    /**
     * Asset files named by the published index.html that do not exist.
     *
     * @return string[] site-relative paths
     */
    public static function missingBuildAssets(string $public): array
    {
        $html = (string) @file_get_contents($public . DIRECTORY_SEPARATOR . 'index.html');
        if ($html === '') {
            return [];
        }
        if (!preg_match_all('/(?:src|href)\s*=\s*["\']([^"\']+)["\']/i', $html, $matches)) {
            return [];
        }
        $urls = ConfigWriter::urls();
        $base = trim($urls['base_path'], '/');           // rmudts
        $missing = [];
        foreach ((array) ($matches[1] ?? []) as $ref) {
            $ref = (string) $ref;
            // Only build output is checked; absolute URLs, data: URIs and API
            // routes are somebody else's job.
            if (!preg_match('#^(?:\./|/)?(?:' . preg_quote($base, '#') . '/)?(?:static|assets|js|css|media)/#', $ref)) {
                continue;
            }
            $clean = ltrim(explode('?', explode('#', $ref)[0])[0], '/');
            if ($base !== '' && str_starts_with($clean, $base . '/')) {
                $clean = substr($clean, strlen($base) + 1);
            }
            $file = $public . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $clean);
            if (!is_file($file) && !in_array($clean, $missing, true)) {
                $missing[] = $clean;
            }
        }
        return $missing;
    }

    // -------------------------------------------------------------- backend --

    /**
     * Copy the Express backend into rmudts-server and install dependencies.
     *
     * $installDeps is false during an upgrade that only replaces the code: the
     * existing node_modules stays in place and npm is not run again.
     *
     * @return array{level:string,path:string,files:int,deps:array<string,mixed>,messages:string[]}
     */
    public static function deployBackend(string $source, array $paths, bool $installDeps = true): array
    {
        $appRoot = rtrim((string) ($paths['app_root'] ?? ''), '/\\');
        $messages = [];
        if ($appRoot === '' || $source === '' || !is_dir($source)) {
            return ['level' => 'fail', 'path' => $appRoot, 'files' => 0, 'deps' => ['level' => 'fail', 'message' => 'Backend source missing'], 'messages' => ['The packaged backend (server/) could not be found.']];
        }

        $files = Support::copyTree($source, $appRoot, self::BACKEND_EXCLUDE);
        if ($files === 0) {
            return ['level' => 'fail', 'path' => $appRoot, 'files' => 0, 'deps' => ['level' => 'fail', 'message' => 'Copy failed'], 'messages' => ['Nothing was copied into ' . Support::path($appRoot) . '.']];
        }
        $messages[] = $files . ' backend file(s) copied to ' . Support::path($appRoot) . ' (node_modules and logs excluded).';

        if ($installDeps) {
            $deps = self::installDependencies($appRoot);
        } else {
            $deps = is_dir($appRoot . DIRECTORY_SEPARATOR . 'node_modules')
                ? ['level' => 'pass', 'message' => 'Dependencies left as they are (node_modules present).', 'output' => '']
                : ['level' => 'warn', 'message' => 'node_modules is missing — run “npm ci --omit=dev” in ' . Support::path($appRoot) . ', or press “Run NPM Install” in cPanel → Setup Node.js App.', 'output' => ''];
        }
        $messages[] = $deps['message'];

        return [
            'level'    => $deps['level'] === 'fail' ? 'warn' : 'pass',
            'path'     => $appRoot,
            'files'    => $files,
            'deps'     => $deps,
            'messages' => $messages,
        ];
    }

    /**
     * `npm ci --omit=dev` (or `npm install` without a lockfile) inside the
     * application folder. Never fatal: on hosts where shell access is disabled
     * the administrator installs the dependencies from cPanel instead.
     *
     * @return array{level:string,message:string,output:string}
     */
    public static function installDependencies(string $appRoot, int $timeoutSeconds = 420): array
    {
        if (!is_file($appRoot . DIRECTORY_SEPARATOR . 'package.json')) {
            return ['level' => 'fail', 'message' => 'No package.json in ' . Support::path($appRoot) . '.', 'output' => ''];
        }
        if (!Support::shellEnabled()) {
            return [
                'level'   => 'warn',
                'message' => 'Shell execution is disabled, so npm could not run automatically. Open cPanel → Setup Node.js App (application root: ' . Support::path($appRoot) . ') and press “Run NPM Install”, or run “npm ci --omit=dev” in Terminal.',
                'output'  => '',
            ];
        }
        $npm = Support::which('npm');
        if ($npm === null) {
            return ['level' => 'warn', 'message' => 'npm was not found in PATH — run “npm ci --omit=dev” in ' . Support::path($appRoot) . ' from cPanel → Terminal.', 'output' => ''];
        }

        $lock = is_file($appRoot . DIRECTORY_SEPARATOR . 'package-lock.json');
        $verb = $lock ? 'ci' : 'install';
        $command = 'cd ' . escapeshellarg($appRoot) . ' && ' . escapeshellarg($npm) . ' ' . $verb . ' --omit=dev --no-audit --no-fund 2>&1';
        [$code, $output] = Support::run($command, $timeoutSeconds);
        $modules = is_dir($appRoot . DIRECTORY_SEPARATOR . 'node_modules');

        if ($code === 0 && $modules) {
            return ['level' => 'pass', 'message' => 'Backend dependencies installed with npm ' . $verb . ' (node_modules ready).', 'output' => $output];
        }
        if ($modules) {
            return ['level' => 'warn', 'message' => 'npm reported a non-zero exit code but node_modules exists. Review the log before going live.', 'output' => $output];
        }
        return ['level' => 'warn', 'message' => 'npm ' . $verb . ' did not complete. Run it manually in ' . Support::path($appRoot) . ' before starting the application.', 'output' => $output];
    }

    /** Persist the storage layout so the application and support can read it. */
    public static function writeManifest(array $paths, string $configDir): ?string
    {
        if ($configDir === '') {
            return null;
        }
        $manifest = [
            'generated_at' => date('c'),
            'version'      => Installer::VERSION,
            'paths'        => $paths,
            'urls'         => ConfigWriter::urls(),
            'php_user'     => Paths::phpUser(),
        ];
        $file = rtrim($configDir, '/\\') . DIRECTORY_SEPARATOR . 'storage.json';
        return Support::writeFile($file, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n", 0640) ? $file : null;
    }

    /** Size/entry summary for the summary step. */
    public static function overview(array $paths): array
    {
        $rows = [];
        foreach (Paths::KEYS as $key => $label) {
            $path = (string) ($paths[$key] ?? '');
            $rows[] = [
                'key'     => $key,
                'label'   => $label,
                'path'    => $path,
                'purpose' => Paths::PURPOSE[$key] ?? '',
                'exists'  => $path !== '' && is_dir($path),
                'entries' => $path !== '' ? Support::dirEntries($path) : 0,
                'bytes'   => $path !== '' ? Support::dirSize($path) : 0,
                'writable' => $path !== '' && is_dir($path) && is_writable($path),
            ];
        }
        return $rows;
    }
}

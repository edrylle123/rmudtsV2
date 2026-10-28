<?php
/**
 * RMUDTS Installer — Cpanel
 * ---------------------------------------------------------------------------
 * PHP cannot create a cPanel Node.js application: cPanel exposes no public API
 * for that action on shared hosting, and claiming otherwise would leave the
 * administrator with a half-configured site. This class therefore produces the
 * exact, copyable instructions (and a downloadable file) for the one step a
 * human must perform in cPanel.
 */

declare(strict_types=1);

namespace Rmudts\Installer;

final class Cpanel
{
    /**
     * @return array{values:array<string,string>,steps:array<int,array{title:string,body:string}>,commands:string[],env_names:string[],download:string}
     */
    public static function instructions(array $paths, array $app): array
    {
        $urls = ConfigWriter::urls((string) ($app['url'] ?? ''));
        $appRoot = rtrim((string) ($paths['app_root'] ?? ''), '/\\');
        $account = dirname($appRoot);
        $accountName = basename($account);
        $apiHost = (string) (parse_url($urls['api'], PHP_URL_HOST) ?: 'api.example.com');
        $frontendHost = (string) (parse_url($urls['frontend'], PHP_URL_HOST) ?: 'example.com');
        $hasLock = is_file($appRoot . DIRECTORY_SEPARATOR . 'package-lock.json');

        $values = [
            'Node.js version'   => '20 LTS (or the newest version this host offers)',
            'Application mode'  => 'Production',
            'Application root'  => basename($appRoot),
            'Application URL'   => $apiHost,
            'Startup file'      => 'server.js',
            'Environment file'  => Support::path($appRoot . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'rmudts-config' . DIRECTORY_SEPARATOR . '.env'),
        ];

        $commands = [
            'cd ' . $appRoot,
            $hasLock ? 'npm ci --omit=dev' : 'npm install --omit=dev',
        ];

        $steps = [
            ['title' => 'Open the Node.js application tool', 'body' => 'In cPanel open <strong>Setup Node.js App</strong> (some hosts label it Application Manager or Websites &amp; Apps).'],
            ['title' => 'Create a production application', 'body' => 'Press <strong>Create Application</strong> and choose <strong>Production</strong> mode.'],
            ['title' => 'Choose the API subdomain', 'body' => 'Set the domain to <code>' . Support::e($apiHost) . '</code>. If the subdomain does not exist yet, create it first in cPanel → Domains. Do not point it at public_html/rmudts.'],
            ['title' => 'Set the application root', 'body' => 'Enter <code>' . Support::e(basename($appRoot)) . '</code> (relative to /home/' . Support::e($accountName) . '). This folder was prepared by the installer and is outside public_html.'],
            ['title' => 'Set the startup file', 'body' => 'Enter <code>server.js</code>. A wrong filename is the most common reason the application returns 503.'],
            ['title' => 'Select Node.js 20 LTS', 'body' => 'Pick Node.js 20 LTS, or the closest version this host supports. The backend has no native build step.'],
            ['title' => 'Save the application', 'body' => 'Press <strong>Create</strong>. cPanel creates a Passenger entry point and a virtual environment.'],
            ['title' => 'Install dependencies', 'body' => 'Open <strong>Terminal</strong> (or the tool\'s “Run NPM Install” button) and run the command below. The installer already copied package.json' . ($hasLock ? ' and package-lock.json' : '') . '.'],
            ['title' => 'Check the environment file', 'body' => 'The backend reads <code>' . Support::e(Support::path($appRoot . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'rmudts-config' . DIRECTORY_SEPARATOR . '.env')) . '</code> directly. Do not create a second .env inside the application folder and do not copy secrets into the cPanel variable form unless your host requires it.'],
            ['title' => 'Restart the application', 'body' => 'Press <strong>Restart</strong> after installing dependencies. If the tool has no Restart button, run <code>mkdir -p ' . Support::e($appRoot) . '/tmp && touch ' . Support::e($appRoot) . '/tmp/restart.txt</code>.'],
            ['title' => 'Read the log if it does not start', 'body' => 'Open the application log in the same cPanel page. “Cannot find module” means npm install did not run; “EADDRINUSE” is unusual on Passenger and means a second copy is still running.'],
            ['title' => 'Test the API', 'body' => 'Open <code>' . Support::e($urls['api']) . '</code> — it must return JSON, not an Apache page.'],
            ['title' => 'Test Socket.IO', 'body' => 'Open <code>' . Support::e($urls['api']) . 'socket.io/?EIO=4&amp;transport=polling</code> — it must return an Engine.IO handshake beginning with <code>0{</code>, not 404.'],
            ['title' => 'Return to the wizard', 'body' => 'Come back to this installer and run the verification step. The frontend is served from <code>' . Support::e($frontendHost . $urls['base_path']) . '</code>.'],
        ];

        return [
            'values'     => $values,
            'steps'      => $steps,
            'commands'   => $commands,
            'env_names'  => ConfigWriter::cpanelVariableNames(),
            'download'   => self::downloadText($paths, $app, $values, $steps, $commands),
        ];
    }

    /** Plain-text version of the instructions for download. */
    private static function downloadText(array $paths, array $app, array $values, array $steps, array $commands): string
    {
        $urls = ConfigWriter::urls((string) ($app['url'] ?? ''));
        $lines = [
            'RMUDTS ' . Installer::VERSION . ' — cPanel Node.js application setup',
            '=================================================================',
            'Generated ' . date('c'),
            '',
            'The installer cannot create a cPanel Node.js application automatically:',
            'cPanel does not expose that action through an API. Everything else has',
            'already been prepared. Complete the following in cPanel.',
            '',
            'Values to enter',
            '---------------',
        ];
        foreach ($values as $label => $value) {
            $lines[] = str_pad($label . ':', 22) . $value;
        }
        $lines[] = '';
        $lines[] = 'Commands (cPanel → Terminal)';
        $lines[] = '----------------------------';
        foreach ($commands as $command) {
            $lines[] = $command;
        }
        $lines[] = '';
        $lines[] = 'Steps';
        $lines[] = '-----';
        foreach ($steps as $i => $step) {
            $lines[] = ($i + 1) . '. ' . strip_tags(str_replace(['&amp;', '&nbsp;'], ['&', ' '], $step['title']));
            $lines[] = '   ' . trim(strip_tags(str_replace(['&amp;', '&nbsp;'], ['&', ' '], $step['body'])));
        }
        $lines[] = '';
        $lines[] = 'Verification URLs';
        $lines[] = '-----------------';
        $lines[] = 'Frontend : ' . $urls['frontend'];
        $lines[] = 'API root : ' . $urls['api'];
        $lines[] = 'Health   : ' . $urls['api'] . 'api/health';
        $lines[] = 'Socket.IO: ' . $urls['api'] . ltrim($urls['socket_path'], '/') . '/?EIO=4&transport=polling';
        $lines[] = '';
        $lines[] = 'This file contains no passwords, keys or tokens.';
        return implode("\n", $lines) . "\n";
    }

    /** Persist the instructions next to the configuration (0600, private). */
    public static function writeFile(array $paths, array $app, string $contents): ?string
    {
        $config = rtrim((string) ($paths['config'] ?? ''), '/\\');
        if ($config === '') {
            return null;
        }
        $file = $config . DIRECTORY_SEPARATOR . 'cpanel-node-setup.txt';
        return Support::writeFile($file, $contents, 0640) ? $file : null;
    }
}

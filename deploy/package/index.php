<?php
/**
 * RMUDTS — bootstrap entry point.
 * ===========================================================================
 * This is what runs the moment the archive is extracted and the domain is
 * opened, before anything has been configured. It does one job: send the
 * administrator to the installation wizard.
 *
 * The wizard then replaces this file with the real front controller
 * (install/views/templates/public-index.php.tpl → public_html/index.php),
 * which serves the application and proxies the API to the Node.js backend.
 *
 * If you can still see this page after a successful installation, the copy
 * step did not complete: open /install to finish it.
 */

declare(strict_types=1);

$install = __DIR__ . DIRECTORY_SEPARATOR . 'install' . DIRECTORY_SEPARATOR . 'index.php';

if (is_file($install)) {
    $target = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'))), '/') . '/install/';
    header('Location: ' . $target, true, 302);
    exit;
}

http_response_code(503);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>RMUDTS — setup required</title>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #0f172a;
             color: #e2e8f0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 38rem; padding: 2rem; line-height: 1.6; }
      h1 { margin: 0 0 .5rem; font-size: 1.5rem; }
      code { background: #1e293b; padding: .12rem .4rem; border-radius: .25rem; }
      a { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <main>
      <h1>RMUDTS is not installed on this folder</h1>
      <p>
        The <code>install/</code> folder is missing, so the setup wizard cannot start.
        Re-upload the release archive to <code>public_html</code>, extract it there and
        reload this page.
      </p>
      <p>
        Full instructions: <code>docs/INSTALL.md</code> inside the archive.
      </p>
    </main>
  </body>
</html>

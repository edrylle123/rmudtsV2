<?php
/**
 * RMUDTS installer — shared view helpers.
 * ---------------------------------------------------------------------------
 * Small rendering functions so each step view stays about its own content and
 * the wizard chrome (progress, navigation, status chips) is written once.
 */

declare(strict_types=1);

use Rmudts\Installer\Paths;
use Rmudts\Installer\State;
use Rmudts\Installer\Support;

/** HTML-escape shortcut. */
function h($value): string
{
    return Support::e($value);
}

/** A PASS / WARN / FAIL chip. */
function chip(string $level, string $text = ''): string
{
    $label = $text !== '' ? $text : ['pass' => 'PASS', 'warn' => 'WARNING', 'fail' => 'FAIL', 'info' => 'INFO'][$level] ?? strtoupper($level);
    return '<span class="chip chip-' . h($level) . '">' . h($label) . '</span>';
}

/** Rendered message box for the current flash/step result. */
function message_box(?array $flash): string
{
    if (!$flash || empty($flash['message'])) {
        return '';
    }
    $level = (string) ($flash['level'] ?? 'info');
    $title = ['pass' => 'Success', 'warn' => 'Attention', 'fail' => 'Problem', 'info' => 'Notice'][$level] ?? 'Notice';
    return '<div class="banner banner-' . h($level) . '"><strong>' . h($title) . ':</strong> ' . h($flash['message']) . '</div>';
}

/**
 * Previous / Next / Cancel controls.
 *
 * @param array{prev?:?int,nextId?:string,nextLabel?:string,nextType?:string,nextDisabled?:bool,nextHint?:string,extra?:string,cancel?:bool} $options
 */
function wizard_nav(array $options): string
{
    $prev = $options['prev'] ?? null;
    $nextLabel = (string) ($options['nextLabel'] ?? 'Next');
    $nextId = (string) ($options['nextId'] ?? '');
    $disabled = !empty($options['nextDisabled']);
    $hint = (string) ($options['nextHint'] ?? '');
    $extra = (string) ($options['extra'] ?? '');
    $cancel = $options['cancel'] ?? true;

    $html = '<div class="wizard-nav"><div class="wizard-nav-left">';
    $html .= $prev !== null
        ? '<a class="btn btn-ghost" href="?step=' . (int) $prev . '">&larr; Previous</a>'
        : '<span class="btn btn-ghost is-disabled" aria-disabled="true">&larr; Previous</span>';
    $html .= '</div><div class="wizard-nav-right">';
    if ($cancel) {
        $html .= '<button class="btn btn-link" type="submit" name="action" value="cancel"'
            . ' onclick="return confirm(\'Cancel the installation? Nothing is written to the database and you can start again at any time.\');">Cancel</button>';
    }
    $html .= $extra;
    $html .= '<button class="btn btn-primary" type="submit"'
        . ($nextId !== '' ? ' id="' . h($nextId) . '"' : '')
        . ' name="action" value="step-next"'
        . ($disabled ? ' disabled' : '') . '>' . h($nextLabel) . '</button>';
    $html .= '</div>';
    if ($hint !== '') {
        $html .= '<p class="wizard-nav-hint">' . h($hint) . '</p>';
    }
    return $html . '</div>';
}

/** One row of a requirements/checklist table. */
function status_row(string $label, string $level, string $note): string
{
    return '<tr class="row-' . h($level) . '"><td class="col-status">' . chip($level) . '</td>'
        . '<td class="col-label">' . h($label) . '</td>'
        . '<td class="col-note">' . h($note) . '</td></tr>';
}

/** A text input with label, hint and inline error. */
function field(array $spec): string
{
    $name = (string) ($spec['name'] ?? '');
    $type = (string) ($spec['type'] ?? 'text');
    $value = (string) ($spec['value'] ?? '');
    $label = (string) ($spec['label'] ?? $name);
    $hint = (string) ($spec['hint'] ?? '');
    $error = (string) ($spec['error'] ?? '');
    $required = !empty($spec['required']);
    $placeholder = (string) ($spec['placeholder'] ?? '');
    $help = (string) ($spec['help'] ?? '');

    $html = '<div class="field' . ($error !== '' ? ' has-error' : '') . '">';
    $html .= '<label for="f-' . h($name) . '">' . h($label) . ($required ? ' <span class="req">*</span>' : '') . '</label>';
    $html .= '<input id="f-' . h($name) . '" name="' . h($name) . '" type="' . h($type) . '"'
        . ' value="' . h($value) . '"'
        . ($placeholder !== '' ? ' placeholder="' . h($placeholder) . '"' : '')
        . ($required ? ' required' : '')
        . (($spec['autocomplete'] ?? '') !== '' ? ' autocomplete="' . h((string) $spec['autocomplete']) . '"' : '')
        . (isset($spec['min']) ? ' min="' . h((string) $spec['min']) . '"' : '')
        . (isset($spec['max']) ? ' max="' . h((string) $spec['max']) . '"' : '')
        . (isset($spec['maxlength']) ? ' maxlength="' . h((string) $spec['maxlength']) . '"' : '')
        . (($spec['readonly'] ?? false) ? ' readonly' : '')
        . '>';
    if ($hint !== '') {
        $html .= '<p class="hint">' . h($hint) . '</p>';
    }
    if ($help !== '') {
        $html .= '<p class="help">' . $help . '</p>';
    }
    if ($error !== '') {
        $html .= '<p class="error">' . h($error) . '</p>';
    }
    return $html . '</div>';
}

/** A <select> built from a list of options. */
function select_field(array $spec): string
{
    $name = (string) ($spec['name'] ?? '');
    $label = (string) ($spec['label'] ?? $name);
    $value = (string) ($spec['value'] ?? '');
    $hint = (string) ($spec['hint'] ?? '');
    $error = (string) ($spec['error'] ?? '');
    $options = (array) ($spec['options'] ?? []);

    $html = '<div class="field' . ($error !== '' ? ' has-error' : '') . '">';
    $html .= '<label for="f-' . h($name) . '">' . h($label) . '</label>';
    $html .= '<select id="f-' . h($name) . '" name="' . h($name) . '"'
        . (!empty($spec['data']) ? ' data-' . h((string) $spec['data']) : '') . '>';
    foreach ($options as $key => $text) {
        $selected = (string) $key === $value ? ' selected' : '';
        $html .= '<option value="' . h((string) $key) . '"' . $selected . '>' . h((string) $text) . '</option>';
    }
    return $html . '</select>' . ($hint !== '' ? '<p class="hint">' . h($hint) . '</p>' : '')
        . ($error !== '' ? '<p class="error">' . h($error) . '</p>' : '') . '</div>';
}

/** A card with a title and optional description. */
function card(string $title, string $body, string $id = '', string $description = ''): string
{
    return '<section class="card"' . ($id !== '' ? ' id="' . h($id) . '"' : '') . '>'
        . '<h2>' . h($title) . '</h2>'
        . ($description !== '' ? '<p class="card-desc">' . h($description) . '</p>' : '')
        . $body . '</section>';
}

/** The path table shown in step 3 and step 9. */
function path_table(array $paths, array $validation = []): string
{
    $html = '<div class="table-wrap"><table class="table"><thead><tr>'
        . '<th>Location</th><th>Path</th><th>Purpose</th><th>Status</th></tr></thead><tbody>';
    foreach (Paths::KEYS as $key => $label) {
        $path = (string) ($paths[$key] ?? '');
        $private = in_array($key, Paths::MUST_BE_PRIVATE, true);
        $status = '<span class="muted">not checked</span>';
        if (isset($validation[$key])) {
            $status = chip((string) $validation[$key]['level']) . ' <span class="muted">' . h((string) $validation[$key]['message']) . '</span>';
        } elseif ($path !== '') {
            $status = is_dir($path)
                ? (is_writable($path) ? chip('pass', 'READY') : chip('fail', 'NOT WRITABLE'))
                : chip('warn', 'MISSING');
        }
        $html .= '<tr><td><strong>' . h($label) . '</strong>' . ($private ? ' <span class="tag">private</span>' : '') . '</td>'
            . '<td><code>' . h(Support::path($path)) . '</code></td>'
            . '<td class="muted">' . h(Paths::PURPOSE[$key] ?? '') . '</td>'
            . '<td>' . $status . '</td></tr>';
    }
    return $html . '</tbody></table></div>';
}

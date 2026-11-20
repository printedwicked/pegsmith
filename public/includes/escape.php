<?php
/* Stand-in for the site's escape helper: h() for every value printed into HTML. */
if (!function_exists('h')) {
    function h(mixed $v): string
    {
        return htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    }
}
if (!function_exists('esc')) {
    /** Legacy alias of h(). */
    function esc(mixed $v): string
    {
        return h($v);
    }
}

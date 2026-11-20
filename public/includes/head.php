<?php
/*
  Stand-in for the site's shared <head> fragment. The page includes it after its own <title> and
  <meta name="description"> and before its own styles. It provides the three things the page calls:

    cms_block($key, $fallback)   the site's content manager; here every block is its fallback text
    cms_text($key, $fallback)    same, for plain text
    pw_light_css($webPath)       links the page's light-theme companion stylesheet if the file exists

  and links the small chrome stylesheet (/assets/site/chrome.css) with the file's mtime as a cache
  buster. The inline script applies the remembered theme before first paint.
*/
require_once __DIR__ . '/escape.php';

if (!function_exists('cms_block')) {
    function cms_block(string $key, string $fallback = ''): string { return $fallback; }
    function cms_text(string $key, string $fallback = ''): string { return $fallback; }
}
if (!function_exists('pw_light_css')) {
    function pw_light_css(string $webPath): void {
        $fs = $_SERVER['DOCUMENT_ROOT'] . $webPath;
        if (!is_file($fs)) return;
        echo '<link rel="stylesheet" href="' . h($webPath) . '?v=' . (int) @filemtime($fs) . '">' . "\n";
    }
}

$pw_css   = '/assets/site/chrome.css';
$pw_css_v = @filemtime($_SERVER['DOCUMENT_ROOT'] . $pw_css) ?: 0;
?>
<link rel="stylesheet" href="<?= h($pw_css) ?>?v=<?= (int) $pw_css_v ?>">
<script>
(function () {
  var d = document.documentElement, t = null;
  try { t = localStorage.getItem('pw-theme'); } catch (e) {}
  if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
})();
</script>

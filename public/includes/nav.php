<?php
/* Stand-in for the site's navigation strip: a fixed bar with a home link, the page's name and the
   light/dark toggle (wired up by /assets/site/chrome.js). */
require_once __DIR__ . '/escape.php';
$pw_page = $pw_page ?? 'Pegsmith';
?>
<header class="pw-strip">
  <a class="pw-strip__home" href="/">Home</a>
  <span class="pw-strip__here"><?= h($pw_page) ?></span>
  <span class="pw-strip__spacer"></span>
  <a href="https://github.com/printedwicked/pegsmith">Source</a>
  <button class="pw-theme" type="button" data-pw-theme aria-label="Switch light and dark theme">Light</button>
</header>

<?php
/* Stand-in for the site's shared scripts fragment. Place just before </body>. ?v= is the file's
   own modification time, so a changed script reaches a browser that cached the old one. */
$pw_js   = '/assets/site/chrome.js';
$pw_js_v = @filemtime($_SERVER['DOCUMENT_ROOT'] . $pw_js) ?: 0;
?>
<script src="<?= $pw_js ?>?v=<?= (int) $pw_js_v ?>" defer></script>

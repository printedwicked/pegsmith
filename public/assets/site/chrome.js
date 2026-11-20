/* Stand-in for the site's shared script: the light/dark toggle in the strip. The choice is kept in
   localStorage ('pw-theme') and applied before first paint by the inline script in includes/head.php. */
(function () {
  var d = document.documentElement;
  var btn = document.querySelector('[data-pw-theme]');
  if (!btn) return;
  function label() {
    btn.textContent = d.getAttribute('data-theme') === 'light' ? 'Dark' : 'Light';
  }
  btn.addEventListener('click', function () {
    var t = d.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    d.setAttribute('data-theme', t);
    try { localStorage.setItem('pw-theme', t); } catch (e) { /* storage blocked: the choice lasts this page only */ }
    try { document.dispatchEvent(new CustomEvent('pw-theme', { detail: t })); } catch (e) { /* older browsers */ }
    label();
  });
  label();
})();

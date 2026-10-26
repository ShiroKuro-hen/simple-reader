// Set the theme before first paint so there is no light flash in dark mode.
(function () {
  var t = null;
  try { t = localStorage.getItem('sr.theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark' && t !== 'sepia') {
    t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = t;
})();

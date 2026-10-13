// Sets the theme before first paint (external file so the CSP can forbid inline scripts).
(function () {
  var t = null;
  try { t = localStorage.getItem('scent-theme'); } catch (e) {}
  if (!t) t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
})();

// Sets the theme class before first paint (an external file so the CSP can keep forbidding inline scripts).
// Light is the default; dark only when the visitor picked it.
(function () {
  var t = null;
  try { t = localStorage.getItem('sa-theme'); } catch (e) {}
  if (t === 'dark') document.documentElement.classList.add('dark');
})();

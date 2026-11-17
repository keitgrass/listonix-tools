/* FixMyASIN: Microsoft Clarity, loaded only after the visitor accepts analytics cookies. */
(function () {
  var KEY = 'fma_consent', ID = 'zf26byb4c9';
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function load() {
    if (window.clarity) return;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', ID);
    window.clarity('consent');
  }
  function banner() {
    var d = document.createElement('div');
    d.id = 'fma-consent';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', 'Cookie consent');
    d.innerHTML = '<p>We use Microsoft Clarity analytics cookies to see how visitors use this site and improve it. No ads, no selling of data. <a href="/privacy/#cookies">Privacy</a></p>' +
      '<div><button type="button" data-v="no">Decline</button><button type="button" data-v="yes">Accept</button></div>';
    var s = document.createElement('style');
    s.textContent = '#fma-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;background:#1a1a1a;color:#f2f2ea;border-radius:14px;padding:14px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;font:14px/1.45 "Be Vietnam Pro",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)}' +
      '#fma-consent p{margin:0;flex:1 1 260px}#fma-consent a{color:#c8f135}#fma-consent div{display:flex;gap:8px}' +
      '#fma-consent button{border:0;border-radius:999px;padding:8px 16px;font:600 14px "Be Vietnam Pro",system-ui,sans-serif;cursor:pointer}' +
      '#fma-consent button[data-v=no]{background:transparent;color:#f2f2ea;border:1px solid #555}#fma-consent button[data-v=yes]{background:#c8f135;color:#1a1a1a}';
    document.head.appendChild(s);
    d.addEventListener('click', function (e) {
      var v = e.target.getAttribute && e.target.getAttribute('data-v');
      if (!v) return;
      set(v);
      d.remove();
      if (v === 'yes') load();
    });
    document.body.appendChild(d);
  }
  window.fmaCookieSettings = function () { set(''); if (!document.getElementById('fma-consent')) banner(); };
  var c = get();
  if (c === 'yes') load();
  else if (c !== 'no') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
  }
})();

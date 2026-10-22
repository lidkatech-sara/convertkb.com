/* Site-wide behaviour: mega menu, mobile drawer, home search. No dependencies. */
(function () {
  var items = [].slice.call(document.querySelectorAll('.nav-item'));
  items.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) items.forEach(function (o) { if (o !== d) o.removeAttribute('open'); });
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.site-header')) items.forEach(function (d) { d.removeAttribute('open'); });
  });

  var drawer = document.getElementById('drawer'), overlay = document.getElementById('overlay'), burger = document.getElementById('burger');
  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    overlay.hidden = !open;
    drawer.setAttribute('aria-hidden', String(!open));
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) document.getElementById('drawerClose').focus(); else burger.focus();
  }
  if (burger) {
    burger.addEventListener('click', function () { setDrawer(true); });
    document.getElementById('drawerClose').addEventListener('click', function () { setDrawer(false); });
    overlay.addEventListener('click', function () { setDrawer(false); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    items.forEach(function (d) { d.removeAttribute('open'); });
    if (drawer && drawer.classList.contains('open')) setDrawer(false);
  });

  // Home search (index is injected by the page as JSON)
  var input = document.getElementById('toolSearch'), box = document.getElementById('toolResults'), data = document.getElementById('toolIndex');
  if (input && box && data) {
    var idx = JSON.parse(data.textContent);
    var esc = function (s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    input.addEventListener('input', function () {
      var q = input.value.toLowerCase().trim();
      if (!q) { box.style.display = 'none'; return; }
      var words = q.split(/\s+/);
      var hits = idx.filter(function (t) { var hay = (t.n + ' ' + t.k + ' ' + t.b + ' ' + t.c).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) > -1; }); }).slice(0, 8);
      box.innerHTML = hits.length ? hits.map(function (t) { return '<a href="/' + t.s + '/"><span>' + esc(t.n) + '</span><small>' + esc(t.c) + '</small></a>'; }).join('') : '<div class="none">No tool found for “' + esc(q) + '”. Try “50kb”, “passport” or “pdf”.</div>';
      box.style.display = 'block';
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) box.style.display = 'none'; });
  }

  // Home tabs (Image / PDF)
  var tabs = [].slice.call(document.querySelectorAll('[data-tab]'));
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });
      document.querySelectorAll('[data-tabpanel]').forEach(function (p) { p.hidden = p.getAttribute('data-tabpanel') !== t.getAttribute('data-tab'); });
    });
  });
})();

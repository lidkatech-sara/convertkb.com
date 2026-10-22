/* ConvertKB engine: image fitting, DPI headers, PDF rebuild, calculators.
   Everything runs in the browser. Third-party libraries are loaded lazily from CDNs only when needed. */
(function (root) {
  'use strict';

  /* ---------- pure helpers (unit-tested in Node) ---------- */
  function patchJpegDpi(u8, dpi) {
    if (!dpi || u8[0] !== 0xff || u8[1] !== 0xd8) return u8;
    var hi = (dpi >> 8) & 255, lo = dpi & 255;
    if (u8[2] === 0xff && u8[3] === 0xe0 && u8[6] === 0x4a && u8[7] === 0x46 && u8[8] === 0x49 && u8[9] === 0x46 && u8[10] === 0) {
      var out = u8.slice(); out[13] = 1; out[14] = hi; out[15] = lo; out[16] = hi; out[17] = lo; return out;
    }
    var app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, hi, lo, hi, lo, 0, 0]);
    var res = new Uint8Array(u8.length + app0.length);
    res.set(u8.subarray(0, 2), 0); res.set(app0, 2); res.set(u8.subarray(2), 2 + app0.length);
    return res;
  }
  function toPixels(v, unit, dpi) {
    if (!v) return 0;
    if (unit === 'cm') return Math.round((v / 2.54) * (dpi || 300));
    if (unit === 'in') return Math.round(v * (dpi || 300));
    return Math.round(v);
  }
  function fmtSize(bytes) {
    var k = bytes / 1024;
    return k >= 1024 ? (k / 1024).toFixed(2) + ' MB' : k.toFixed(k < 10 ? 2 : 1) + ' KB';
  }
  function convertUnits(v, from, to, base) {
    var U = ['B', 'KB', 'MB', 'GB'];
    return (v * Math.pow(base, U.indexOf(from))) / Math.pow(base, U.indexOf(to));
  }
  /* Generic search: finds the largest x in [lo,hi] with measure(x) <= max. measure must be monotonic non-decreasing. */
  async function searchMax(measure, lo, hi, max, iters) {
    var top = await measure(hi); if (top.size <= max) return { x: hi, r: top };
    var bot = await measure(lo); if (bot.size > max) return null;
    var best = { x: lo, r: bot };
    for (var i = 0; i < iters; i++) {
      var mid = (lo + hi) / 2, r = await measure(mid);
      if (r.size <= max) { best = { x: mid, r: r }; lo = mid; } else hi = mid;
    }
    return best;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { patchJpegDpi: patchJpegDpi, toPixels: toPixels, fmtSize: fmtSize, convertUnits: convertUnits, searchMax: searchMax };
    return;
  }

  /* ---------- browser-only code ---------- */
  var CDN = {
    cropperJs: 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js',
    cropperCss: 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css',
    pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    pdflib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    heic: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
    utif: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js'
  };
  var loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true; s.onload = res;
      s.onerror = function () { delete loaded[src]; rej(new Error('Could not load a helper library. Check your internet connection and try again.')); };
      document.head.appendChild(s);
    }));
  }
  function loadCss(href) {
    if (loaded[href]) return; loaded[href] = true;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
  }
  var MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  function toBlob(cv, type, q) { return new Promise(function (r) { cv.toBlob(r, type, q); }); }
  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function resizeCanvas(src, w, h, bg) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var cur = src;
    while (cur.width / 2 > w && cur.height / 2 > h) { // step-halve for quality
      var half = newCanvas(cur.width / 2, cur.height / 2), hc = half.getContext('2d');
      hc.imageSmoothingQuality = 'high'; hc.drawImage(cur, 0, 0, half.width, half.height); cur = half;
    }
    var out = newCanvas(w, h), ctx = out.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cur, 0, 0, w, h);
    return out;
  }
  function applyFilters(cv, gray, contrast) {
    if (!gray && !contrast) return cv;
    var ctx = cv.getContext('2d'), img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data, f = 1.35;
    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      if (gray) { r = g = b = 0.299 * r + 0.587 * g + 0.114 * b; }
      if (contrast) { r = (r - 128) * f + 128; g = (g - 128) * f + 128; b = (b - 128) * f + 128; }
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    ctx.putImageData(img, 0, 0); return cv;
  }
  function isHeic(f) { return /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name); }
  function isTiff(f) { return /image\/tiff/i.test(f.type) || /\.tiff?$/i.test(f.name); }
  function readAsDataURL(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function loadImage(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { rej(new Error('This image could not be opened. Try a JPG or PNG.')); }; i.src = src; }); }

  /* Turn any supported input file into a data URL the browser can show. */
  async function normaliseImage(file) {
    if (isHeic(file)) {
      try { var test = await loadImage(URL.createObjectURL(file)); if (test) return readAsDataURL(file); } catch (e) { /* not natively supported */ }
      await loadScript(CDN.heic);
      var out = await root.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      return readAsDataURL(Array.isArray(out) ? out[0] : out);
    }
    if (isTiff(file)) {
      try { var t = await loadImage(URL.createObjectURL(file)); if (t) return readAsDataURL(file); } catch (e) { /* decode below */ }
      await loadScript(CDN.utif);
      var buf = await file.arrayBuffer(), ifds = root.UTIF.decode(buf); root.UTIF.decodeImage(buf, ifds[0]);
      var rgba = new Uint8ClampedArray(root.UTIF.toRGBA8(ifds[0])), cv = newCanvas(ifds[0].width, ifds[0].height);
      cv.getContext('2d').putImageData(new ImageData(rgba, cv.width, cv.height), 0, 0);
      return cv.toDataURL('image/png');
    }
    return readAsDataURL(file);
  }

  /* ---------- image encoding to a size window ---------- */
  async function encodeToTarget(canvas, o) {
    var type = MIME[o.fmt], max = o.max ? o.max * 1024 : 0;
    async function enc(cv, q) {
      var b = await toBlob(cv, type, q);
      if (!b) throw new Error('Your browser could not encode this image.');
      if (b.type !== type) throw new Error('Your browser cannot save ' + o.fmt.toUpperCase() + ' files. Please choose JPG.');
      if (o.fmt === 'jpeg' && o.dpi) b = new Blob([patchJpegDpi(new Uint8Array(await b.arrayBuffer()), o.dpi)], { type: type });
      return { size: b.size, blob: b };
    }
    var cur = canvas, res;
    if (!max) { res = await enc(cur, 0.92); return { blob: res.blob, canvas: cur, note: '' }; }

    if (o.fmt === 'png') {
      var first = await enc(cur, 1);
      if (first.size <= max) return { blob: first.blob, canvas: cur, note: '' };
      if (o.lock) return { blob: first.blob, canvas: cur, note: 'too-big' };
      var found = await searchMax(async function (s) { var r = await enc(resizeCanvas(canvas, canvas.width * s, canvas.height * s), 1); return r; }, 0.04, 1, max, 9);
      if (!found) return { blob: first.blob, canvas: cur, note: 'too-big' };
      return { blob: found.r.blob, canvas: resizeCanvas(canvas, canvas.width * found.x, canvas.height * found.x), note: found.x < 0.999 ? 'scaled' : '' };
    }

    var floor = o.lock ? 0.03 : 0.38, scale = 1;
    for (var i = 0; i < 18; i++) {
      var probe = await enc(cur, floor);
      if (probe.size <= max) {
        var best = await searchMax(function (q) { return enc(cur, q); }, floor, 0.95, max, 9);
        return { blob: best.r.blob, canvas: cur, note: scale < 0.999 ? 'scaled' : '' };
      }
      if (o.lock) return { blob: probe.blob, canvas: cur, note: 'too-big' };
      var f = Math.max(0.5, Math.min(0.93, Math.sqrt(max / probe.size) * 0.97));
      scale *= f; cur = resizeCanvas(canvas, canvas.width * scale, canvas.height * scale, o.fmt === 'jpeg' ? '#fff' : null);
      if (cur.width < 16 || cur.height < 16) break;
    }
    return { blob: null, canvas: cur, note: 'fail' };
  }

  /* ---------- image tool ---------- */
  function ImageTool(el) {
    var cfg = JSON.parse(el.dataset.config), P = cfg.preset || {};
    var $ = function (r) { return el.querySelector('[data-role="' + r + '"]'); };
    var F = {}; el.querySelectorAll('[data-f]').forEach(function (n) { F[n.dataset.f] = n; });
    var cropper = null, file = null, gray = false, contrast = false, resultUrl = null;
    var status = $('status');
    function say(msg, kind) { status.textContent = msg || ''; status.className = 'status' + (kind ? ' ' + kind : ''); }

    function applyPreset(p) {
      F.max.value = p.max || ''; F.min.value = p.min || ''; F.w.value = p.w || ''; F.h.value = p.h || '';
      F.unit.value = p.unit || 'px'; F.dpi.value = p.dpi || ''; F.fmt.value = p.fmt || 'jpeg'; F.pad.checked = !!p.pad;
      if (p.gray != null || p.contrast != null || p.max != null) { setFilter('gray', !!p.gray); setFilter('contrast', !!p.contrast); }
      el.dataset.ext = p.ext || '';
      updateLimit(); syncAspect();
    }
    function setFilter(k, on) {
      if (k === 'gray') gray = on; else contrast = on;
      $(k).classList.toggle('on', on); $('stage').classList.toggle('f-' + k, on);
    }
    function dims() {
      var dpi = +F.dpi.value || 0, w = +F.w.value, h = +F.h.value, u = F.unit.value;
      var pw = toPixels(w, u, dpi), ph = toPixels(h, u, dpi);
      return { w: pw, h: ph, both: pw > 0 && ph > 0 };
    }
    function syncAspect() {
      if (!cropper) return; var d = dims();
      cropper.setAspectRatio(d.both ? d.w / d.h : NaN);
    }
    function updateLimit() {
      var mn = +F.min.value, mx = +F.max.value;
      $('limit').textContent = mx ? (mn ? mn + '–' + mx + ' KB' : '≤ ' + mx + ' KB') : (mn ? '≥ ' + mn + ' KB' : 'none');
    }
    ['max', 'min'].forEach(function (k) { F[k].addEventListener('input', updateLimit); });
    ['w', 'h', 'unit', 'dpi'].forEach(function (k) { F[k].addEventListener('change', syncAspect); });

    el.querySelectorAll('[data-chip]').forEach(function (b) {
      b.addEventListener('click', function () {
        el.querySelectorAll('[data-chip]').forEach(function (x) { x.classList.toggle('on', x === b); });
        applyPreset(cfg.chips[+b.dataset.chip].p);
      });
    });
    $('gray').addEventListener('click', function () { setFilter('gray', !gray); });
    $('contrast').addEventListener('click', function () { setFilter('contrast', !contrast); });

    var dz = $('dz'), input = $('file');
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) open(e.dataTransfer.files[0]); });
    input.addEventListener('change', function () { if (input.files[0]) open(input.files[0]); });

    async function open(f) {
      say('Opening image…', 'info');
      try {
        if (f.size > 60 * 1024 * 1024) throw new Error('This file is over 60 MB. Please pick a smaller image.');
        file = f;
        $('orig').textContent = fmtSize(f.size);
        var src = await normaliseImage(f);
        await Promise.all([loadScript(CDN.cropperJs), (loadCss(CDN.cropperCss), Promise.resolve())]);
        if (cropper) { cropper.destroy(); cropper = null; }
        var img = $('img'); img.src = src;
        await new Promise(function (res, rej) { img.onload = res; img.onerror = function () { rej(new Error('This image could not be opened. Try a JPG or PNG.')); }; });
        $('bench').hidden = false; $('dl').hidden = true; $('preview').hidden = true; $('res').textContent = '–'; $('resBox').className = 'metric';
        if (!F.max.value && !F.min.value && !F.w.value && !F.dpi.value && !el.dataset.init) { applyPreset(P); }
        el.dataset.init = '1';
        var d = dims();
        cropper = new root.Cropper(img, { viewMode: 1, dragMode: 'move', autoCropArea: 0.9, aspectRatio: d.both ? d.w / d.h : NaN, background: false, guides: true, toggleDragModeOnDblclick: false, checkOrientation: true, ready: function () { $('rot').value = 0; $('zoom').value = 1; } });
        say('');
        $('bench').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) { say(e.message || 'Could not open this file.', 'err'); }
    }
    $('rot').addEventListener('input', function (e) { if (cropper) cropper.rotateTo(+e.target.value); });
    $('rotReset').addEventListener('click', function () { if (cropper) { $('rot').value = 0; cropper.rotateTo(0); } });
    $('zoom').addEventListener('input', function (e) { if (cropper) cropper.zoomTo(+e.target.value); });
    $('zoomReset').addEventListener('click', function () { if (cropper) { $('zoom').value = 1; cropper.zoomTo(1); } });

    $('go').addEventListener('click', async function () {
      if (!cropper) return;
      var btn = $('go'), idle = btn.innerHTML; btn.disabled = true; btn.textContent = 'Working…'; say('Finding the best quality that fits…', 'info');
      try {
        var fmt = F.fmt.value, d = dims(), dpi = +F.dpi.value || 0;
        var max = +F.max.value || 0, min = +F.min.value || 0;
        if (max && min && min > max) throw new Error('The minimum size is larger than the maximum size.');
        var opts = { imageSmoothingQuality: 'high', fillColor: fmt === 'jpeg' ? '#ffffff' : 'rgba(0,0,0,0)' };
        if (d.both) { opts.width = d.w; opts.height = d.h; opts.maxWidth = Math.max(d.w, 4096); opts.maxHeight = Math.max(d.h, 4096); }
        else { opts.maxWidth = 4096; opts.maxHeight = 4096; }
        var cv = cropper.getCroppedCanvas(opts);
        if (!cv) throw new Error('Nothing to crop. Move the crop box over your image.');
        applyFilters(cv, gray, contrast);
        var r = await encodeToTarget(cv, { fmt: fmt, max: max, dpi: dpi, lock: d.both });
        if (!r.blob) throw new Error('Could not reach that size without making the picture unusably small. Try a larger limit or a tighter crop.');
        var blob = r.blob;
        if (min && blob.size < min * 1024) {
          if (F.pad.checked && fmt !== 'webp') {
            var want = Math.min(max ? max * 1024 : Infinity, min * 1024 + 512);
            blob = new Blob([blob, new Uint8Array(Math.max(0, Math.round(want) - blob.size))], { type: blob.type });
          } else if (fmt === 'webp') { say('Result is under your minimum. WebP cannot be padded, so choose JPG or lower the minimum.', 'err'); }
        }
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(blob);
        var ext = fmt === 'jpeg' ? (el.dataset.ext || 'jpg') : fmt;
        var base = (file.name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'image';
        var dl = $('dl'); dl.href = resultUrl; dl.download = base + '-convertkb.' + ext; dl.hidden = false;
        var pv = $('preview'); pv.src = resultUrl; pv.hidden = false;
        $('res').textContent = fmtSize(blob.size) + ' · ' + r.canvas.width + '×' + r.canvas.height;
        var ok = (!max || blob.size <= max * 1024) && (!min || blob.size >= min * 1024);
        $('resBox').className = 'metric ' + (ok ? 'ok' : 'bad');
        var saved = Math.max(0, Math.round((1 - blob.size / file.size) * 100));
        if (r.note === 'too-big') say('Your fixed pixel size cannot fit under ' + max + ' KB. Raise the limit, shrink the dimensions, or switch the format to JPG.', 'err');
        else if (ok) say('Done. ' + (saved ? 'Saved ' + saved + '% of the original size.' : '') + (r.note === 'scaled' ? ' The picture was scaled down to fit the limit.' : ''), 'ok');
        else if (min && blob.size < min * 1024) say('The result is below your minimum. Tick “Pad to min size” (JPG/PNG).', 'err');
        dl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) { say(e.message || 'Something went wrong.', 'err'); }
      btn.disabled = false; btn.innerHTML = idle;
    });
    applyPreset(P);
  }

  /* ---------- PDF tool ---------- */
  function PdfTool(el) {
    var cfg = JSON.parse(el.dataset.config), P = cfg.preset || {};
    var $ = function (r) { return el.querySelector('[data-role="' + r + '"]'); };
    var F = {}; el.querySelectorAll('[data-f]').forEach(function (n) { F[n.dataset.f] = n; });
    var files = [], url = null, status = $('status'), prog = $('prog');
    function say(m, k) { status.textContent = m || ''; status.className = 'status' + (k ? ' ' + k : ''); }
    F.max.value = P.max || ''; F.gray.checked = !!P.gray; F.dpi.value = P.mode === 'pdf' && !P.max ? '300' : '';

    var dz = $('dz'), input = $('file');
    ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { add(e.dataTransfer.files); });
    input.addEventListener('change', function () { add(input.files); input.value = ''; });
    function add(list) {
      var arr = [].slice.call(list);
      if (!P.multi) files = [];
      arr.forEach(function (f) {
        var pdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name), img = /^image\//.test(f.type);
        if (P.mode === 'jpg2pdf' ? img : (pdf || (P.multi && img))) files.push(f);
      });
      if (!files.length) { say('Please choose ' + (P.mode === 'jpg2pdf' ? 'image files.' : 'a PDF file.'), 'err'); return; }
      say(''); render();
    }
    function render() {
      $('bench').hidden = false; $('dl').hidden = true;
      var ul = $('list'); ul.innerHTML = '';
      files.forEach(function (f, i) {
        var li = document.createElement('li'), s = document.createElement('span'), b = document.createElement('button');
        s.textContent = f.name + ' (' + fmtSize(f.size) + ')'; b.type = 'button'; b.setAttribute('aria-label', 'Remove ' + f.name); b.textContent = '×';
        b.onclick = function () { files.splice(i, 1); if (!files.length) $('bench').hidden = true; else render(); };
        li.appendChild(s); li.appendChild(b); ul.appendChild(li);
      });
      $('orig').textContent = fmtSize(files.reduce(function (a, f) { return a + f.size; }, 0));
      $('pages').textContent = '–'; $('res').textContent = '–'; $('resBox').className = 'metric';
    }

    async function gatherPages() {
      await Promise.all([loadScript(CDN.pdfjs), loadScript(CDN.pdflib)]);
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
      var pages = [];
      for (var fi = 0; fi < files.length; fi++) {
        var f = files[fi];
        if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          var doc;
          try { doc = await root.pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; }
          catch (e) { throw new Error(e && e.name === 'PasswordException' ? '“' + f.name + '” is password-protected. Remove the password first.' : '“' + f.name + '” could not be read as a PDF.'); }
          for (var n = 1; n <= doc.numPages; n++) {
            var pg = await doc.getPage(n), vp = pg.getViewport({ scale: 1 });
            pages.push((function (pg, vp) { return { w: vp.width, h: vp.height, render: async function (scale) {
              var v = pg.getViewport({ scale: scale }), c = newCanvas(v.width, v.height), x = c.getContext('2d');
              x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: x, viewport: v }).promise; return c; } }; })(pg, vp));
          }
        } else {
          var img = await loadImage(await normaliseImage(f)), land = img.width > img.height, W = land ? 842 : 595, H = land ? 595 : 842, m = 18;
          var fit = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height), iw = img.width * fit, ih = img.height * fit;
          pages.push((function (img, W, H, iw, ih) { return { w: W, h: H, render: async function (scale) {
            var c = newCanvas(W * scale, H * scale), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
            x.imageSmoothingQuality = 'high'; x.drawImage(img, (W - iw) / 2 * scale, (H - ih) / 2 * scale, iw * scale, ih * scale); return c; } }; })(img, W, H, iw, ih));
        }
      }
      if (pages.length > 50) throw new Error('This file has ' + pages.length + ' pages. Please split it into parts of 50 pages or fewer.');
      return pages;
    }
    async function build(pages, jpegs) {
      var doc = await root.PDFLib.PDFDocument.create();
      for (var i = 0; i < pages.length; i++) {
        var im = await doc.embedJpg(jpegs[i]), pg = doc.addPage([pages[i].w, pages[i].h]);
        pg.drawImage(im, { x: 0, y: 0, width: pages[i].w, height: pages[i].h });
      }
      return doc.save({ useObjectStreams: true });
    }
    async function jpegBytes(cv, q) { return new Uint8Array(await (await toBlob(cv, 'image/jpeg', q)).arrayBuffer()); }

    $('go').addEventListener('click', async function () {
      if (!files.length) return;
      var btn = $('go'), idle = btn.innerHTML; btn.disabled = true; btn.textContent = 'Working…'; prog.hidden = false; prog.value = 0; $('dl').hidden = true;
      try {
        say('Reading pages…', 'info');
        var pages = await gatherPages(); $('pages').textContent = pages.length;
        var max = (+F.max.value || 0) * 1024, g = F.gray.checked, userDpi = +F.dpi.value || 0, out = null, note = '';
        var prep = function (c) { return g ? applyFilters(c, true, false) : c; };

        if (!max) {                       // no size target: render at chosen DPI
          var sc = (userDpi || 150) / 72, jp = [];
          for (var i = 0; i < pages.length; i++) { prog.value = (i / pages.length) * 100; say('Rendering page ' + (i + 1) + ' of ' + pages.length + '…', 'info'); jp.push(await jpegBytes(prep(await pages[i].render(sc)), 0.88)); }
          out = await build(pages, jp);
        } else {
          var maxScale = userDpi ? userDpi / 72 : 2.2, scales = [2.2, 1.7, 1.35, 1.05, 0.85, 0.7, 0.55, 0.45, 0.35, 0.28].filter(function (s) { return s <= maxScale + 0.01; });
          if (!scales.length) scales = [maxScale];
          for (var si = 0; si < scales.length && !out; si++) {
            var s = scales[si], cvs = [];
            for (var p = 0; p < pages.length; p++) { prog.value = ((si + p / pages.length) / scales.length) * 100; say('Trying resolution ' + Math.round(s * 72) + ' DPI (page ' + (p + 1) + '/' + pages.length + ')…', 'info'); cvs.push(prep(await pages[p].render(s))); }
            var tryQ = async function (q) { var jp = []; for (var k = 0; k < cvs.length; k++) jp.push(await jpegBytes(cvs[k], q)); var bytes = await build(pages, jp); return { size: bytes.length, bytes: bytes }; };
            var floorQ = si === scales.length - 1 ? 0.15 : 0.4, probe = await tryQ(floorQ);
            if (probe.size <= max) { var best = await searchMax(tryQ, floorQ, 0.92, max, 6); out = best.r.bytes; }
            cvs = null;
          }
          if (!out) { note = 'fail'; }
        }
        prog.value = 100;
        if (!out) throw new Error('Could not get under ' + (+F.max.value) + ' KB without making the pages unreadable. Try a larger limit, fewer pages, or Grayscale.');
        var blob = new Blob([out], { type: 'application/pdf' });
        if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(blob);
        var dl = $('dl'); dl.href = url; dl.download = (P.multi ? 'merged' : (files[0].name.replace(/\.pdf$/i, '') || 'document').replace(/[^\w-]+/g, '-')) + '-convertkb.pdf'; dl.hidden = false;
        $('res').textContent = fmtSize(blob.size); $('resBox').className = 'metric ' + (!max || blob.size <= max ? 'ok' : 'bad');
        say('Done. Please open the downloaded file and zoom in to check it is readable before submitting.', 'ok');
      } catch (e) { say(e.message || 'Something went wrong.', 'err'); }
      prog.hidden = true; btn.disabled = false; btn.innerHTML = idle;
    });
  }

  /* ---------- calculator ---------- */
  function Calc(el) {
    var c = JSON.parse(el.dataset.config), q = function (k) { return el.querySelector('[data-c="' + k + '"]'); };
    function fmt(n) { return Number.isInteger(n) ? n.toLocaleString('en-US') : String(+n.toPrecision(9)); }
    function run() {
      var v = parseFloat(q('v').value), base = +el.querySelector('[data-c="b"]:checked').value, f = q('f').value, t = q('t').value;
      if (isNaN(v)) { q('out').textContent = '–'; q('formula').textContent = 'Enter a number'; return; }
      q('out').textContent = fmt(convertUnits(v, f, t, base)) + ' ' + t;
      q('formula').textContent = fmt(v) + ' ' + f + ' ÷ or × ' + base + ' per step (' + (base === 1024 ? 'binary' : 'decimal') + ')';
    }
    el.addEventListener('input', run); el.addEventListener('change', run); run();
  }

  document.querySelectorAll('[data-tool]').forEach(function (el) { el.dataset.kind === 'pdf' ? PdfTool(el) : ImageTool(el); });
  document.querySelectorAll('[data-calc]').forEach(Calc);
})(typeof window !== 'undefined' ? window : globalThis);

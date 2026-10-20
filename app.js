(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var A = $('a'), B = $('b'), resultEl = $('result'), cliEl = $('cli');
  var state = { dir: 'ab', tab: 'diff', kinds: { changed: true, onlyA: true, onlyB: true } };
  var last = null;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KIND_ORDER = { changed: 0, onlyA: 1, onlyB: 2 };
  var CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // Text with the filter match wrapped in <mark>.
  function hl(parent, text, q) {
    var i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) { parent.appendChild(document.createTextNode(text)); return parent; }
    parent.appendChild(document.createTextNode(text.slice(0, i)));
    var m = el('mark', 'hit', text.slice(i, i + q.length));
    parent.appendChild(m);
    parent.appendChild(document.createTextNode(text.slice(i + q.length)));
    return parent;
  }

  function delta(a, b) {
    if (a === null || b === null) return '';
    var x = Number(a), y = Number(b);
    if (!isFinite(x) || !isFinite(y) || a === '' || b === '') return '';
    var d = Math.round((y - x) * 1000) / 1000;
    return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d);
  }

  function paneMeta(side) {
    var text = (side === 'a' ? A : B).value;
    var m = $('meta-' + side);
    if (!text.trim()) { m.textContent = 'empty'; m.className = 'meta'; return; }
    var p = BFDiff.parse(text);
    var n = p.entries.size;
    if (!n) { m.textContent = 'no settings found, is this diff all output?'; m.className = 'meta warn'; return; }
    var v = p.header.match(/^(\S+).*?(\d+\.\d+\.\d+)/);
    var fw = v ? v[1].replace(/\/.*/, '') + ' ' + v[2] : '';
    m.textContent = (fw ? fw + ' · ' : '') + n + ' settings';
    m.className = 'meta ok';
  }

  function row(kind, r, q) {
    var d = el('div', 'row ' + kind);
    d.appendChild(el('span', 'mk', kind === 'changed' ? '~' : kind === 'onlyA' ? '−' : '+'));
    var k = el('span', 'k');
    if (r.key.indexOf('set ') === 0) { k.appendChild(el('i', '', 'set ')); hl(k, r.key.slice(4), q); }
    else hl(k, r.key, q);
    d.appendChild(k);
    [['va', r.a], ['vb', r.b]].forEach(function (c) {
      var s = el('span', c[0]);
      if (c[1] === null) s.appendChild(el('span', 'dv', 'default'));
      else hl(s, r.raw ? 'present' : (c[1] === '' ? '(empty)' : c[1]), q);
      d.appendChild(s);
    });
    d.appendChild(el('span', 'dl', delta(r.a, r.b)));
    return d;
  }

  function emptyState(kind) {
    var d = el('p', 'empty');
    if (kind === 'one') { d.textContent = 'One more dump and the differences show up here.'; return d; }
    d.appendChild(document.createTextNode('Or try an example: '));
    ['betaflight', 'inav'].forEach(function (k, i) {
      if (i) d.appendChild(document.createTextNode(' or '));
      var b = el('button', 'link', BFExamples[k].label);
      b.type = 'button';
      b.addEventListener('click', function () { loadExample(k); });
      d.appendChild(b);
    });
    return d;
  }

  function renderCli() {
    cliEl.textContent = '';
    if (!last || !(last.changed.length + last.onlyA.length + last.onlyB.length)) {
      var e = el('p', 'empty', A.value.trim() && B.value.trim() ? 'Nothing to change.' : 'One more dump and the CLI shows up here.');
      cliEl.appendChild(e);
      return;
    }
    var c = BFDiff.toCli(last, state.dir);
    var bar = el('div', 'cli-bar');
    var b1 = el('span'); b1.appendChild(el('b', '', String(c.lines))); b1.appendChild(document.createTextNode(' commands'));
    bar.appendChild(b1);
    if (c.skipped) { var b2 = el('span'); b2.appendChild(el('b', '', String(c.skipped))); b2.appendChild(document.createTextNode(' left as comments, reset by hand')); bar.appendChild(b2); }
    cliEl.appendChild(bar);
    var pre = el('pre', 'cli');
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', 'Generated CLI commands');
    c.text.replace(/\n$/, '').split('\n').forEach(function (l, i) {
      var s = el('span', /^#/.test(l) ? 'cm' : /^(profile|rateprofile|control_profile|mixer_profile|battery_profile) \d+$/.test(l) ? 'sc' : l === 'save' ? 'sv' : '', l);
      s.setAttribute('data-n', i + 1);
      pre.appendChild(s);
    });
    cliEl.appendChild(pre);
  }

  function render(reveal) {
    paneMeta('a'); paneMeta('b');
    var ta = A.value.trim(), tb = B.value.trim();
    last = (ta && tb) ? BFDiff.compare(A.value, B.value) : null;
    $('n-changed').textContent = last ? last.changed.length : 0;
    $('n-onlyA').textContent = last ? last.onlyA.length : 0;
    $('n-onlyB').textContent = last ? last.onlyB.length : 0;
    $('n-same').textContent = last ? last.same : 0;
    var any = !!last && (last.changed.length + last.onlyA.length + last.onlyB.length) > 0;
    $('copy-cli').disabled = !any;
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) { c.disabled = !last; });
    $('toolbar').hidden = !last; $('tabs').hidden = !last;
    $('dir').textContent = state.dir === 'ab' ? 'A to B' : 'B to A';
    $('dir').title = 'CLI turns ' + (state.dir === 'ab' ? 'A into B' : 'B into A') + ' (click to flip)';
    renderCli();

    resultEl.textContent = '';
    if (!last) { resultEl.appendChild(emptyState(ta || tb ? 'one' : 'empty')); return; }
    if (!any) {
      resultEl.appendChild(el('p', 'empty', 'No differences. Both dumps have the same ' + last.same + ' settings.'));
      return;
    }
    var q = $('filter').value.trim().toLowerCase();
    var groups = {};
    [['changed', last.changed], ['onlyA', last.onlyA], ['onlyB', last.onlyB]].forEach(function (x) {
      if (!state.kinds[x[0]]) return;
      x[1].forEach(function (r) {
        if (q && (r.scope + ' ' + r.key + ' ' + r.a + ' ' + r.b).toLowerCase().indexOf(q) < 0) return;
        (groups[r.scope] = groups[r.scope] || []).push([x[0], r]);
      });
    });
    var scopes = Object.keys(groups).sort(BFDiff.sortScopes);
    if (!scopes.length) { resultEl.appendChild(el('p', 'nomatch', 'No settings match the current filter.')); return; }
    var head = el('div', 'colhead');
    ['', 'Setting', 'A', 'B', 'Δ'].forEach(function (t, i) {
      var s = el('span', i === 2 ? 'ca' : i === 3 ? 'cb' : '', t);
      if (i === 4) s.style.textAlign = 'right';
      head.appendChild(s);
    });
    resultEl.appendChild(head);
    scopes.forEach(function (scope) {
      var rows = groups[scope].sort(function (x, y) { return KIND_ORDER[x[0]] - KIND_ORDER[y[0]]; });
      var det = el('details', 'group');
      det.open = true;
      var sum = el('summary');
      sum.innerHTML = CHEVRON;
      var name = el('span', 'gname');
      var parts = scope.split(' ');
      if (parts[1]) { name.appendChild(el('small', '', parts[0] + ' ')); name.appendChild(document.createTextNode(parts[1])); }
      else name.textContent = scope;
      sum.appendChild(name);
      var cnt = el('span', 'gcount');
      [['c', 'changed'], ['ia', 'onlyA'], ['ib', 'onlyB']].forEach(function (k) {
        var n = rows.filter(function (r) { return r[0] === k[1]; }).length;
        if (n) cnt.appendChild(el('span', k[0], n + (k[1] === 'changed' ? ' changed' : k[1] === 'onlyA' ? ' only A' : ' only B')));
      });
      sum.appendChild(cnt);
      det.appendChild(sum);
      rows.forEach(function (r) { det.appendChild(row(r[0], r[1], q)); });
      resultEl.appendChild(det);
    });
    if (reveal && !reduced && window.Motion && state.tab === 'diff') {
      var gs = Array.prototype.slice.call(resultEl.querySelectorAll('.group')).slice(0, 12);
      Motion.animate(gs, { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] },
        { duration: 0.5, delay: Motion.stagger(0.06), ease: [0.16, 1, 0.3, 1] });
    }
  }

  // status line
  var statusTimer;
  function flash(msg) {
    var s = $('status');
    s.textContent = msg;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { s.textContent = ''; }, 2200);
  }
  function copy(text, msg) {
    var done = function () { flash(msg); };
    var fallback = function () {
      var t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) { flash('Copy failed, select the text and copy by hand'); }
      document.body.removeChild(t);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // URL hash
  var hashTimer;
  function syncHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      if (!A.value.trim() && !B.value.trim()) { history.replaceState(null, '', location.pathname + location.search); return; }
      BFShare.encode(A.value, B.value).then(function (h) { history.replaceState(null, '', '#' + h); });
    }, 350);
  }

  var inputTimer;
  function changed() {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(function () { render(false); syncHash(); }, 120);
  }
  function setBoth(a, b) { A.value = a; B.value = b; render(true); syncHash(); }
  function loadExample(k) { setBoth(BFExamples[k].a, BFExamples[k].b); flash('Loaded ' + BFExamples[k].label); }

  function swap() {
    var t = A.value; A.value = B.value; B.value = t;
    var s = $('swap'); s.classList.toggle('spun');
    render(false); syncHash(); flash('Swapped A and B');
  }
  function setDir(d) {
    state.dir = d;
    render(false);
  }
  function setTab(t) {
    state.tab = t;
    $('tab-diff').setAttribute('aria-selected', String(t === 'diff'));
    $('tab-cli').setAttribute('aria-selected', String(t === 'cli'));
    resultEl.hidden = t !== 'diff';
    cliEl.hidden = t !== 'cli';
    $('dir').hidden = t !== 'cli';
  }
  function copyCli() {
    if (!last) return;
    var c = BFDiff.toCli(last, state.dir);
    if (!c.lines) { flash('Nothing to copy'); return; }
    copy(c.text, 'CLI copied (' + c.lines + ' commands)');
  }

  // files
  function readInto(file, ta) {
    if (file.size > 5e6) { flash(file.name + ' is too big for a config dump'); return Promise.resolve(); }
    return file.text().then(function (t) { ta.value = t; });
  }
  function loadFiles(files, target) {
    files = Array.prototype.filter.call(files, function (f) { return f.size >= 0; });
    if (!files.length) return;
    var jobs = [];
    if (files.length >= 2) { jobs.push(readInto(files[0], A)); jobs.push(readInto(files[1], B)); }
    else {
      var ta = target === 'a' ? A : target === 'b' ? B : (!A.value.trim() ? A : B);
      jobs.push(readInto(files[0], ta));
    }
    Promise.all(jobs).then(function () { render(true); syncHash(); });
  }
  var pickTarget = 'a';
  $('file').addEventListener('change', function (e) { loadFiles(e.target.files, pickTarget); e.target.value = ''; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (b) {
    b.addEventListener('click', function () { pickTarget = b.dataset.open; $('file').click(); });
  });
  function clearOver() { Array.prototype.forEach.call(document.querySelectorAll('.pane.over'), function (p) { p.classList.remove('over'); }); }
  window.addEventListener('dragover', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
    e.preventDefault();
    var p = e.target.closest && e.target.closest('.pane');
    clearOver();
    if (p) p.classList.add('over');
  });
  window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) clearOver(); });
  window.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    var p = e.target.closest && e.target.closest('.pane');
    clearOver();
    loadFiles(e.dataTransfer.files, p ? p.dataset.side : null);
  });

  // wiring
  A.addEventListener('input', changed);
  B.addEventListener('input', changed);
  $('filter').addEventListener('input', function () { render(false); });
  $('swap').addEventListener('click', swap);
  $('clear').addEventListener('click', function () { A.value = ''; B.value = ''; $('filter').value = ''; render(false); syncHash(); A.focus(); });
  $('copy-cli').addEventListener('click', copyCli);
  $('copy-link').addEventListener('click', function () {
    BFShare.encode(A.value, B.value).then(function (h) {
      history.replaceState(null, '', '#' + h);
      copy(location.href, location.href.length > 8000 ? 'Link copied, but it is long' : 'Link copied');
    });
  });
  $('dir').addEventListener('click', function () { setDir(state.dir === 'ab' ? 'ba' : 'ab'); });
  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) {
    b.addEventListener('click', function () {
      state.kinds[b.dataset.kind] = !state.kinds[b.dataset.kind];
      b.setAttribute('aria-pressed', String(state.kinds[b.dataset.kind]));
      render(false);
    });
  });
  $('tab-diff').addEventListener('click', function () { setTab('diff'); });
  $('tab-cli').addEventListener('click', function () { setTab('cli'); });

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey) return;
    var t = e.target, typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT');
    if (e.altKey && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) { e.preventDefault(); swap(); return; }
    if (e.key === 'Escape' && t === $('filter')) { $('filter').value = ''; render(false); $('filter').blur(); return; }
    if (typing || e.altKey) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); swap(); }
    else if (e.key === '/') { e.preventDefault(); $('filter').focus(); }
    else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); copyCli(); }
  });

  // start: hash wins, otherwise empty
  BFShare.decode(location.hash).then(function (s) {
    if (s) { A.value = s.a; B.value = s.b; }
    render(!!s);
  });
  render(false);
})();

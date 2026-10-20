/*
 * Betaflight / INAV CLI "diff all" comparer: pure functions, no DOM.
 * Format reference: Betaflight CLI docs, https://betaflight.com/docs/wiki/guides/current/Cli
 * (commands `set name = value`, `feature [-]NAME`, `beeper [-]NAME`, `serial N ...`,
 *  `aux N ...`, `resource NAME IDX PIN`, `profile N`, `rateprofile N`).
 * Semantics: `diff` only lists values that differ from firmware defaults, so a key
 * missing on one side means "default" on that side, not "unknown".
 */
(function (root) {
  'use strict';

  // Commands whose first N arguments identify the entry; the rest is the value.
  // SHORTCUT: table covers common Betaflight commands only; unknown commands
  // use the whole line as identity (so they show as only-in-A/B, never overwrite). Extend if users report misses.
  var KEY_ARGS = {
    aux: 1, serial: 1, adjrange: 1, rxrange: 1, rxfail: 1, servo: 1, smix: 1,
    mmix: 1, led: 1, color: 1, mode_color: 2, resource: 2, timer: 1, dma: 2,
    motor_mixer: 1, logic: 1, gvar: 1, osd_layout: 2, safehome: 1, geozone: 1, wp: 1,
    temp_sensor: 1, vtx: 1
  };
  // Single-valued commands: one entry per command name.
  var SINGLE = { board_name: 1, mixer: 1, map: 1, name: 1 };
  // Add/remove lists: `cmd NAME` / `cmd -NAME` (Betaflight and INAV).
  var TOGGLES = { feature: 1, beeper: 1, blackbox: 1, beacon: 1 };
  // Section headers: the following set/mmix/smix lines belong to that section.
  // INAV adds control_profile, mixer_profile and battery_profile.
  var SCOPE_CMDS = { profile: 1, rateprofile: 1, control_profile: 1, mixer_profile: 1, battery_profile: 1 };
  // mcu_id/manufacturer_id/signature are per-board identity, not config.
  var IGNORED = { batch: 1, defaults: 1, diff: 1, dump: 1, exit: 1, mcu_id: 1, manufacturer_id: 1, signature: 1, '': 1 };

  function parse(text) {
    var entries = new Map();
    var header = '';
    var scope = 'master';
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line[0] === '#') {
        if (!header && /^#\s*(betaflight|inav|cleanflight)\b/i.test(line)) {
          header = line.replace(/^#\s*/, '');
        }
        continue;
      }
      var parts = line.split(/\s+/);
      var cmd = parts[0].toLowerCase();
      if (cmd === 'save') break; // end of a dump; anything after is pasted prose
      if (IGNORED[cmd]) continue;
      if (cmd === 'master') { scope = 'master'; continue; }
      if (SCOPE_CMDS[cmd] && parts.length === 2) { scope = cmd + ' ' + parts[1]; continue; }
      var key, value, raw = false;
      if (cmd === 'set') {
        var m = line.match(/^set\s+(\S+)\s*=\s*(.*)$/i);
        if (!m) continue;
        key = 'set ' + m[1].toLowerCase();
        value = m[2].trim();
      } else if (TOGGLES[cmd]) {
        if (parts.length < 2) continue;
        var off = parts[1][0] === '-';
        key = cmd + ' ' + parts[1].replace(/^-/, '').toUpperCase();
        value = off ? 'off' : 'on';
      } else if (cmd === 'vtxtable') {
        // bands/channels/powerlevels N, band|channels N ..., powervalues/powerlabels ...
        var sub = (parts[1] || '').toLowerCase();
        if (!sub) continue;
        var idx = (sub === 'band' || sub === 'channels') ? 1 : 0;
        key = ['vtxtable', sub].concat(parts.slice(2, 2 + idx)).join(' ');
        value = parts.slice(2 + idx).join(' ');
      } else if ((cmd === 'mmix' || cmd === 'smix') && (parts[1] || '').toLowerCase() === 'reset') {
        continue;
      } else if (SINGLE[cmd]) {
        key = cmd;
        value = parts.slice(1).join(' ');
      } else if (KEY_ARGS[cmd] === undefined) {
        // Unknown command: whole line is the identity, so repeated lines never overwrite each other.
        key = parts.join(' ');
        value = 'present';
        raw = true;
      } else {
        var n = KEY_ARGS[cmd];
        key = [cmd].concat(parts.slice(1, 1 + n)).join(' ');
        value = parts.slice(1 + n).join(' ');
      }
      var entry = { scope: scope, key: key, value: value };
      if (raw) entry.raw = true;
      entries.set(scope + '\u0000' + key, entry);
    }
    return { entries: entries, header: header };
  }

  function row(e, a, b) {
    var r = { scope: e.scope, key: e.key, a: a, b: b };
    if (e.raw) r.raw = true;
    return r;
  }

  function compare(textA, textB) {
    var a = parse(textA), b = parse(textB);
    var changed = [], onlyA = [], onlyB = [], same = 0;
    a.entries.forEach(function (ea, id) {
      var eb = b.entries.get(id);
      if (!eb) onlyA.push(row(ea, ea.value, null));
      else if (eb.value !== ea.value) changed.push(row(ea, ea.value, eb.value));
      else same++;
    });
    b.entries.forEach(function (eb, id) {
      if (!a.entries.has(id)) onlyB.push(row(eb, null, eb.value));
    });
    return { changed: changed, onlyA: onlyA, onlyB: onlyB, same: same, headerA: a.header, headerB: b.header };
  }

  function toText(result) {
    var out = [];
    function add(title, rows, fmt) {
      if (!rows.length) return;
      out.push(title);
      rows.forEach(function (r) { out.push('  [' + r.scope + '] ' + fmt(r)); });
    }
    add('Changed:', result.changed, function (r) { return r.key + ': ' + r.a + ' -> ' + r.b; });
    add('Only in A (B uses default):', result.onlyA, function (r) { return r.key + ': ' + r.a; });
    add('Only in B (A uses default):', result.onlyB, function (r) { return r.key + ': ' + r.b; });
    out.push('Identical entries: ' + result.same);
    return out.join('\n');
  }

  // Section order for output: master, then each profile kind by number.
  var SCOPE_ORDER = ['master', 'profile', 'rateprofile', 'control_profile', 'mixer_profile', 'battery_profile'];
  function scopeRank(scope) {
    var p = scope.split(' ');
    return SCOPE_ORDER.indexOf(p[0]) * 1000 + (parseInt(p[1], 10) || 0);
  }
  function sortScopes(a, b) { return scopeRank(a) - scopeRank(b); }

  // One CLI line that sets `key` to `value`, or null if it cannot be expressed.
  function setLine(r, value) {
    var cmd = r.key.split(' ')[0];
    if (r.raw) return r.key;
    if (cmd === 'set') return 'set ' + r.key.slice(4) + ' = ' + value;
    if (TOGGLES[cmd]) return value === 'on' ? r.key : cmd + ' -' + r.key.slice(cmd.length + 1);
    return value === '' ? r.key : r.key + ' ' + value;
  }

  // CLI that turns the `from` side into the `to` side. dir 'ab': A -> B, 'ba': B -> A.
  // Lines present only in the source get undone where the default is known (feature,
  // beeper and friends); a plain `set` has no known default here, so it becomes a comment.
  function toCli(result, dir) {
    var fwd = dir !== 'ba';
    var from = fwd ? 'a' : 'b', to = fwd ? 'b' : 'a';
    var groups = {};
    var skipped = 0, count = 0;
    function put(scope, line) { (groups[scope] = groups[scope] || []).push(line); }
    var rows = result.changed.concat(result.onlyA, result.onlyB);
    rows.forEach(function (r) {
      var target = r[to], source = r[from];
      if (target !== null) {
        put(r.scope, setLine(r, target));
        count++;
        return;
      }
      var cmd = r.key.split(' ')[0];
      if (TOGGLES[cmd]) {
        // listed means "differs from default", so the default is the opposite
        put(r.scope, setLine(r, source === 'on' ? 'off' : 'on'));
        count++;
      } else {
        put(r.scope, r.raw ? '# ' + r.key + ': only here, remove by hand'
          : '# ' + (cmd === 'set' ? r.key.slice(4) : r.key) + ' = ' + source + ' here, the other side uses the default: reset by hand');
        skipped++;
      }
    });
    var out = [];
    Object.keys(groups).sort(sortScopes).forEach(function (scope) {
      if (scope !== 'master') out.push(scope);
      groups[scope].forEach(function (l) { out.push(l); });
    });
    var scoped = Object.keys(groups).some(function (s) { return /^profile /.test(s); });
    if (scoped) out.push('profile 0');
    out.push('save');
    return { text: out.join('\n') + '\n', lines: count, skipped: skipped };
  }

  var api = { sortScopes: sortScopes, toCli: toCli, setLine: setLine, parse: parse, compare: compare, toText: toText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFDiff = api;
})(typeof self !== 'undefined' ? self : this);

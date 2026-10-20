'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parse, compare, toText, toCli, sortScopes } = require('./bfdiff.js');

const A = `# Betaflight / STM32F405 (S405) 4.4.0 Jan 1 2024
# name: quad
feature -GPS
feature TELEMETRY
beeper -GYRO_CALIBRATED
serial 0 64 115200 57600 0 115200
aux 0 0 0 1300 1700 0 0
resource MOTOR 1 B00
set gyro_lpf1_static_hz = 0
set name = quad
profile 0
set p_pitch = 50
rateprofile 0
set roll_rc_rate = 7
`;
const B = `# Betaflight / STM32F405 (S405) 4.5.1 Jan 1 2025
feature GPS
feature TELEMETRY
beeper -GYRO_CALIBRATED
serial 0 64 115200 57600 0 115200
aux 0 0 0 1400 1700 0 0
resource MOTOR 1 B01
set gyro_lpf1_static_hz = 150
set vbat_min_cell_voltage = 330
profile 0
set p_pitch = 50
rateprofile 0
set roll_rc_rate = 7
rateprofile 1
set roll_rc_rate = 9
`;

test('parse captures header and scoped entries', () => {
  const p = parse(A);
  assert.match(p.header, /^Betaflight \/ STM32F405/);
  assert.strictEqual(p.entries.get('profile 0\u0000set p_pitch').value, '50');
  assert.strictEqual(p.entries.get('master\u0000feature GPS').value, 'off');
});

test('compare finds changed values and toggles', () => {
  const r = compare(A, B);
  const find = (k) => r.changed.find((c) => c.key === k);
  assert.deepStrictEqual(find('feature GPS'), { scope: 'master', key: 'feature GPS', a: 'off', b: 'on' });
  assert.strictEqual(find('set gyro_lpf1_static_hz').b, '150');
  assert.strictEqual(find('aux 0').a, '0 0 1300 1700 0 0');
  assert.strictEqual(find('resource MOTOR 1').b, 'B01');
});

test('compare finds entries only on one side, scope-aware', () => {
  const r = compare(A, B);
  assert.ok(r.onlyA.some((e) => e.key === 'set name'));
  assert.ok(r.onlyB.some((e) => e.key === 'set vbat_min_cell_voltage'));
  assert.ok(r.onlyB.some((e) => e.scope === 'rateprofile 1' && e.key === 'set roll_rc_rate'));
});

test('same-named setting in different profiles is not confused', () => {
  const r = compare('profile 0\nset p_pitch = 40\nprofile 1\nset p_pitch = 50', 'profile 0\nset p_pitch = 40\nprofile 1\nset p_pitch = 55');
  assert.strictEqual(r.changed.length, 1);
  assert.strictEqual(r.changed[0].scope, 'profile 1');
  assert.strictEqual(r.same, 1);
});

test('identical input, CRLF, blank lines, and set-case', () => {
  const r = compare('SET Foo = 1\r\n\r\nsave', 'set foo = 1');
  assert.strictEqual(r.changed.length + r.onlyA.length + r.onlyB.length, 0);
  assert.strictEqual(r.same, 1);
});

test('empty and malformed input does not throw', () => {
  assert.doesNotThrow(() => compare('', null));
  assert.doesNotThrow(() => compare('set', 'feature'));
});

test('toText summarises', () => {
  const t = toText(compare(A, B));
  assert.match(t, /Changed:/);
  assert.match(t, /\[master\] feature GPS: off -> on/);
  assert.match(t, /Identical entries: \d+/);
});

// Hand-written INAV fixture, shaped like a forum post: dump, then chatter after `save`.
const INAV_A = `# INAV/MATEKF405TE 8.0.0 Jan 29 2025
batch start
defaults noreboot
feature GPS
control_profile 1
set fw_p_pitch = 15
control_profile 2
set fw_p_pitch = 20
mixer_profile 1
set model_preview_type = 14
mmix reset
mmix 0  1.000  0.000  0.000  0.000
smix reset
smix 0 1 1 100 0 -1
battery_profile 1
set bat_cells = 4
control_profile 1
mixer_profile 1
battery_profile 1
save
Thanks, that fixed it. Any more low hanging fruit?
`;
const INAV_B = INAV_A.replace('fw_p_pitch = 20', 'fw_p_pitch = 25').replace('bat_cells = 4', 'bat_cells = 6')
  .replace('mmix 0  1.000  0.000', 'mmix 0 1.000 1.000');

test('INAV control/mixer/battery profiles scope their settings', () => {
  const r = compare(INAV_A, INAV_B);
  const scopes = r.changed.map((c) => c.scope + '|' + c.key).sort();
  assert.deepStrictEqual(scopes, [
    'battery_profile 1|set bat_cells',
    'control_profile 2|set fw_p_pitch',
    'mixer_profile 1|mmix 0',
  ]);
  assert.strictEqual(compare(INAV_A, INAV_A).onlyA.length, 0);
});

test('INAV mmix/smix reset and trailing prose after save are ignored', () => {
  const p = parse(INAV_A);
  for (const id of p.entries.keys()) {
    assert.ok(!/reset|Thanks|fruit/.test(id), id);
  }
  assert.strictEqual(p.entries.get('mixer_profile 1\u0000mmix 0').value, '1.000 0.000 0.000 0.000');
});

test('beacon lines are toggles, not overwritten by each other', () => {
  const p = parse('beacon RX_LOST\nbeacon RX_SET\nbeacon -ARMED');
  assert.strictEqual(p.entries.size, 3);
  assert.strictEqual(p.entries.get('master\u0000beacon ARMED').value, 'off');
});

test('vtxtable subcommands are keyed per band, not collided', () => {
  const a = 'vtxtable bands 5\nvtxtable channels 8\nvtxtable band 1 BOSCAM_A A FACTORY 5865 5845\nvtxtable band 2 BOSCAM_B B FACTORY 5733 5752\nvtxtable powerlevels 4\nvtxtable powervalues 0 1 2 3\nvtxtable powerlabels 25 200';
  const b = a.replace('bands 5', 'bands 6').replace('5733 5752', '0 0').replace('powervalues 0 1 2 3', 'powervalues 14 23 0');
  const r = compare(a, b);
  assert.deepStrictEqual(r.changed.map((c) => c.key).sort(),
    ['vtxtable band 2', 'vtxtable bands', 'vtxtable powervalues']);
  assert.strictEqual(r.onlyA.length + r.onlyB.length, 0);
});

test('board identity lines are ignored, board_name compared', () => {
  const r = compare('board_name AAA\nmcu_id 1\nsignature\nmanufacturer_id X', 'board_name BBB\nmcu_id 2\nsignature\nmanufacturer_id Y');
  assert.strictEqual(r.changed.length, 1);
  assert.strictEqual(r.same, 0);
});

test('unknown repeated commands do not overwrite each other', () => {
  const r = compare('foo 1\nfoo 2', 'foo 1');
  assert.strictEqual(r.same, 1);
  assert.strictEqual(r.onlyA.length, 1);
});

// --- CLI generation ---

const lines = (c) => c.text.trimEnd().split('\n');

test('toCli sets changed and added values, ends with save', () => {
  const r = compare('set gyro_lpf1_static_hz = 0\nset p_pitch = 40', 'set gyro_lpf1_static_hz = 150\nset p_pitch = 40\nset roll_expo = 20');
  const c = toCli(r, 'ab');
  assert.deepStrictEqual(lines(c), ['set gyro_lpf1_static_hz = 150', 'set roll_expo = 20', 'save']);
  assert.strictEqual(c.lines, 2);
  assert.strictEqual(c.skipped, 0);
});

test('toCli switches into the right profile first and back to profile 0', () => {
  const a = 'set vbat_min_cell_voltage = 330\nprofile 1\nset p_pitch = 40\nrateprofile 2\nset roll_expo = 10';
  const b = 'set vbat_min_cell_voltage = 340\nprofile 1\nset p_pitch = 45\nrateprofile 2\nset roll_expo = 25';
  assert.deepStrictEqual(lines(toCli(compare(a, b), 'ab')), [
    'set vbat_min_cell_voltage = 340',
    'profile 1', 'set p_pitch = 45',
    'rateprofile 2', 'set roll_expo = 25',
    'profile 0', 'save',
  ]);
});

test('toCli direction ba reverses the values', () => {
  const r = compare('set a = 1', 'set a = 2');
  assert.deepStrictEqual(lines(toCli(r, 'ab')), ['set a = 2', 'save']);
  assert.deepStrictEqual(lines(toCli(r, 'ba')), ['set a = 1', 'save']);
});

test('toCli undoes feature and beeper lines that only the source has', () => {
  const r = compare('feature GPS\nfeature -AIRMODE\nbeeper -RX_SET', 'feature TELEMETRY');
  const l = lines(toCli(r, 'ab'));
  assert.ok(l.includes('feature -GPS'));
  assert.ok(l.includes('feature AIRMODE'));
  assert.ok(l.includes('beeper RX_SET'));
  assert.ok(l.includes('feature TELEMETRY'));
  assert.strictEqual(l[l.length - 1], 'save');
});

test('toCli turns a toggle flip into the matching on/off line', () => {
  const r = compare('feature -GPS', 'feature GPS');
  assert.deepStrictEqual(lines(toCli(r, 'ab')), ['feature GPS', 'save']);
  assert.deepStrictEqual(lines(toCli(r, 'ba')), ['feature -GPS', 'save']);
});

test('toCli writes keyed commands as key + value', () => {
  const r = compare('aux 0 0 0 1300 1700 0 0\nresource MOTOR 1 B00\nvtxtable powervalues 25 200', 'aux 0 0 0 1400 1700 0 0\nresource MOTOR 1 B01\nvtxtable powervalues 25 400');
  assert.deepStrictEqual(lines(toCli(r, 'ab')).sort(), [
    'aux 0 0 0 1400 1700 0 0', 'resource MOTOR 1 B01', 'save', 'vtxtable powervalues 25 400',
  ].sort());
});

test('toCli turns a set that only the source has into a comment, not a guess', () => {
  const c = toCli(compare('set name = quad', ''), 'ab');
  assert.strictEqual(c.skipped, 1);
  assert.strictEqual(c.lines, 0);
  assert.match(lines(c)[0], /^# name = quad/);
});

test('toCli re-emits unknown lines only the target has, as typed', () => {
  const c = toCli(compare('', 'foo bar 1'), 'ab');
  assert.deepStrictEqual(lines(c), ['foo bar 1', 'save']);
});

test('toCli output parses back to the target config', () => {
  const a = 'feature -GPS\nset p_pitch = 40\nprofile 1\nset d_pitch = 30\naux 0 0 0 1300 1700 0 0';
  const b = 'feature GPS\nset p_pitch = 45\nset roll_expo = 9\nprofile 1\nset d_pitch = 34\naux 0 0 0 1400 1700 0 0';
  const patched = a + '\nmaster\n' + toCli(compare(a, b), 'ab').text;
  // replay the generated lines on top of A, starting from the master scope
  const r = compare(patched, b);
  assert.strictEqual(r.changed.length + r.onlyB.length, 0);
});

test('sortScopes orders master, profiles, rateprofiles, INAV profiles', () => {
  const s = ['rateprofile 1', 'battery_profile 1', 'profile 10', 'profile 2', 'master', 'control_profile 1', 'mixer_profile 1'];
  assert.deepStrictEqual(s.sort(sortScopes), ['master', 'profile 2', 'profile 10', 'rateprofile 1', 'control_profile 1', 'mixer_profile 1', 'battery_profile 1']);
});

test('bundled examples compare cleanly and generate CLI', () => {
  globalThis.self = globalThis;
  delete require.cache[require.resolve('./examples.js')];
  require('./examples.js');
  for (const k of ['betaflight', 'inav']) {
    const e = globalThis.BFExamples[k];
    const r = compare(e.a, e.b);
    assert.ok(r.changed.length > 5, k);
    assert.ok(parse(e.a).entries.size > 30, k);
    assert.match(toCli(r, 'ab').text, /save\n$/);
  }
});

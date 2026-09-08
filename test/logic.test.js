// Offline tests for the logic that decides whether your phone buzzes.
// No network. Run with: npm test
import assert from 'node:assert/strict';
import { matchesWatch, findNewMatches, currentKeys } from '../src/alerts.js';
import { to12h, normalizeTime, utcToLocalParts, addDays, slotKey } from '../src/lib.js';

let passed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const slot = (over = {}) => ({
  courseId: 'hickory-hill', courseName: 'Hickory Hill', town: 'Methuen', state: 'MA',
  platform: 'foreUP', date: '2026-09-12', time24: '08:00', timeLabel: '8:00am',
  holes: 18, availableSpots: 4, maxPlayers: 4, greenFee: 56, cartFee: 24,
  backNine: false, bookingUrl: 'x', ...over,
});

console.log('time helpers');
t('to12h converts midday and midnight correctly', () => {
  assert.equal(to12h('12:00'), '12:00pm');
  assert.equal(to12h('00:30'), '12:30am');
  assert.equal(to12h('14:05'), '2:05pm');
});
t('normalizeTime pads and truncates seconds', () => {
  assert.equal(normalizeTime('7:09'), '07:09');
  assert.equal(normalizeTime('08:00:00'), '08:00');
  assert.equal(normalizeTime('nope'), null);
});
t('utcToLocalParts converts UTC to Eastern', () => {
  // 11:10 UTC on Sep 12 is 7:10am EDT.
  const r = utcToLocalParts('2026-09-12T11:10:00.000Z');
  assert.equal(r.date, '2026-09-12');
  assert.equal(r.time24, '07:10');
  assert.equal(r.label, '7:10am');
});
t('utcToLocalParts rolls the date backwards when needed', () => {
  // 01:30 UTC Sep 13 is 9:30pm EDT on Sep 12 — must not report Sep 13.
  const r = utcToLocalParts('2026-09-13T01:30:00.000Z');
  assert.equal(r.date, '2026-09-12');
  assert.equal(r.time24, '21:30');
});
t('addDays crosses a month boundary', () => {
  assert.equal(addDays('2026-09-29', 5), '2026-10-04');
});

console.log('watch matching');
t('matches an open weekend morning foursome', () => {
  const w = { label: 'w', courses: ['any'], daysOfWeek: [0, 6], timeFrom: '06:00', timeTo: '10:30', holes: 18, minSpots: 4 };
  assert.equal(matchesWatch(slot(), w), true); // 2026-09-12 is a Saturday
});
t('rejects a time outside the window', () => {
  const w = { label: 'w', timeFrom: '06:00', timeTo: '07:00' };
  assert.equal(matchesWatch(slot({ time24: '08:00' }), w), false);
});
t('rejects the wrong day of week', () => {
  const w = { label: 'w', daysOfWeek: [1] }; // Monday only
  assert.equal(matchesWatch(slot(), w), false);
});
t('rejects too few open spots', () => {
  const w = { label: 'w', minSpots: 4 };
  assert.equal(matchesWatch(slot({ availableSpots: 2 }), w), false);
});
t('rejects the wrong course', () => {
  const w = { label: 'w', courses: ['tree-house'] };
  assert.equal(matchesWatch(slot(), w), false);
});
t('respects maxGreenFee, including unknown prices', () => {
  assert.equal(matchesWatch(slot({ greenFee: 56 }), { label: 'w', maxGreenFee: 40 }), false);
  assert.equal(matchesWatch(slot({ greenFee: 35 }), { label: 'w', maxGreenFee: 40 }), true);
  assert.equal(matchesWatch(slot({ greenFee: null }), { label: 'w', maxGreenFee: 40 }), false);
});
t('a disabled watch never matches', () => {
  assert.equal(matchesWatch(slot(), { label: 'w', enabled: false }), false);
});
t('holes filter ignores slots with unknown hole count', () => {
  assert.equal(matchesWatch(slot({ holes: null }), { label: 'w', holes: 18 }), true);
  assert.equal(matchesWatch(slot({ holes: 9 }), { label: 'w', holes: 18 }), false);
});

console.log('new-opening detection');
const w4 = { label: 'Weekend 4some', courses: ['any'], timeFrom: '06:00', timeTo: '12:00', minSpots: 4 };
t('a slot already seen does not alert twice', () => {
  const s = slot();
  const seen = currentKeys([s]);
  assert.equal(findNewMatches([s], [w4], seen).length, 0);
});
t('a genuinely new slot alerts once', () => {
  const older = slot();
  const fresh = slot({ time24: '09:00', timeLabel: '9:00am' });
  const seen = currentKeys([older]);
  const hits = findNewMatches([older, fresh], [w4], seen);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].slot.time24, '09:00');
});
t('a slot that closes and reopens alerts again', () => {
  const s = slot();
  let seen = currentKeys([s]);          // open
  seen = currentKeys([]);                // taken — disappears from the sheet
  assert.equal(findNewMatches([s], [w4], seen).length, 1); // reopened
});
t('9 and 18 on the same time are tracked separately', () => {
  const a = slot({ holes: 18 });
  const b = slot({ holes: 9 });
  assert.notEqual(slotKey(a), slotKey(b));
});
t('front and back nine are tracked separately', () => {
  assert.notEqual(slotKey(slot({ backNine: false })), slotKey(slot({ backNine: true })));
});
t('seen keys only retain in-range dates', () => {
  const keys = currentKeys([slot({ date: '2026-09-12' }), slot({ date: '2026-09-13' })]);
  assert.equal(keys.length, 2);
});

console.log(`\n${passed} checks passed.`);

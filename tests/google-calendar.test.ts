import assert from 'node:assert/strict';
import test from 'node:test';
import { nextDate, normalizeCalendarEvents, sortCalendarEvents, zonedMidnight } from '../src/lib/google-calendar';

const day = '2026-09-24';
const start = zonedMidnight(day, 'Europe/Istanbul');
const end = zonedMidnight(nextDate(day), 'Europe/Istanbul');

test('Istanbul day boundaries include a 23:30 event that crosses midnight', () => {
  assert.equal(start.toISOString(), '2026-09-23T21:00:00.000Z');
  assert.equal(end.toISOString(), '2026-09-24T21:00:00.000Z');
  const events = normalizeCalendarEvents('primary', 'Kişisel', [
    { id: 'overnight', summary: 'Çalışma grubu', start: { dateTime: '2026-09-23T23:30:00+03:00' },
      end: { dateTime: '2026-09-24T01:30:00+03:00' } },
    { id: 'finished', start: { dateTime: '2026-09-23T20:00:00+03:00' },
      end: { dateTime: '2026-09-24T00:00:00+03:00' } },
  ], day, start, end);
  assert.deepEqual(events.map(event => event.id), ['overnight']);
  assert.equal(events[0].continuesFromPreviousDay, true);
  assert.equal(events[0].continuesIntoNextDay, false);
});

test('calendar day boundaries account for DST instead of assuming 24 hours', () => {
  const a = zonedMidnight('2026-03-29', 'Europe/Berlin');
  const b = zonedMidnight('2026-03-30', 'Europe/Berlin');
  assert.equal((b.getTime() - a.getTime()) / 3600000, 23);
});

test('all-day multi-day event intersects local day; an event ending today is excluded', () => {
  const events = normalizeCalendarEvents('a', 'Okul', [
    { id: 'present', summary: 'Gezi', start: { date: '2026-09-23' }, end: { date: '2026-09-26' } },
    { id: 'gone', summary: 'Bitti', start: { date: '2026-09-22' }, end: { date: '2026-09-24' } },
  ], day, start, end);
  assert.deepEqual(events.map(event => event.id), ['present']);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].continuesFromPreviousDay, true);
  assert.equal(events[0].continuesIntoNextDay, true);
});

test('cancelled instances and malformed entries are never displayed', () => {
  const events = normalizeCalendarEvents('a', 'Okul', [
    { id: 'cancelled', status: 'cancelled', summary: 'İptal', start: { date: day }, end: { date: nextDate(day) } },
    { id: 'bad', summary: 'Hatalı', start: { dateTime: 'bad' }, end: { dateTime: 'bad' } },
    { id: 'instance_20260924', summary: 'Tekrarlı ders', start: { dateTime: '2026-09-24T08:00:00+03:00' },
      end: { dateTime: '2026-09-24T09:00:00+03:00' } },
  ], day, start, end);
  assert.deepEqual(events.map(event => event.title), ['Tekrarlı ders']);
});

test('all-day first, then timed events ordered by start; unsafe event links are removed', () => {
  const events = sortCalendarEvents(normalizeCalendarEvents('a', 'Okul', [
    { id: 'late', summary: 'Geç', htmlLink: 'javascript:alert(1)', start: { dateTime: '2026-09-24T15:00:00+03:00' }, end: { dateTime: '2026-09-24T16:00:00+03:00' } },
    { id: 'early', summary: 'Erken', htmlLink: 'https://calendar.google.com/calendar/u/0/r/eventedit/example', start: { dateTime: '2026-09-24T09:00:00+03:00' }, end: { dateTime: '2026-09-24T10:00:00+03:00' } },
    { id: 'all', summary: 'Tüm gün', start: { date: day }, end: { date: nextDate(day) } },
  ], day, start, end));
  assert.deepEqual(events.map(event => event.id), ['all', 'early', 'late']);
  assert.equal(events[1].htmlLink?.startsWith('https://calendar.google.com/'), true);
  assert.equal(events[2].htmlLink, null);
});

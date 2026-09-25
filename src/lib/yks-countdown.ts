const istanbulFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function validCalendarDate(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match || Number(match[1]) < 100) return false;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(utc) && new Date(utc).toISOString().slice(0, 10) === day;
}

function istanbulOffsetAt(utcMillis: number): number {
  const parts = Object.fromEntries(
    istanbulFormatter.formatToParts(new Date(utcMillis))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return localAsUtc - utcMillis;
}

/** UTC instant when the supplied calendar day begins in Europe/Istanbul. */
export function istanbulDayStart(day: string): number | null {
  if (!validCalendarDate(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const nominalUtc = Date.UTC(year, month - 1, date);
  let instant = nominalUtc;
  // Resolve the zone offset at the target instant, including a possible rule change.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = nominalUtc - istanbulOffsetAt(instant);
    if (next === instant) break;
    instant = next;
  }
  return instant;
}

export function addCalendarDays(day: string, days: number): string | null {
  if (!validCalendarDate(day) || !Number.isInteger(days)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const noonUtc = new Date(Date.UTC(year, month - 1, date, 12));
  noonUtc.setUTCDate(noonUtc.getUTCDate() + days);
  return noonUtc.toISOString().slice(0, 10);
}

export function countdownParts(targetMillis: number, nowMillis: number) {
  const seconds = Math.max(0, Math.ceil((targetMillis - nowMillis) / 1000));
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}

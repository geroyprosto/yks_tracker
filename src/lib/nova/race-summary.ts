export type WeeklyRaceDay = {
  localDate: string;
  userScore: number | null;
  novaScore: number | null;
  finalized: boolean;
};

/** The server supplies the last seven recorded dates; only matched finalized days count. */
export function weeklyRaceSummary(days: readonly WeeklyRaceDay[]): {
  userTotal: number | null;
  novaTotal: number | null;
  includedDays: number;
} {
  let userTotal = 0;
  let novaTotal = 0;
  let includedDays = 0;
  for (const day of days) {
    if (!day.finalized || day.userScore === null || day.novaScore === null
      || !Number.isFinite(day.userScore) || !Number.isFinite(day.novaScore)
      || day.userScore < 0 || day.userScore > 100 || day.novaScore < 0 || day.novaScore > 100) continue;
    userTotal += day.userScore;
    novaTotal += day.novaScore;
    includedDays++;
  }
  return {
    userTotal: includedDays ? Math.round(userTotal * 100) / 100 : null,
    novaTotal: includedDays ? Math.round(novaTotal * 100) / 100 : null,
    includedDays,
  };
}

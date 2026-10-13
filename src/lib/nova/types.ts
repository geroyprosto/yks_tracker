/** Simulation contracts. None of these values writes to the user's study records. */
export type NovaState = { energy: number; stress: number; focus: number; confidence: number; socialEnergy: number; competition: number };
export type NovaPersonality = { discipline: number; ambition: number; resilience: number; sociability: number; humor: number; emotionalStability: number; competitiveness: number; strategy: number };
export type NovaReasonCode = 'GOOD_SLEEP' | 'SHORT_SLEEP' | 'RECOVERY' | 'STUDY_LOAD' | 'DISTRACTION' | 'TASK_COMPLETED' | 'TASK_MISSED' | 'CALIBRATION' | 'PREVIOUS_DAY';
export type NovaEventKind = 'sleep' | 'wake' | 'breakfast' | 'routine' | 'commute' | 'rest' | 'study' | 'questions' | 'exam' | 'analysis' | 'distraction' | 'meal' | 'free_time' | 'reflection';
export type NovaEventResult = { studyMinutes: number; questions: number; correct: number | null; topicProgress: number; tasksCompleted: number; simulatedExamNet?: number };
export type NovaEvent = { id: string; kind: NovaEventKind; label: string; startsAt: string; endsAt: string; subject: string | null; result: NovaEventResult | null; stateDelta: Partial<NovaState>; reasonCodes: NovaReasonCode[] };
export type NovaVisibleEvent = Omit<NovaEvent, 'result' | 'stateDelta'> & { status: 'planned' | 'active' | 'completed'; result: NovaEventResult | null };
export type NovaBaseline = {
  windowStart: string; windowEndExclusive: string; timezone: string; observedDays: number; activeDays: number;
  averageStudyMinutes: number | null; dailyTargetMinutes: number | null; weekdayTargets: number[] | null;
  averageQuestions: number | null; questionAccuracyPercent: number | null; taskCompletionPercent: number | null;
  averageTopicProgress: number | null; averageExamNet: number | null; typicalStudyHour: number | null;
  subjectStrengths: Record<string, number>; missingData: string[]; calibrationDaysRemaining: number;
};
export type NovaMetrics = {
  tasksCompleted: number | null; taskTotal: number | null; studyMinutes: number | null; studyTargetMinutes: number | null;
  questions: number | null; questionTarget: number | null; accuracyPercent: number | null;
  topicProgress: number | null; topicTarget: number | null; activeDays: number | null; observedDays: number | null;
};
export type NovaScoreComponent = 'tasks' | 'study' | 'questions' | 'topics' | 'consistency';
export type NovaScore = { total: number | null; components: Record<NovaScoreComponent, number | null>; weights: Record<NovaScoreComponent, number>; missing: NovaScoreComponent[] };
export type NovaDayInput = { localDate: string; timezone: string; seed: string; baseline: NovaBaseline; previousState?: NovaState; personality?: Partial<NovaPersonality>; engineVersion?: string; strengthMultiplier?: number; calibrationDay?: number; calibrationStudyMinutes?: number };
export type NovaDay = {
  /** Identity deliberately excludes seed/version: one official day per Nova/date. Storage adds nova_id. */
  identity: string; localDate: string; timezone: string; seed: string; engineVersion: string;
  startsAt: string; endsAt: string; inputSnapshot: NovaDayInput; startState: NovaState;
  reasonCodes: NovaReasonCode[]; events: NovaEvent[]; targets: { studyMinutes: number; questions: number; topicProgress: number; tasks: number };
};
export type NovaProjection = { localDate: string; now: string; completed: boolean; state: NovaState; mood: string; reasonCodes: NovaReasonCode[]; currentEvent: NovaVisibleEvent | null; timeline: NovaVisibleEvent[]; metrics: NovaMetrics; score: NovaScore };
export type NovaWeeklyResult = { localDate: string; completed: boolean; userScore: number | null; novaScore: number | null };
export type NovaRelationship = { familiarity: number; warmth: number; rivalry: number };
export type NovaRelationshipEvent = 'friendly_exchange' | 'duel_accepted' | 'duel_declined' | 'user_absent' | 'message_unanswered';
export type NovaProactiveTrigger = 'morning_checkin' | 'study_start' | 'user_ahead' | 'nova_ahead' | 'poor_exam' | 'focus_duel' | 'day_end';
export type NovaProactiveSettings = { enabled: boolean; pushEnabled: boolean; maxPerDay: number; quietStartHour: number; quietEndHour: number; maxDuelsPerWeek: number };
export type NovaProactiveHistory = { trigger: NovaProactiveTrigger; sentAt: string; answered: boolean };
export type NovaProactiveOpportunity = { key: string; trigger: NovaProactiveTrigger; expiresAt: string; pushAllowed: boolean };

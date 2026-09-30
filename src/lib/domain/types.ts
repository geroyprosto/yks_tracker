import type { EducationState } from '../education';
export type Difficulty = "easy" | "medium" | "hard";
export type Theme = "graphite" | "rose" | "ocean" | "aurora" | "forest" | "burgundy" | "plum" | "pastel" | "steel" | "white" | "black";
export type StudyType = "Konu anlatımı" | "Soru çözümü" | "Tekrar" | "Hızlı gözden geçirme" | "Yanlış analizi" | "Hâkimiyet kontrolü";
export type Settings = {
  display_name: string; exam_year: number; exam_date: string | null; target_rank: number | null;
  timezone: string; daily_target_minutes: number; task_share: number;
  difficulty_factors: Record<Difficulty, number>; weekday_targets: number[];
  theme: Theme; appearance: "dark" | "light" | "system"; reduced_motion: boolean; simple_view: boolean; revision: number;
};
export type TaskStep = { id: string; title: string; completed: boolean };
export type Task = {
  id: string; course_id?: string | null; title: string; plan_date: string; exam: "TYT" | "AYT" | null; subject: string | null;
  topic_id: string | null; resource: string; completion_criteria: string; planned_minutes: number;
  difficulty: Difficulty; progress: number; weight_override: number | null; priority: "low" | "normal" | "high";
  position: number; notes: string; study_type: StudyType; steps: TaskStep[]; revision: number;
  created_at: string; updated_at: string;
};
export type Topic = {
  id: string; exam: "TYT" | "AYT"; subject: string; name: string; parent_id: string | null;
  mastery: number; notes: string; review_requested: boolean; source: string; next_step: string;
  revision: number; updated_at: string;
};
export type StudySession = {
  id: string; course_id?: string | null; title: string; task_id: string | null; topic_id: string | null; subject: string | null;
  study_type: StudyType; mode: "stopwatch" | "countdown"; target_seconds: number | null;
  status: "running" | "paused" | "finished"; started_at: string; active_since: string | null;
  accumulated_seconds: number; finished_at: string | null; revision: number;
};
export type StudyInterval = { id: string; session_id: string; started_at: string; ended_at: string | null };
/** A reported duration has a calendar date, but no claimed clock start or end. */
export type ManualStudyEntry = { id: string; course_id?: string | null; study_date: string; subject: string; duration_seconds: number; created_at: string };
export type DayPlan = {
  id: string; plan_date: string; version: number; target_minutes: number; task_share: number;
  difficulty_factors: Record<Difficulty, number>; snapshot: Task[]; changed_at: string;
};
export type TopicHistory = { id: string; topic_id: string; old_mastery: number; new_mastery: number; changed_at: string };
export type PracticeEntry = {
  id: string; practice_date: string; course_id?: string | null; exam: "TYT" | "AYT" | null; subject: string | null;
  question_count: number; test_count: number; revision: number;
  created_at: string; updated_at: string;
};
export type ExamFormatCode = "TYT" | "AYT_SAYISAL" | "BRANCH";
export type ExamSectionFormat = { key: string; label: string; question_count: number };
export type ExamFormat = {
  code: ExamFormatCode; version: number; label: string; total_questions: number;
  wrong_divisor: number; sections: ExamSectionFormat[];
};
export type ExamSectionResult = {
  section_key: string; correct: number | null; wrong: number | null;
  blank: number | null; net: number;
};
export type ExamRecord = {
  id: string; name: string; publisher: string; exam_date: string;
  format_code: ExamFormatCode; format_version: number; format_snapshot: ExamFormat;
  duration_minutes: number | null; notes: string; score: number | null;
  rank: number | null; source_document_id: string | null;
  import_metadata: Record<string, unknown> | null; results: ExamSectionResult[];
  reported_total_net: number | null; total_net: number | null;
  total_net_source: "sections" | "reported" | null; revision: number; created_at: string; updated_at: string;
};export type JournalStructuredFields = {
  sleep_at?: string; wake_at?: string; sleep_quality?: number;
  mood?: string; energy?: number; stress?: number; environment?: string;
  interruptions?: number; activities?: string[]; people_tags?: string[];
  food_drink?: string; thoughts?: string;
};
export type JournalEntry = {
  id: string; journal_date: string; original_text: string;
  structured_fields: JournalStructuredFields; exclude_from_analysis: boolean;
  ai_shared_fields: string[]; revision: number; created_at: string; updated_at: string;
};
export type DayMark = {
  id: string; mark_date: string; kind: "rest" | "zero";
  revision: number; created_at: string; updated_at: string;
};export type AppState = {
  education?: EducationState; configured: boolean; authenticated: boolean; server_now: string; settings: Settings | null;
  tasks: Task[]; topics: Topic[]; sessions: StudySession[]; intervals: StudyInterval[];
  manual_study_entries?: ManualStudyEntry[];
  day_plans: DayPlan[]; topic_history: TopicHistory[]; practice_entries: PracticeEntry[]; exam_formats: ExamFormat[]; exams: ExamRecord[]; journal_entries: JournalEntry[]; day_marks: DayMark[];
};
export function emptyState(configured = false): AppState {
  return { configured, authenticated: false, server_now: new Date().toISOString(), settings: null,
    tasks: [], topics: [], sessions: [], intervals: [], manual_study_entries: [], day_plans: [], topic_history: [], practice_entries: [], exam_formats: [], exams: [], journal_entries: [], day_marks: [] };
}

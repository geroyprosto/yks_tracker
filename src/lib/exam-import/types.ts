import type { ExamFormatCode } from "../domain/types";

export type ImportResultSuggestion = {
  section_key: string;
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
  source_page: number;
  raw: string;
  uncertain: boolean;
};
export type ImportCandidate = {
  index: number;
  label: string;
  student_label: string | null;
  format_code: ExamFormatCode | null;
  exam_date: string | null;
  name: string | null;
  publisher: string | null;
  score?: number | null;
  rank?: number | null;
  results: ImportResultSuggestion[];
  reported_total_net: number | null;
  reported_total_source: {source_page: number; raw: string; uncertain: boolean} | null;
  source_pages: number[];
  warnings: string[];
};
export type ImportDocument = {
  id: string;
  original_filename: string;
  sha256: string;
  page_count: number;
  extraction_status: "ready" | "needs_visual_review";
  visual_extraction_status?: "not_needed" | "skipped_by_user" | "provider_not_configured" | "succeeded" | "failed";
  candidates: ImportCandidate[];
  committed_candidate_indexes: number[];
  created_at: string;
};
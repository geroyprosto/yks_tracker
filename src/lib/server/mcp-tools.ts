import { McpServer } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildStudyReport, studyReportRange } from "../study-report";
import { localDate } from "../ui";
import { getMcpOwnerState, executeMcpOwnerCommand } from "./mcp-gateway";
import { registerAnalysisSourcesTool } from "./mcp-analysis-tool";
import {loadCoachingContext} from './coaching';
import { ApiError } from "./http";
import { registerTopicStatusTool } from "./mcp-topic-tool";

const date = z.iso.date();
const limit = z.number().int().min(1).max(100).default(25);

export const studySummaryInput = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
}).strict();

export const listTasksInput = z.object({
  from_date: date.optional(),
  to_date: date.optional(),
  status: z.enum(["all", "open", "done"]).default("all"),
  limit,
}).strict();

export const listTopicsInput = z.object({
  exam: z.enum(["TYT", "AYT"]).optional(),
  subject: z.string().trim().min(1).max(120).optional(),
  limit,
}).strict();

export const listStudySessionsInput = z.object({
  from_date: date.optional(),
  to_date: date.optional(),
  limit,
}).strict();
export const listExamsInput = z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict();

// request_id is supplied by the caller and must be reused when retrying the same creation.
export const createTaskInput = z.object({
  request_id: z.uuid(),
  title: z.string().trim().min(1).max(240),
  plan_date: date,
  exam: z.enum(["TYT", "AYT"]).optional(),
  subject: z.string().trim().min(1).max(120).optional(),
  planned_minutes: z.number().int().min(0).max(1440).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
}).strict();

// A reported duration has a date only; it does not invent a timer start or end.
export const createStudySessionInput = z.object({
  request_id: z.uuid(),
  confirmed_by_user: z.literal(true),
  study_date: date,
  subject: z.string().trim().min(1).max(120),
  minutes: z.number().int().min(1).max(1440),
}).strict();
const examResult = z.union([
  z.object({ section_key: z.string().trim().min(1).max(80), correct: z.number().int().min(0).max(1000),
    wrong: z.number().int().min(0).max(1000), blank: z.number().int().min(0).max(1000) }).strict(),
  z.object({ section_key: z.string().trim().min(1).max(80), net: z.number().finite().min(-1000).max(1000) }).strict(),
]);

// Only structured exam figures cross this boundary. No PDF, file path, document id or URL is accepted.
export const createExamInput = z.object({
  request_id: z.uuid(),
  confirmed_by_user: z.literal(true),
  name: z.string().trim().min(1).max(240),
  exam_date: date,
  format_code: z.enum(["TYT", "AYT_SAYISAL", "BRANCH"]),
  publisher: z.string().trim().max(240).optional(),
  branch_subject: z.string().trim().min(1).max(120).optional(),
  branch_question_count: z.number().int().min(1).max(1000).optional(),
  duration_minutes: z.number().int().min(1).max(1440).optional(),
  score: z.number().finite().min(0).max(1000).optional(),
  rank: z.number().int().min(1).max(100000000).optional(),
  reported_total_net: z.number().finite().min(-1000).max(1000).optional(),
  results: z.array(examResult).max(50).default([]),
}).strict().superRefine((value, context) => {
  if (!value.results.length && value.reported_total_net === undefined) {
    context.addIssue({ code: "custom", message: "En az bir ders sonucu veya genel net gerekli.", path: ["results"] });
  }
  if (new Set(value.results.map(row => row.section_key)).size !== value.results.length) {
    context.addIssue({ code: "custom", message: "Aynı ders sonucu iki kez girilemez.", path: ["results"] });
  }
  if (value.format_code === "BRANCH" && (!value.branch_subject || !value.branch_question_count)) {
    context.addIssue({ code: "custom", message: "Branş ve soru sayısı gerekli.", path: ["branch_subject"] });
  }
  if (value.format_code !== "BRANCH" && (value.branch_subject !== undefined || value.branch_question_count !== undefined)) {
    context.addIssue({ code: "custom", message: "Branş alanları yalnız branş denemesinde kullanılabilir.", path: ["branch_subject"] });
  }
});
const authenticatedToolMeta = { securitySchemes: [{ type: "oauth2", scopes: [] }] };
const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

async function safely<T>(work: () => Promise<T>) {
  try { return result(await work()); }
  catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof ApiError ? error.message : "İşlem tamamlanamadı." }],
    };
  }
}

/** The caller is already authenticated and owner-checked before this factory runs. */
export function createStudyMcpServer(client: SupabaseClient, userId: string, appUrl: string) {
  const server = new McpServer({ name: "yksim-study", version: "0.1.0" }, { instructions:
    "YKSim'de öğrencinin mevcut durumunu sormadan önce get_analysis_sources, list_topics ve list_tasks ile gerçek kayıtları incele. Kayıtlı kişisel yıllık plan ve güncel ay üzerinden haftalık konu bitirme hedefleri ver: bu hafta anlatımı bitir, önkoşullar tamamlanınca sonraki hafta bağımsız çözümü tamamla. Şimdi 20 soru çöz gibi anlık genel emir kullanma. Kayıtlı hedef ayına göre gecikme varsa açıkça uyar, hedef tarih uydurma. Kullanıcı ödev eklenmesini istemişse somut haftalık görevleri Görevlerim'e gerçekten yaz; yalnız başarılı araç sonucu varsa eklendi de. Haftalık oran tamamlanan yüksek öncelikli / Pazartesi-Pazar planlanan tüm yüksek öncelikli görevlerdir. Bugün ve gelecekteki açık görevi gecikmiş sayma. Ders bazlı oran ve konu ilerlemesi beraber kaçınma gösterebilir; kesin kişilik hükmü verme. Günlük alanlarını ve kayıtlarını koru, uyanma, uyku, stres ve ruh halini aynı günün çalışmasıyla karşılaştır; güçlü ilişki için en az14 eşleşmiş gün ve her grupta5 gün gerekir. Süreleri saat ve dakika göster. TYT/AYT alt ders netlerini ayrı incele; Sosyal toplamı yüksekken Coğrafya sıfırsa o eksikliği belirt, eksik veriyi sıfır sayma. Anlatım tamamlanması ilk 0/1→2+ geçişidir. Tekrarlar analiz sırasında hizmet tarafından beş düşük öncelikli pekiştirme olarak kaydedilir: ilk pazar, ardından14 gün, sonra önceki tekrara1ay,2ay,3ay. Son üçü pazar olmak zorunda değildir. Geçmişte kalmış aşamaları geriye dönük görev yazma, mevcut gecikmiş görevi silme, yeniden analizde kopya oluşturma. Hiç oluşturulmamış göreve eklendi deme. Kullanıcının açık isteğiyle tam kimlik ve sürümü kullan." });

  server.registerTool("get_study_summary", {
    title: "Çalışma özeti",
    description: "Sahibin gerçek çalışma kayıtlarından günlük, haftalık, aylık veya yıllık toplam ve ortalamayı getirir. Günlük metnini paylaşmaz.",
    inputSchema: studySummaryInput,
    annotations: readAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ period }) => safely(async () => {
    const state = await getMcpOwnerState(client, userId);
    const today = localDate(Date.parse(state.server_now), state.settings?.timezone ?? "Europe/Istanbul");
    const report = buildStudyReport(state, studyReportRange(period, today));
    return {
      period, start: report.start, end: report.end,
      total_seconds: report.totalSeconds,
      average_worked_day_seconds: report.averageWorkedSeconds,
      worked_days: report.workedDays,
      goal_met_days: report.goalMetDays,
      subjects: report.subjects.slice(0, 20),
    };
  }));

  server.registerTool("list_tasks", {
    title: "Görevleri listele",
    description: "Sahibin görevlerini isteğe bağlı tarih ve tamamlanma durumuna göre listeler. Görev notlarını paylaşmaz.",
    inputSchema: listTasksInput,
    annotations: readAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ from_date, to_date, status, limit }) => safely(async () => {
    if (from_date && to_date && from_date > to_date) throw new ApiError(400, "INVALID_INPUT", "Bitiş tarihi başlangıçtan önce olamaz.");
    const state = await getMcpOwnerState(client, userId);
    const tasks = state.tasks
      .filter(task => (!from_date || task.plan_date >= from_date) && (!to_date || task.plan_date <= to_date))
      .filter(task => status === "all" || (status === "done" ? task.progress >= 1 : task.progress < 1))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(task => ({ id: task.id, title: task.title, plan_date: task.plan_date, exam: task.exam,
        subject: task.subject, progress: task.progress, planned_minutes: task.planned_minutes, priority: task.priority }));
    return { tasks, count: tasks.length };
  }));

  server.registerTool("list_topics", {
    title: "Konuları listele",
    description: "Sahibin ders konularını sınav ve derse göre listeler. Özel konu notlarını paylaşmaz.",
    inputSchema: listTopicsInput,
    annotations: readAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ exam, subject, limit }) => safely(async () => {
    const state = await getMcpOwnerState(client, userId);
    const topics = state.topics
      .filter(topic => (!exam || topic.exam === exam) && (!subject || topic.subject.toLocaleLowerCase("tr") === subject.toLocaleLowerCase("tr")))
      .sort((a, b) => a.exam.localeCompare(b.exam) || a.subject.localeCompare(b.subject, "tr") || a.name.localeCompare(b.name, "tr"))
      .slice(0, limit)
      .map(topic => ({ id: topic.id, exam: topic.exam, subject: topic.subject, name: topic.name,
        parent_id: topic.parent_id, mastery: topic.mastery, revision: topic.revision, review_requested: topic.review_requested }));
    return { topics, count: topics.length };
  }));

  server.registerTool("list_study_sessions", {
    title: "Çalışma kayıtlarını listele",
    description: "Sahibin tamamlanan sayaç oturumları ile tarih ve süre bildirimlerini sınırlı olarak listeler. Açık sayaçları ve günlük metnini paylaşmaz.",
    inputSchema: listStudySessionsInput,
    annotations: readAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ from_date, to_date, limit }) => safely(async () => {
    if (from_date && to_date && from_date > to_date) throw new ApiError(400, "INVALID_INPUT", "Bitiş tarihi başlangıçtan önce olamaz.");
    const state = await getMcpOwnerState(client, userId);
    const timezone = state.settings?.timezone ?? "Europe/Istanbul";
    const timerRecords = state.sessions.filter(session => session.status === "finished")
      .map(session => ({ kind: "timer" as const, id: session.id,
        study_date: localDate(Date.parse(session.started_at), timezone), subject: session.subject,
        duration_seconds: session.accumulated_seconds }));
    const manualRecords = (state.manual_study_entries ?? []).map(entry => ({ kind: "manual" as const,
      id: entry.id, study_date: entry.study_date, subject: entry.subject,
      duration_seconds: entry.duration_seconds }));
    const sessions = [...timerRecords, ...manualRecords]
      .filter(entry => (!from_date || entry.study_date >= from_date) && (!to_date || entry.study_date <= to_date))
      .sort((a, b) => b.study_date.localeCompare(a.study_date) || a.id.localeCompare(b.id))
      .slice(0, limit);
    return { sessions, count: sessions.length };
  }));
  server.registerTool("list_exams", {
    title: "Denemeleri listele",
    description: "Sahibin kaydettiği deneme sonuçlarını net, puan ve ders kırılımıyla listeler. Deneme notlarını paylaşmaz.",
    inputSchema: listExamsInput,
    annotations: readAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ limit }) => safely(async () => {
    const state = await getMcpOwnerState(client, userId);
    const exams = state.exams
      .sort((a, b) => b.exam_date.localeCompare(a.exam_date) || b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map(exam => ({ id: exam.id, name: exam.name, exam_date: exam.exam_date, format_code: exam.format_code,
        total_net: exam.total_net, score: exam.score, rank: exam.rank,
        results: exam.results.map(section => ({ section_key: section.section_key, correct: section.correct,
          wrong: section.wrong, blank: section.blank, net: section.net })) }));
    return { exams, count: exams.length };
  }));

  server.registerTool("create_task", {
    title: "Görev oluştur",
    description: "Sahibin hesabında bir çalışma görevi oluşturur. Aynı işlem tekrar denenirse aynı request_id UUID değerini kullan; farklı UUID yeni görev oluşturur.",
    inputSchema: createTaskInput,
    annotations: writeAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ request_id, title, plan_date, exam, subject, planned_minutes, priority }) => safely(async () => {
    const command = await executeMcpOwnerCommand(client, userId, {
      request_id, type: "task.create",
      payload: { title, plan_date, ...(exam ? { exam } : {}), ...(subject ? { subject } : {}),
        ...(planned_minutes === undefined ? {} : { planned_minutes }), ...(priority ? { priority } : {}) },
    });
    // executeCommand returns the whole application state; never put it on the MCP wire.
    return { id: command.id, request_id: command.request_id, replayed: command.replayed, title, plan_date, app_url: appUrl };
  }));

  server.registerTool("create_study_session", {
    title: "Çalışma süresi kaydet",
    description: "Kullanıcı tarih, ders ve net süreyi açıkça doğruladıysa tarihli bir çalışma süresi kaydeder. Sayaç başlangıç/bitiş saati uydurmaz. Aynı kayıt tekrar denenirse aynı request_id UUID değerini kullan; farklı UUID yeni kayıt oluşturur.",
    inputSchema: createStudySessionInput,
    annotations: writeAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ request_id, confirmed_by_user, study_date, subject, minutes }) => safely(async () => {
    if (!confirmed_by_user) throw new ApiError(400, "CONFIRMATION_REQUIRED", "Kaydetmeden önce kullanıcı onayı gerekli.");
    const command = await executeMcpOwnerCommand(client, userId, { request_id, type: "manual_study.create",
      payload: { confirmed_by_user, study_date, subject, minutes } });
    return { id: command.id, request_id: command.request_id,
      status: command.replayed ? "already_saved" : "saved", replayed: command.replayed,
      study_date, subject, duration_seconds: minutes * 60, app_url: appUrl };
  }));

  server.registerTool("create_exam", {
    title: "Deneme sonucu kaydet",
    description: "Kullanıcı deneme sonucunu gözden geçirip açıkça kaydetmeyi onayladıysa yapılandırılmış sayısal sonuçları kaydeder. PDF, dosya yolu veya URL kabul etmez. Aynı kayıt tekrar denenirse aynı request_id UUID değerini kullan; farklı UUID yeni kayıt oluşturur.",
    inputSchema: createExamInput,
    annotations: writeAnnotations,
    _meta: authenticatedToolMeta,
  }, async ({ request_id, confirmed_by_user, ...fields }) => safely(async () => {
    if (!confirmed_by_user) throw new ApiError(400, "CONFIRMATION_REQUIRED", "Kaydetmeden önce kullanıcı onayı gerekli.");
    const command = await executeMcpOwnerCommand(client, userId, { request_id, type: "exam.create", payload: fields });
    // The command response includes private application state, which must not leave this tool.
    return { id: command.id, request_id: command.request_id,
      status: command.replayed ? "already_saved" : "saved", replayed: command.replayed, app_url: appUrl };
  }));
  registerTopicStatusTool(server, client, userId, appUrl);
  registerAnalysisSourcesTool(server, () => getMcpOwnerState(client, userId),()=>loadCoachingContext(client,userId));
  return server;
}


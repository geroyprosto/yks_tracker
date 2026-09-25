import type { ImportCandidate, ImportResultSuggestion } from "./types";

type Cell = { text: string; x: number; y: number };
type Summary = { questions: number; correct: number; wrong: number; net: number; y: number };

const normalize = (value: string) => value.normalize("NFKC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const fold = (value: string) => normalize(value).toLocaleLowerCase("tr-TR")
  .replaceAll("ı", "i").replaceAll("ğ", "g").replaceAll("ü", "u")
  .replaceAll("ş", "s").replaceAll("ö", "o").replaceAll("ç", "c");
const number = (value: string): number | null => {
  const cleaned = value.replace(",", ".");
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
};
const cells = (items: unknown[]): Cell[] => items.flatMap((item) => {
  if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return [];
  const typed = item as { str: unknown; transform: unknown };
  if (typeof typed.str !== "string" || !Array.isArray(typed.transform)) return [];
  const x = Number(typed.transform[4]);
  const y = Number(typed.transform[5]);
  const text = normalize(typed.str);
  return text && Number.isFinite(x) && Number.isFinite(y) ? [{ text, x, y }] : [];
});

const subjects = [
  { label: "Türkçe", key: "turkce", capacity: 40 },
  { label: "Tarih-1", key: "tarih", capacity: 5 },
  { label: "Coğrafya-1", key: "cografya", capacity: 5 },
  { label: "Felsefe", key: "felsefe", capacity: 5 },
  { label: "Din Kül. ve Ahl. Bil.", key: "din", capacity: 5 },
  { label: "TYT Matematik", key: "matematik", capacity: 40 },
  { label: "Fizik", key: "fizik", capacity: 7 },
  { label: "Kimya", key: "kimya", capacity: 7 },
  { label: "Biyoloji", key: "biyoloji", capacity: 6 },
] as const;

function nearNumber(row: Cell[], x: number): number | null {
  const cell = row.filter((entry) => Math.abs(entry.x - x) < 11)
    .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  return cell ? number(cell.text) : null;
}

// "Sonuç Belgesi" prints one student's summary at the left and a dense learning-
// outcome analysis at the right. Only the four numeric summary columns are read.
export function parseKarneTytPage(items: unknown[], page: number): ImportCandidate | null {
  const all = cells(items);
  if (!all.some((cell) => fold(cell.text) === "sonuc belgesi") ||
      !all.some((cell) => fold(cell.text) === "derslere gore analiz")) return null;
  const heading = all.find((cell) => fold(cell.text) === "ders" && cell.x < 90);
  if (!heading) return null;
  const scoreRow = all.find((cell) => cell.x < 55 && cell.y > heading.y && fold(cell.text) === "tyt");
  if (!scoreRow) return null;
  const header = ["soru", "dogru", "yanlis", "net"].map((label) =>
    all.find((cell) => fold(cell.text) === label && cell.x < 190 && Math.abs(cell.y - heading.y) < 4));
  if (header.some((cell) => !cell) || header.some((cell, index) => index > 0 && cell!.x <= header[index - 1]!.x)) return null;
  const headers = header.map((cell) => cell!.x);
  const summaryLabels = all.filter((cell) => cell.x < 95 && cell.y < heading.y && cell.y > heading.y - 260);
  const findRow = (label: string): Cell[] | null => {
    const anchor = summaryLabels.find((cell) => fold(cell.text) === fold(label));
    return anchor ? all.filter((cell) => cell.x > 95 && cell.x < 195 && Math.abs(cell.y - anchor.y) < 1.5) : null;
  };
  const parseSummary = (label: string): Summary | null => {
    const row = findRow(label);
    if (!row) return null;
    const [questions, correct, wrong, net] = headers.map((x) => nearNumber(row, x));
    if (questions === null || correct === null || wrong === null || net === null ||
        !Number.isInteger(questions) || !Number.isInteger(correct) || !Number.isInteger(wrong) ||
        questions < 0 || correct < 0 || wrong < 0 || correct + wrong > questions) return null;
    return { questions, correct, wrong, net, y: row[0].y };
  };

  const warnings = ["Sınav tarihi sonuç belgesinde açıkça yazmıyor; kaydetmeden önce tarihi seç."];
  const results: ImportResultSuggestion[] = [];
  const parsed = new Map<string, Summary>();
  for (const subject of subjects) {
    const row = parseSummary(subject.label);
    if (!row || row.questions !== subject.capacity) {
      warnings.push(`${subject.label} sonuçları güvenle okunamadı; belgeyle karşılaştır.`);
      continue;
    }
    parsed.set(subject.key, row);
    const uncertain = Math.abs(row.correct - row.wrong / 4 - row.net) > 0.011;
    if (uncertain) warnings.push(`${subject.label} neti doğru/yanlış hesabıyla uyuşmuyor.`);
    results.push({ section_key: subject.key, correct: row.correct, wrong: row.wrong,
      blank: row.questions - row.correct - row.wrong, source_page: page,
      raw: `${subject.label}: S ${row.questions}, D ${row.correct}, Y ${row.wrong}, Net ${row.net}`,
      uncertain });
  }

  const optional = parseSummary("Felsefe (Seçmeli)");
  const optionalUsed = Boolean(optional && (optional.correct || optional.wrong || optional.net));
  if (optionalUsed) warnings.push("Seçmeli Felsefe sonucu var; TYT şablonunda ayrı alan olmadığı için toplamı belgeyle karşılaştır.");
  const checks: Array<[string, number, string[]]> = [
    ["TYT Sosyal", 20, ["tarih", "cografya", "felsefe", "din"]],
    ["TYT Matematik", 40, ["matematik"]],
    ["TYT Fen", 20, ["fizik", "kimya", "biyoloji"]],
  ];
  for (const [label, capacity, keys] of checks) {
    const row = parseSummary(label);
    if (!row || row.questions !== capacity || Math.abs(row.correct - row.wrong / 4 - row.net) > 0.011) {
      warnings.push(`${label} ara toplamı güvenle okunamadı; belgeyle karşılaştır.`);
      continue;
    }
    if (keys.every((key) => parsed.has(key)) &&
        (keys.reduce((sum, key) => sum + parsed.get(key)!.correct, 0) !== row.correct ||
         keys.reduce((sum, key) => sum + parsed.get(key)!.wrong, 0) !== row.wrong)) {
      if (!(label === "TYT Sosyal" && optionalUsed))
        warnings.push(`${label} ara toplamı ders sonuçlarıyla uyuşmuyor.`);
    }
  }
  const mathOne = parseSummary("Matematik-1");
  const geometry = parseSummary("Geometri");
  const math = parsed.get("matematik");
  if (mathOne && geometry && math && (mathOne.questions !== 30 || geometry.questions !== 10 ||
      mathOne.correct + geometry.correct !== math.correct || mathOne.wrong + geometry.wrong !== math.wrong))
    warnings.push("Matematik-1 ve Geometri toplamı TYT Matematik ile uyuşmuyor.");

  const total = parseSummary("Toplam:");
  const validTotal = total !== null && total.questions === 120 && total.net >= -30 && total.net <= 120;
  let totalUncertain = !validTotal || Boolean(total && Math.abs(total.correct - total.wrong / 4 - total.net) > 0.011);
  if (validTotal && results.length === 9 && !optionalUsed) {
    if (results.reduce((sum, result) => sum + (result.correct ?? 0), 0) !== total.correct ||
        results.reduce((sum, result) => sum + (result.wrong ?? 0), 0) !== total.wrong) {
      totalUncertain = true;
      warnings.push("Ders sonuçları rapordaki genel toplamla uyuşmuyor.");
    }
  }
  if (optionalUsed) totalUncertain = true;
  if (!validTotal) warnings.push("Genel net güvenle okunamadı; belgeyle karşılaştır.");
  else if (totalUncertain) warnings.push("Genel net veya ders toplamları elle doğrulanmalı.");


  const scoreCells = all.filter((cell) => Math.abs(cell.y - scoreRow.y) < 1.5);
  const scoreCell = scoreCells.find((cell) => cell.x > 55 && cell.x < 115 && number(cell.text) !== null);
  const rankCell = scoreCells.find((cell) => cell.x > 255 && cell.x < 300 && number(cell.text) !== null);
  const scoreValue = scoreCell ? number(scoreCell.text) : null;
  const rankValue = rankCell ? number(rankCell.text) : null;
  const title = all.find((cell) => cell.x > 295 && cell.y > heading.y && /\btyt\b/.test(fold(cell.text)) && /deneme/.test(fold(cell.text)))?.text;
  const name = title?.slice(0, 240) ?? "TYT denemesi";
  const publisher = title?.replace(/\s*TYT\s*$/i, "").trim().slice(0, 120) || null;
  return { index: 0, label: `TYT${validTotal ? ` · ${total.net} net` : " · manuel inceleme"}`,
    student_label: null, format_code: "TYT", exam_date: null, name, publisher,
    score: scoreValue !== null && scoreValue >= 0 && scoreValue <= 1000 ? scoreValue : null,
    rank: rankValue !== null && Number.isInteger(rankValue) && rankValue > 0 ? rankValue : null,
    results, reported_total_net: validTotal ? total.net : null,
    reported_total_source: validTotal ? { source_page: page,
      raw: `Toplam: S ${total.questions}, D ${total.correct}, Y ${total.wrong}, Net ${total.net}`,
      uncertain: totalUncertain } : null,
    source_pages: [page], warnings };
}

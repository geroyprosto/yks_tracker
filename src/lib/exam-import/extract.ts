import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExamFormatCode } from "../domain/types";
import type { ImportCandidate, ImportResultSuggestion } from "./types";
import {parseTabularTytPage} from "./tabular";
import {parseKarneTytPage} from "./karne";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;

export class PdfImportError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function validatePdfUpload(bytes: Uint8Array, mime: string, filename: string): void {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfImportError(413, "PDF_TOO_LARGE", "PDF en fazla 10 MB olabilir.");
  if (bytes.byteLength < 16 || !new TextDecoder("ascii").decode(bytes.subarray(0, 5)).startsWith("%PDF-"))
    throw new PdfImportError(400, "INVALID_PDF", "Geçerli bir PDF dosyası seçin.");
  if (mime && mime !== "application/pdf" && mime !== "application/octet-stream")
    throw new PdfImportError(400, "INVALID_PDF", "Dosya türü PDF olmalı.");
  if (!filename.toLowerCase().endsWith(".pdf"))
    throw new PdfImportError(400, "INVALID_PDF", "Dosya adının .pdf uzantısı olmalı.");
}

type TextLine = { text: string; page: number };
type Extracted = { page_count: number; extraction_status: "ready" | "needs_visual_review"; candidates: ImportCandidate[]; vision_pages: number[] };
const normalized = (value: string) => value.normalize("NFKC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const fold = (value: string) => normalized(value).toLocaleLowerCase("tr-TR")
  .replaceAll("ı", "i").replaceAll("ğ", "g").replaceAll("ü", "u")
  .replaceAll("ş", "s").replaceAll("ö", "o").replaceAll("ç", "c");
const parseNumber = (value: string): number | null => {
  const cleaned = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
};
const isoDate = (value: string): string | null => {
  const match = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b|\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[3] ?? match[4]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[1] ?? match[6]);
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
    ? [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-") : null;
};
const subjectKeys: Array<[RegExp, string]> = [
  [/^(?:(?:tyt|ayt)\s+)?t[uü]rk[cç]e\b/i, "turkce"],
  [/^(?:(?:tyt|ayt)\s+)?tarih\b/i, "tarih"],
  [/^(?:(?:tyt|ayt)\s+)?co[gğ]rafya\b/i, "cografya"],
  [/^(?:(?:tyt|ayt)\s+)?felsefe\b/i, "felsefe"],
  [/^(?:(?:tyt|ayt)\s+)?din(?:\s+k[uü]lt[uü]r[uü])?\b/i, "din"],
  [/^(?:(?:tyt|ayt)\s+)?(?:temel\s+)?matematik\b/i, "matematik"],
  [/^(?:(?:tyt|ayt)\s+)?fizik\b/i, "fizik"],
  [/^(?:(?:tyt|ayt)\s+)?kimya\b/i, "kimya"],
  [/^(?:(?:tyt|ayt)\s+)?biyoloji\b/i, "biyoloji"],
  [/^sosyal\s+bilimler\b/i, "sosyal"],
  [/^fen\s+bilimleri\b/i, "fen"],
];
const capacities: Record<string, number> = {
  turkce: 40, tarih: 5, cografya: 5, felsefe: 5, din: 5,
  matematik: 40, fizik: 14, kimya: 13, biyoloji: 13, sosyal: 20, fen: 40,
};

function formatMentions(lines: TextLine[]): Set<ExamFormatCode> {
  const mentions = new Set<ExamFormatCode>();
  for (const line of lines) {
    const text=fold(line.text);
    if (/\bayt\b/.test(text)) mentions.add("AYT_SAYISAL");
    if (/\btyt\b/.test(text)) mentions.add("TYT");
    if (/\bbrans\b/.test(text)) mentions.add("BRANCH");
  }
  return mentions;
}
function inferFormat(lines: TextLine[]): ExamFormatCode | null {
  const headings=lines.filter(line=>maybeHeading(line.text));
  const mentions=formatMentions(headings.length?headings:lines);
  return mentions.size===1 ? [...mentions][0] : null;
}
function parseOverallNet(line: TextLine): {value:number;source_page:number;raw:string;uncertain:boolean} | null {
  const raw=normalized(line.text);
  const folded=fold(raw);
  const match=folded.match(/^(?:(?:tyt|ayt(?:\s+sayisal)?)\s+)?(?:toplam\s+)?net\s*[:：-]?\s*(-?\d+(?:[.,]\d+)?)$/)
    ?? folded.match(/^toplam\s+net\s*[:：-]?\s*(-?\d+(?:[.,]\d+)?)$/);
  if(!match)return null;
  const value=parseNumber(match[1]);
  return value===null?null:{value,source_page:line.page,raw,uncertain:false};
}
function maybeStudent(line: string): string | null {
  const match = line.match(/^(?:ad[ıi]\s*soyad[ıi]|[oö]grenci(?:\s+ad[ıi])?)\s*[:：-]\s*(.+)$/i);
  return match ? normalized(match[1]).slice(0, 120) : null;
}
function maybeHeading(line: string): boolean {
  const text = fold(line);
  return /\b(?:tyt|ayt|brans)\b/.test(text) && /\b(?:deneme|sinav|sonuc)\b/.test(text);
}
function inferPublisher(lines: TextLine[]): string | null {
  const match = lines.map(line => line.text).find(line => /^(?:yay[ıi]n|yay[ıi]nevi)\s*[:：-]/i.test(line));
  return match ? normalized(match.replace(/^[^:：-]+[:：-]/, "")).slice(0, 240) : null;
}
function inferName(lines: TextLine[], format: ExamFormatCode | null): string | null {
  const title = lines.map(line => line.text).find(maybeHeading);
  if (title) return normalized(title).slice(0, 240);
  return format === "TYT" ? "TYT denemesi" : format === "AYT_SAYISAL" ? "AYT Sayısal denemesi" : null;
}
function parseResult(line: TextLine, format: ExamFormatCode | null): ImportResultSuggestion | null {
  const text = normalized(line.text);
  const match = subjectKeys.find(([pattern]) => pattern.test(text));
  if (!match) return null;
  const section_key = match[1];
  if (section_key === "sosyal" || section_key === "fen") return null;
  const rest = text.replace(match[0], "").trim();
  const numbers = rest.match(/-?\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.length === 0) return null;
  const values = numbers.map(parseNumber);
  if (values.some(value => value === null)) return null;
  const countCapacity = format === "TYT" ? (section_key === "fizik" ? 7 : section_key === "kimya" ? 7 : section_key === "biyoloji" ? 6 : capacities[section_key])
    : capacities[section_key];
  if (numbers.length >= 3 && values.slice(0, 3).every(value => Number.isInteger(value) && value! >= 0)) {
    const [correct, wrong, blank] = values as number[];
    const expectedNet = correct - wrong / 4;
    const printedNet = numbers.length >= 4 ? values[3]! : null;
    const uncertain = correct + wrong + blank > countCapacity
      || printedNet !== null && Math.abs(expectedNet - printedNet) > 0.01;
    return {section_key, correct, wrong, blank, source_page: line.page, raw: text, uncertain};
  }
  if (numbers.length === 1) {
    return {section_key, net: values[0]!, source_page: line.page, raw: text,
      uncertain: values[0]! < -countCapacity / 4 || values[0]! > countCapacity};
  }
  return {section_key, source_page: line.page, raw: text, uncertain: true};
}
function splitSegments(lines: TextLine[]): TextLine[][] {
  const segments: TextLine[][] = [];
  let current: TextLine[] = [];
  let hasResults = false;
  for (const line of lines) {
    const boundary = maybeStudent(line.text) !== null || maybeHeading(line.text);
    if (boundary && current.length && hasResults) {
      segments.push(current); current = []; hasResults = false;
    }
    current.push(line);
    if (parseResult(line, null) || parseOverallNet(line)) hasResults = true;
  }
  if (current.length) segments.push(current);
  return segments;
}
function buildCandidate(lines: TextLine[], index: number): ImportCandidate {
  const format_code = inferFormat(lines);
  const seen = new Set<string>();
  const results: ImportResultSuggestion[] = [];
  const warnings: string[] = [];
  for (const line of lines) {
    const result = parseResult(line, format_code);
    if (!result) continue;
    if (seen.has(result.section_key)) {
      warnings.push("Aynı ders birden fazla kez görünüyor; sonucu elle doğrulayın.");
      continue;
    }
    seen.add(result.section_key); results.push(result);
    if (result.uncertain) warnings.push(result.section_key + " satırındaki sayılar doğrulanmalı.");
  }
  const mentions=formatMentions(lines.filter(line=>maybeHeading(line.text)));
  if (mentions.size>1) warnings.push("Aynı bölümde TYT ve AYT başlıkları görüldü; sınav türünü seçin.");
  if (!format_code) warnings.push("Sınav türü güvenle belirlenemedi.");
  if (!results.length) warnings.push("Ders sonuçları okunamadı; PDF'yi görerek alanları elle doldurun.");
  const totalSuggestions=lines.map(parseOverallNet).filter((item):item is NonNullable<typeof item>=>item!==null);
  const reported_total_source=totalSuggestions[0]??null;
  let reported_total_net: number | null = reported_total_source?.value??null;
  if (totalSuggestions.length>1 && totalSuggestions.some(item=>item.value!==reported_total_net)) {
    warnings.push("Birden fazla farklı toplam net bulundu; sonucu elle doğrulayın.");
    reported_total_net=null;
  }
  const totalQuestions=format_code==="TYT"?120:format_code==="AYT_SAYISAL"?80:null;
  if(reported_total_source && totalQuestions!==null &&
     (reported_total_source.value < -totalQuestions/4 || reported_total_source.value>totalQuestions)) {
    reported_total_source.uncertain=true;
    warnings.push("Toplam net soru sınırlarının dışında; elle doğrulayın.");
  }
  const student_label = lines.map(line => maybeStudent(line.text)).find(Boolean) ?? null;
  const date = lines.map(line => isoDate(line.text)).find(Boolean) ?? null;
  return {
    index, label: student_label ? student_label + " · " + (format_code ?? "Deneme") :
      (format_code ?? "Manuel inceleme") + " · " + (lines[0]?.page ?? 1) + ". sayfa",
    student_label, format_code, exam_date: date, name: inferName(lines, format_code),
    publisher: inferPublisher(lines), results,reported_total_net,reported_total_source,
    source_pages: [...new Set(lines.map(line => line.page))], warnings,
  };
}
function joinItems(items: unknown[], page: number): TextLine[] {
  const rows = new Map<number, Array<{x:number; text:string}>>();
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) continue;
    const typed = item as {str: string; transform: number[]};
    if (typeof typed.str !== "string" || !Array.isArray(typed.transform)) continue;
    const x = Number(typed.transform[4] ?? 0);
    const y = Math.round(Number(typed.transform[5] ?? 0) * 2) / 2;
    const bucket = rows.get(y) ?? [];
    bucket.push({x,text:typed.str});
    rows.set(y,bucket);
  }
  return [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,parts])=>({
    text:normalized(parts.sort((a,b)=>a.x-b.x).map(part=>part.text).join(" ")),page,
  })).filter(row=>row.text.length>0);
}

export async function extractPdfDraft(bytes: Uint8Array): Promise<Extracted> {
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    task = getDocument({data: bytes.slice(), useSystemFonts: true,
      stopAtErrors: true, maxImageSize: 12_000_000});
    const document = await task.promise;
    if (document.numPages < 1) throw new PdfImportError(400,"INVALID_PDF","PDF'de sayfa bulunamadı.");
    if (document.numPages > MAX_PDF_PAGES)
      throw new PdfImportError(422,"PDF_TOO_MANY_PAGES","PDF en fazla 10 sayfa olabilir.");
    const pageLines: TextLine[][] = [];
    const tabularCandidates: ImportCandidate[] = [];
    const tabularPages = new Set<number>();
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const text = await page.getTextContent();
      const table = parseTabularTytPage(text.items as unknown[], number);
      if (table.length) {
        tabularPages.add(number);
        tabularCandidates.push(...table);
        pageLines.push([]);
      } else {
        const karne = parseKarneTytPage(text.items as unknown[], number);
        if (karne) {
          tabularPages.add(number);
          tabularCandidates.push(karne);
          pageLines.push([]);
        } else pageLines.push(joinItems(text.items as unknown[], number));
      }
      page.cleanup();
    }
    const vision_pages=pageLines.flatMap((rows,index)=>{
      if(tabularPages.has(index+1))return [];
      const text=rows.map(row=>row.text).join(" ");
      const hasParsed=rows.some(row=>{
        const result=parseResult(row,null);
        return (result && (result.net!==undefined || result.correct!==undefined))
          || parseOverallNet(row)!==null;
      });
      const likelyResults=/tyt|ayt|deneme|sınav|sinav|doğru|dogru|yanlış|yanlis|net/i.test(text);
      return !hasParsed && (text.length<120 || likelyResults) ? [index+1] : [];
    });
    const lines = pageLines.flat();
    const segments = splitSegments(lines);
    const candidates = [...tabularCandidates,...segments.map((segment,index)=>buildCandidate(segment,index))]
      .filter(candidate=>candidate.results.length>0 || candidate.reported_total_net!==null || candidate.format_code !== null || candidate.student_label !== null)
      .slice(0,50).map((candidate,index)=>({...candidate,index}));
    if (!candidates.length) {
      candidates.push({
        index:0,label:"Manuel inceleme",student_label:null,format_code:null,
        exam_date:null,name:null,publisher:null,results:[],reported_total_net:null,reported_total_source:null,source_pages:Array.from({length:document.numPages},(_,index)=>index+1),
        warnings:["Metin katmanından sonuç okunamadı; görsel okuma veya elle inceleme gerekiyor."],
      });
    }
    return {page_count:document.numPages,
      extraction_status:candidates.some(candidate=>candidate.results.length>0 || candidate.reported_total_net!==null) ? "ready" : "needs_visual_review",
      candidates,vision_pages};
  } catch (error) {
    if (error instanceof PdfImportError) throw error;
    throw new PdfImportError(400,"INVALID_PDF","PDF okunamadı veya bozuk.");
  } finally {
    await task?.destroy();
  }
}

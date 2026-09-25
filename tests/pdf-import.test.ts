import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPdfDraft, PdfImportError, validatePdfUpload } from "../src/lib/exam-import/extract";
import { boundedMultipartForm, MAX_MULTIPART_BYTES, visualConsent } from "../src/app/api/exam-import/upload/route";
import { ApiError } from "../src/lib/server/http";
import { extractVisualCandidates, renderRelevantPages } from "../src/lib/exam-import/visual";

function syntheticPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageRefs: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  for (const lines of pages) {
    const pageId = objects.length + 1;
    const streamId = pageId + 1;
    pageRefs.push(pageId + " 0 R");
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 " + (2 + pages.length * 2 + 1) + " 0 R >> >> /Contents " + streamId + " 0 R >>");
    const escaped = lines.map(line=>line.replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)"));
    const body = "BT /F1 12 Tf 50 740 Td " + escaped.map((line,index)=>(index ? "0 -22 Td " : "") + "(" + line + ") Tj ").join("") + "ET";
    objects.push("<< /Length " + Buffer.byteLength(body) + " >>\nstream\n" + body + "\nendstream");
  }
  objects[1] = "<< /Type /Pages /Kids [" + pageRefs.join(" ") + "] /Count " + pages.length + " >>";
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index,object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  }
  const xrefOffset = Buffer.byteLength(result);
  result += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) result += String(offset).padStart(10,"0") + " 00000 n \n";
  result += "trailer << /Root 1 0 R /Size " + (objects.length + 1) + " >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return new TextEncoder().encode(result);
}

test("PDF import extracts candidates from actual text pages and keeps them separate",async()=>{
  const bytes=syntheticPdf([
    ["TYT Deneme Sonucu","Ad Soyad: Sumeyra","24.09.2026","Matematik 10 4 26 9","Fizik 0 7 0 -1,75"],
    ["AYT Deneme Sonucu","Ad Soyad: Baska Ogrenci","23.09.2026","Matematik 20 8 12 18","Kimya 5 4 4 4"],
  ]);
  validatePdfUpload(bytes,"application/pdf","sonuc.pdf");
  const extracted=await extractPdfDraft(bytes);
  assert.equal(extracted.page_count,2);
  assert.equal(extracted.extraction_status,"ready");
  assert.equal(extracted.candidates.length,2);
  assert.equal(extracted.candidates[0].format_code,"TYT");
  assert.equal(extracted.candidates[0].exam_date,"2026-09-24");
  assert.equal(extracted.candidates[0].results.find(r=>r.section_key==="matematik")?.correct,10);
  assert.equal(extracted.candidates[0].results.find(r=>r.section_key==="fizik")?.wrong,7);
  assert.equal(extracted.candidates[1].format_code,"AYT_SAYISAL");
  assert.equal(extracted.candidates[1].results.find(r=>r.section_key==="kimya")?.net,undefined);
});

test("image-only PDFs have a manual review candidate and invalid uploads are rejected",async()=>{
  const bytes=syntheticPdf([[]]);
  const extracted=await extractPdfDraft(bytes);
  assert.equal(extracted.extraction_status,"needs_visual_review");
  assert.equal(extracted.candidates.length,1);
  assert.equal(extracted.candidates[0].results.length,0);
  assert.equal(extracted.candidates[0].label,"Manuel inceleme");
  assert.throws(()=>validatePdfUpload(new Uint8Array([1,2,3]),"application/pdf","x.pdf"),PdfImportError);
  assert.throws(()=>validatePdfUpload(bytes,"image/png","x.pdf"),PdfImportError);
  assert.throws(()=>validatePdfUpload(bytes,"application/pdf","x.png"),PdfImportError);
  assert.throws(()=>validatePdfUpload(new Uint8Array(10*1024*1024+1),"application/pdf","x.pdf"),
    (error:unknown)=>error instanceof PdfImportError&&error.code==="PDF_TOO_LARGE");
});

test("PDF import reads only explicit overall net labels and flags mixed exam titles",async()=>{
 const onlyTotal=await extractPdfDraft(syntheticPdf([["TYT Deneme Sonucu","Toplam Net: 72,25"]]));
 assert.equal(onlyTotal.extraction_status,"ready");
 assert.equal(onlyTotal.candidates[0].reported_total_net,72.25);
 assert.equal(onlyTotal.candidates[0].reported_total_source?.source_page,1);
 assert.equal(onlyTotal.candidates[0].results.length,0);
 const mixed=await extractPdfDraft(syntheticPdf([["TYT Deneme Sonucu","AYT Deneme Sonucu","Toplam Net 30"]]));
 assert.equal(mixed.candidates[0].format_code,null);
 assert.ok(mixed.candidates[0].warnings.some(warning=>warning.includes("TYT ve AYT")));
});

test("multipart PDF upload is bounded before form parsing even without Content-Length",async()=>{
  const tooLarge=new Request("http://localhost/upload",{
    method:"POST",
    headers:{"content-type":"multipart/form-data; boundary=abc"},
    body:new Uint8Array(MAX_MULTIPART_BYTES+1),
  });
  assert.equal(tooLarge.headers.get("content-length"),null);
  await assert.rejects(boundedMultipartForm(tooLarge),
    (error:unknown)=>error instanceof ApiError && error.code==="PDF_TOO_LARGE");
  const form=new FormData();
  form.set("file",new File(["%PDF-1.4 synthetic test"],"exam.pdf",{type:"application/pdf"}));
  const accepted=await boundedMultipartForm(new Request("http://localhost/upload",{method:"POST",body:form}));
  assert.ok(accepted.get("file") instanceof File);
});
test("multiple total-only exams remain separate and AYT-prefixed subjects parse",async()=>{
  const extracted=await extractPdfDraft(syntheticPdf([
    ["TYT Deneme Sonucu","Toplam Net: 62,5"],
    ["AYT Deneme Sonucu","AYT Matematik 20 8 12 18","AYT Net: 43,25"],
  ]));
  assert.equal(extracted.candidates.length,2);
  assert.equal(extracted.candidates[0].reported_total_net,62.5);
  assert.equal(extracted.candidates[1].format_code,"AYT_SAYISAL");
  assert.equal(extracted.candidates[1].reported_total_net,43.25);
  assert.equal(extracted.candidates[1].results[0].section_key,"matematik");
});
test("external OCR needs explicit upload consent and keeps manual review as default",()=>{
  const form=new FormData();
  assert.equal(visualConsent(form),false);
  form.set("allow_visual_extraction","true");
  assert.equal(visualConsent(form),true);
  form.set("allow_visual_extraction","false");
  assert.equal(visualConsent(form),false);
  form.set("allow_visual_extraction","yes");
  assert.throws(()=>visualConsent(form),(error:unknown)=>
    error instanceof ApiError && error.code==="INVALID_INPUT");
});
test("approved OCR sends only selected rendered pages and validates uncertain review candidates",async()=>{
  const bytes=syntheticPdf([[],[]]);
  let calls=0;
  const providerResult={candidates:[
    {label:"Öğrenci A · TYT",student_label:"Öğrenci A",format_code:"TYT",
      exam_date:"2026-09-24",name:"TYT Deneme",publisher:null,
      reported_total_net:72.25,reported_total_raw:"Toplam Net 72,25",
      results:[
        {section_key:"matematik",correct:10,wrong:4,blank:null,net:9,raw:"Matematik 10 4 9 net"},
        {section_key:"fizik",correct:0,wrong:7,blank:0,net:-1.75,raw:"Fizik 0 7 0 -1,75"},
      ]},
    {label:"Öğrenci B · TYT",student_label:"Öğrenci B",format_code:"TYT",
      exam_date:null,name:"TYT Deneme",publisher:null,reported_total_net:null,
      reported_total_raw:null,results:[]},
  ]};
  const fetcher:typeof fetch=async(url,init)=>{
    calls++;
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const request=JSON.parse(String(init?.body));
    assert.equal(request.store,false);
    assert.equal(request.model,"gpt-4o-mini");
    assert.equal(request.input[1].content[1].image_url,"data:image/jpeg;base64,dGVzdA==");
    assert.equal(request.input[1].content[0].text.includes("(2)"),true);
    assert.equal(request.text.format.strict,true);
    return new Response(JSON.stringify({output:[{content:[
      {type:"output_text",text:JSON.stringify(providerResult)},
    ]}]}),{status:200});
  };
  const outcome=await extractVisualCandidates(bytes,[2],{
    apiKey:"test-only-key",model:"gpt-4o-mini",fetcher,
    renderer:async(_pdf,pages)=>{
      assert.deepEqual(pages,[2]);
      return [{page:2,image_data_url:"data:image/jpeg;base64,dGVzdA=="}];
    },
  });
  assert.equal(calls,1);
  assert.equal(outcome.status,"succeeded");
  assert.equal(outcome.candidates.length,2);
  assert.equal(outcome.candidates[0].reported_total_net,72.25);
  assert.equal(outcome.candidates[0].reported_total_source?.source_page,2);
  assert.equal(outcome.candidates[0].reported_total_source?.uncertain,true);
  assert.deepEqual(outcome.candidates[0].source_pages,[2]);
  assert.equal(outcome.candidates[0].results[0].net,9);
  assert.equal(outcome.candidates[0].results[0].blank,undefined);
  assert.equal(outcome.candidates[0].results[0].uncertain,true);
  assert.equal(outcome.candidates[0].results[1].wrong,7);
});
test("OCR failures and missing provider preserve manual review; local rendering stays on selected pages",async()=>{
  const bytes=syntheticPdf([[],[]]);
  const noProvider=await extractVisualCandidates(bytes,[1],{
    apiKey:"",model:"",renderer:async()=>{throw new Error("should not render");},
  });
  assert.equal(noProvider.status,"provider_not_configured");
  assert.equal(noProvider.candidates.length,0);
  const failed=await extractVisualCandidates(bytes,[1],{
    apiKey:"test-only-key",model:"gpt-4o-mini",
    renderer:async()=>[{page:1,image_data_url:"data:image/jpeg;base64,dGVzdA=="}],
    fetcher:async()=>new Response("{bad",{status:200}),
  });
  assert.equal(failed.status,"failed");
  assert.equal(failed.candidates.length,0);
  assert.ok(failed.warnings[0].includes("1. sayfa"));
  const rendered=await renderRelevantPages(bytes,[2]);
  assert.equal(rendered.length,1);
  assert.equal(rendered[0].page,2);
  assert.ok(rendered[0].image_data_url.startsWith("data:image/jpeg;base64,"));
});
test("wide TYT class reports separate students and prefill all nine subjects without OCR",async()=>{
 const {parseTabularTytPage}=await import('../src/lib/exam-import/tabular');
 const item=(str:string,x:number,y:number)=>({str,transform:[1,0,0,1,x,y]});
 const groupLabels=['TÜRKÇE','TARİH','COĞRAFYA','FELSEFE','DİN','S.FELSEFE','MATEMATİK','FİZİK','KİMYA','BİYOLOJİ','Toplamlar'];
 const items:ReturnType<typeof item>[]=[item('GENEL SONUÇ RAPORU',350,570),item('ÖZDEBİR - TYT İLK PROVA - 1 TYT',330,543),item('Tyt',728,511),item('Genel',816,511)];
 const markers:number[]=[];
 groupLabels.forEach((label,index)=>{
   const start=189+index*48;
   items.push(item(label,start+6,525));
   ['D','Y','Net'].forEach((heading,slot)=>{const x=start+slot*14;markers.push(x);items.push(item(heading,x,511))});
 });
 const studentRows=[
  {label:'Öğrenci A',y:498,triples:[[30,4,29],[4,0,4],[3,1,2.75],[2,1,1.75],[5,0,5],[0,0,0],[15,5,13.75],[4,1,3.75],[3,0,3],[2,1,1.75],[68,13,64.75]],score:300.1,rank:1234},
  {label:'Öğrenci B',y:484.5,triples:[[20,8,18],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[10,4,9],[0,0,0],[0,0,0],[0,0,0],[30,12,27]],score:200,rank:5678},
 ];
 for(const row of studentRows){
   items.push(item(row.label,7.5,row.y));
   row.triples.flat().forEach((value,index)=>items.push(item(String(value),markers[index]-1,row.y)));
   items.push(item(String(row.score),724,row.y),item(String(row.rank),818,row.y));
 }
 const candidates=parseTabularTytPage(items,1);
 assert.equal(candidates.length,2);
 assert.deepEqual(candidates.map(candidate=>candidate.student_label),['Öğrenci A','Öğrenci B']);
 assert.equal(candidates[0].results.length,9);
 assert.equal(candidates[0].results.find(result=>result.section_key==='matematik')?.correct,15);
 assert.equal(candidates[0].results.find(result=>result.section_key==='matematik')?.wrong,5);
 assert.equal(candidates[0].reported_total_net,64.75);
 assert.equal(candidates[0].score,300.1);
 assert.equal(candidates[0].rank,1234);
 assert.equal(candidates[0].exam_date,null);
 assert.ok(candidates[0].warnings.some(warning=>warning.includes('tarihi')));
 assert.equal(candidates[1].reported_total_net,27);
 assert.equal(candidates[1].results.find(result=>result.section_key==='turkce')?.correct,20);
});

test("single-student TYT Karne summary uses Soru/D/Y/Net columns and ignores learning outcomes", async () => {
  const { parseKarneTytPage } = await import("../src/lib/exam-import/karne");
  const cell = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const items: ReturnType<typeof cell>[] = [
    cell("SONUÇ BELGESİ", 120, 807), cell("ÖRNEK DENEME KULÜBÜ TYT", 301, 810),
    cell("DERSLERE GÖRE ANALİZ", 388, 793),
    cell("Ders", 51, 679), cell("Soru", 101, 679), cell("Doğru", 121, 679),
    cell("Yanlış", 144, 679), cell("Net", 173, 679),
    cell("TYT", 25, 715), cell("356,789", 78, 715), cell("842", 270, 715),
    // The right-hand learning outcomes must never be interpreted as results.
    cell("Fizik", 309, 516), cell("1", 480, 516),
  ];
  const rows: Array<[string, number, number, number, number, string]> = [
    ["Türkçe", 661, 40, 30, 4, "29,00"],
    ["Tarih-1", 647, 5, 4, 0, "4,00"],
    ["Coğrafya-1", 633, 5, 3, 1, "2,75"],
    ["Felsefe", 618, 5, 2, 2, "1,50"],
    ["Din Kül. ve Ahl. Bil.", 604, 5, 3, 0, "3,00"],
    ["Felsefe (Seçmeli)", 590, 5, 0, 0, "0,00"],
    ["TYT Sosyal", 576, 20, 12, 3, "11,25"],
    ["Matematik-1", 560, 30, 20, 4, "19,00"],
    ["Geometri", 546, 10, 5, 1, "4,75"],
    ["TYT Matematik", 532, 40, 25, 5, "23,75"],
    ["Fizik", 516, 7, 3, 1, "2,75"],
    ["Kimya", 502, 7, 4, 1, "3,75"],
    ["Biyoloji", 488, 6, 2, 2, "1,50"],
    ["TYT Fen", 474, 20, 9, 4, "8,00"],
    ["Toplam:", 458, 120, 76, 16, "72,00"],
  ];
  for (const [label, y, questions, correct, wrong, net] of rows) {
    items.push(cell(label, 25, y), cell(String(questions), 104, y),
      cell(String(correct), 127, y), cell(String(wrong), 150, y), cell(net, 169, y));
  }
  const candidate = parseKarneTytPage(items, 1);
  assert.ok(candidate);
  assert.equal(candidate.results.length, 9);
  assert.equal(candidate.results.find((result) => result.section_key === "turkce")?.correct, 30);
  assert.equal(candidate.results.find((result) => result.section_key === "matematik")?.correct, 25);
  assert.equal(candidate.results.find((result) => result.section_key === "matematik")?.blank, 10);
  assert.equal(candidate.reported_total_net, 72);
  assert.equal(candidate.reported_total_source?.uncertain, false);
  assert.equal(candidate.score, 356.789);
  assert.equal(candidate.rank, 842);
  assert.equal(candidate.exam_date, null);
  assert.deepEqual(candidate.warnings, ["Sınav tarihi sonuç belgesinde açıkça yazmıyor; kaydetmeden önce tarihi seç."]);
  assert.equal(parseKarneTytPage(items.filter((item) => item.str !== "SONUÇ BELGESİ"), 1), null);

  const optional = items.find((item) => item.str === "Felsefe (Seçmeli)");
  assert.ok(optional);
  const optionalCorrect = items.find((item) => item.transform[4] === 127 && item.transform[5] === optional.transform[5]);
  const optionalNet = items.find((item) => item.transform[4] === 169 && item.transform[5] === optional.transform[5]);
  assert.ok(optionalCorrect && optionalNet);
  optionalCorrect.str = "1";
  optionalNet.str = "1,00";
  const withOptional = parseKarneTytPage(items, 1);
  assert.ok(withOptional?.warnings.some((warning) => warning.includes("Seçmeli Felsefe")));
  assert.equal(withOptional?.reported_total_source?.uncertain, true);
});

# Kırklareli Tıp çalışma alanı

> **Tarihsel kayıt:** İlk teknik açıklama ve yayın/test notu korunur. [Güncel rehber](../features/KIRKLARELI_MEDICINE.md) · [Arşiv açıklaması](README.md).

University students can opt into the Kırklareli University Faculty of Medicine
2026–2027 curriculum from **Konularım** or **Ayarlar → Öğrenci alanım**. Select
an academic year and Dönem 1–4. General university results and YKS topics remain
accessible independently. No existing account is opted in automatically.

The initial setup and **Ayarlar → Öğrenci alanım → Profilimi düzenle** also
offer **Üniversite programı → Kırklareli Üniversitesi Tıp** with a Dönem 1–4
selector. Completing the profile saves the university education profile first,
then activates the medicine profile for the selected academic year and dönem.
If activation fails, the editor stays open and retries the same medicine
request without submitting the unchanged education profile again. The program
selection also survives a saved setup draft.

## Curriculum and provenance

The frozen catalog contains the five Dönem I committees, six Dönem II
committees, seven Dönem III committees, eight Dönem IV clerkships and three
Kliniğe Erken Giriş (KEG) courses. Topic rows retain the faculty source URL and
source page numbers. Repeated lectures within the same unit/subject are merged;
theory and practice are separate. Dönem IV includes the named condition/course
tables and additional lectures and patient-side sessions from weekly programs.

Sources are linked from the faculty's [website](https://tip.klu.edu.tr/):

- [2026–2027 approved education plan](https://tip.klu.edu.tr/dosyalar/birimler/tip/dosyalar/dosya_ve_belgeler/ders_programi_egitim_planlari/2026-2027_egitim__plan_ve_ders_programi/tip_fakultesi_egitim_plani.pdf)
- The four Dönem 1–4 PDFs, whose complete URLs appear on each catalog unit.
- [Education regulation, article 21](https://oidb.klu.edu.tr/dosyalar/birimler/oidb/dosyalar/dosya_ve_belgeler/tip_fakultesi_egitim_ve_ogretim_yonetmeligi.docx)
- [Measurement and assessment rules](https://tip.klu.edu.tr/dosyalar/birimler/tip/dosyalar/dosya_ve_belgeler/mevzuat/usul_ve_esaslar/9-_tip_fakultesi_sinav__uygulama_ve_olcme_degerlendirme_esaslari.pdf)

The catalog is versioned as `klu-2026-2027`; its version stays visible even
when a student changes the academic year of their personal records. Dönem V–VI
are not seeded from other faculties. Review a new official program before
introducing a new version.

To reproduce the topic JSON, save the source PDFs as `klu-d1.pdf` through
`klu-d4.pdf`, install `pdfplumber`, then run:

```powershell
python scripts/build-klu-medicine.py --source-dir <source-folder>
```

Compare extraction against the source pages before publishing. Topic IDs are
derived from the unit, normalized name, subject and theory/practice kind. Keep
the private database catalog keys synchronized with the client JSON;
`tests/medicine-catalog.test.ts` checks this publication contract.

## Grade rules

- Dönem I–III: weighted committee average × 50% + final/resit × 50%.
  Weights use the published theory + practice lesson hours (course load).
- Enter the faculty's announced committee score, after its departmental baraj
  penalties. Do not apply YKS net calculation or subtract the penalty again.
- All committee scores must exist before the period score/final target is
  calculated. A partial average is explicitly marked provisional. Blank is
  missing; a recorded zero is a real score.
- Period success needs score ≥60 and the recorded KEG course result sufficient.
  No foreign-faculty final ≥50 threshold or final exemption is imported.
- Dönem IV clerkship components: theory ×40% + practice ×60%. Theory must be
  ≥60, and the combined score must be ≥60. A high practical score cannot hide
  a theory failure; a high annual average cannot hide a failed clerkship.
  Students can alternatively record the faculty's announced final clerkship
  score. Partial component entry remains incomplete.
- A resit replaces the normal result, even when its score is lower; both
  attempts remain stored. Deleting a resit restores the normal result in the
  calculation. Values are not rounded before the pass/fail decision.
- KEG skills have personal study progress. This does not award course
  sufficiency: the student separately enters the announced KEG result/date.

## Persistence and isolation

`/api/medicine` uses the verified student session, same-origin POST validation,
bounded input, and the `medicine_state` / `medicine_command` RPCs. Personal
progress, marks, KEG and settings are held in four RLS-protected tables.
Browser roles have SELECT only; mutations go through a narrowly granted public
invoker wrapper and private definer implementation with explicit verified,
approved student/browser-session checks. Curriculum keys and receipts are
private and cannot be queried directly by browser clients.

Every mutation checks the current row revision and has an actor-scoped request
receipt. Ambiguous network failures retry the same ID; a changed payload cannot
reuse a receipt. Academic years are isolated and the snapshot returns only the
selected year/dönem. The parent account FK cascades all five personal record
and receipt tables when an account is deleted; the account deletion test seeds
and checks this graph. Classroom statistics, YKS MCP tools and Nova do not
receive medical notes or grades.

## Publication and rollback

Apply `20261013220338_kirklareli_medicine.sql` before deploying the UI. It is
additive and does not alter YKS rows or activate students' medical profiles.
Rollback the app commits if necessary and retain the additive tables to
preserve students' records. Students can hide their medical workspace without
deleting its data.

## Verification

Grade boundary tests, catalog/source-key checks, PGlite persistence/RLS/retry
and account deletion tests, plus browser flows for topic progress/notes, KEG,
resit calculations, clerkship gating, period switching, response-loss retry
and 320px layout cover this feature.

The existing `school-results.spec.ts` contains old expectations for optimistic
batch display and minimal-response reconciliation. These conflict with the
current queue, which deliberately waits for canonical batch IDs and sends
education commands with full responses. The pending-save failure was reproduced
on untouched `origin/main` (7e66f87) before publication. Its expectations were
not weakened; only the navigation assertion changes because university
students now have a Konularım entry without needing a YKS goal.

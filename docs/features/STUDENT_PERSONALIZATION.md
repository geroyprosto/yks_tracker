# Öğrenci profili, dersler ve okul sonuçları

Bu belge eğitim alanının güncel teknik sözleşmesidir. Genel akış için [mimariyi](../ARCHITECTURE.md), test paketleri için [TESTING.md](../TESTING.md) oku. İlk geliştirme ve o tarihteki test kanıtı [27 Eylül kabul kaydında](../archive/STUDENT_PERSONALIZATION_ACCEPTANCE.md), eski tasarım anlatımı [tarihsel belgede](../archive/STUDENT_PERSONALIZATION_HISTORY.md) korunur; bu kayıtlar güncel canlı ortam onayı değildir.

## Model ve veri anlamları

Eğitim profili yetki rolünden ayrıdır. `education_profiles` eğitim düzeyini (`high_school`, `university`, `graduate`), YKS hedefini, lise sınıfını veya bölüm/üniversite sınıfı bilgisini, alan tercihini, görünür araçları ve aktif dönemi tutar. Öğrenci/öğretmen/yönetici rolü ile başvuru onayı `classroom_accounts` ve sınıf kontrollerine aittir.

| Tablo | Sözleşme |
| --- | --- |
| `education_profiles` | Kullanıcıya ait profil, modül görünürlüğü, aktif dönem ve revizyon |
| `education_drafts` | Tamamlanmamış kurulum verisi, adım ve revizyon; etkin profilden ayrı |
| `education_terms` | Akademik yıl/dönem; aktif dönem değişince önceki dönem arşivlenir |
| `education_courses` | Kalıcı ders kimliği, `school` / `yks` bağlamı, dönem ve TYT/AYT ayrımı |
| `course_exam_results` | Okul puanı, orijinal ölçek, sınav türü/adı, tarih ve tarihsel ders adı |

Okul dersinin dönemi zorunludur. YKS dersi TYT/AYT bağlamını taşır. Kullanıcı + dönem + bağlam + sınav + Türkçe normalize edilmiş ad benzersizdir. Okul Matematik, TYT Matematik ve farklı dönemlerin Matematik dersleri ayrı kayıtlardır. YKS `catalog_subject` alanı ilk katalog bağını korur; dersin adını değiştirmek mevcut konularla ilişkiyi koparmaz.

Görev, sayaç, manuel süre ve soru çalışması ortak `course_id` üzerinden ders seçer. Ad değişince eski kayıtların etiketleri yeniden yazılmaz. Arşivlemek geçmişi silmez. Aktif sayaç sırasında profil/dönem değişimi ve ilgili dersin arşivlenmesi engellenir; eski oturum başka derse taşınmaz.

Okul puanı, yüzde ve YKS neti ayrı anlam taşır. `course_exam_results` okul sınavları içindir; YKS sonuçları `exams` / `exam_results` modelini kullanır. Okul sonuçları dönem ve ders kartlarında özgün puan/ölçek, sınav türü/adı ve tarihle listelenir. Eksik sonuç sıfır sayılmaz; kaydedilmiş sıfır geçerlidir. Genel okul sonuçlarında GPA, harf notu veya dönem ağırlıkları hesaplanmaz.

Eğitim düzeyini veya YKS alanını değiştirmek mevcut TYT / AYT Sayısal / branş deneme formatlarını dönüştürmez. Bölüm adından otomatik üniversite müfredatı üretilmez. Açık seçimle etkinleştirilen Kırklareli Tıp kataloğu ve özel not kuralları [ayrı modüldedir](KIRKLARELI_MEDICINE.md).

## Kurulum ve erişim

İlk kurulum dört adımlıdır: eğitim/hedef → dönem → önizlemeli ders listesi → görünür araçlar ve açık kaydetme. Adımlar arasında veya “Taslağı kaydet” ile `education_drafts` saklanır; yenilemeden sonra sürdürülebilir. Ayarlar aynı kurulum bileşenini ve son doğrulamayı kullanır. İptal etkin profili değiştirmez; önceden kaydedilmiş taslak ayrı kalır.

`/personalize` ve `/api/education`, Auth kimliği doğrulanmış ve e-postası onaylanmış öğrenci gerektirir:

- **Bekleyen öğrenci:** Kendi taslağını okuyabilir, kaydedebilir ve silebilir. Kesin profil, ders, puan ve çalışma verisi yazamaz.
- **Onaylı öğrenci:** Kendi eğitim alanını ve çalışma verisini kullanır. Eksik kurulum `needs_onboarding` ile panelde açılır.
- **Öğretmen/yönetici:** Öğrenci kurulumuna zorlanmaz; eğitim profili rol yetkisi vermez.

Eski hesaplar geçişte YKS uyumluluk profili alır; yeniden kurulum zorunlu değildir. Görünür modül seçimi güvenlik sınırı değildir. Öğretmen özelliklerinin mevcut duraklatma kuralı [mimaride](../ARCHITECTURE.md) açıklanır.

## API, makbuz ve çakışma

`GET /api/education` → `education_state`; `POST /api/education` → `education_command`. Sunucu `sameOrigin`, boyut sınırı, Zod ve `requireEducationUser()` denetimlerini uygular. SQL kendi aktör/rol/onay/sahiplik doğrulamasını tekrar yapar; istemciden gönderilmiş kullanıcı kimliğine güvenmez.

Komut zarfı `{request_id, type, payload}` biçimindedir. Desteklenen işlemler:

| İşlem | Amaç |
| --- | --- |
| `draft.save`, `draft.discard` | Ayrı kurulum taslağı |
| `profile.save` | Doğrulanmış profil, dönem ve derslerin birlikte kaydı |
| `course.create`, `course.update` | Ders ekleme, adlandırma ve arşivleme |
| `term.activate` | Önceki dönemi yeniden etkinleştirme |
| `results.batch`, `result.update` | Toplu okul sonucu ve revizyonlu sonuç düzeltme |

`request_id` kullanıcıya bağlı kalıcı makbuzla tutulur. Aynı kimlik + aynı payload yeniden gönderildiğinde kopya üretilmez; farklı payload `IDEMPOTENCY_CONFLICT` olur. Yeni gerçek sınav yeni UUID alır. Revizyonlu güncellemeler `expected_revision` ister; eski revizyon `CONFLICT` döndürür. Hesap başına transaction kilidi eşzamanlı yazmaları sıralar. `results.batch` tek transaction'dır; bir satır geçersizse kısmi kayıt oluşmaz.

Tam yanıt `{ok, result, state}` içerir. `Prefer: return=minimal` yalnız makbuzu döndürür. Dashboard eğitim işlemlerini ortak kuyrukta `education.` önekiyle izler, API'ye gönderirken bu öneki kaldırır. Eğitim yanıtı yalnız eğitim durumunu yenilediğinden genel panel gerektiğinde `/api/state` ile uzlaştırılır. `profile.save` ve `results.batch` yeni kalıcı kimlikler gerektirdiği için görünüm sonucu bekler.

Toplu puan formunda boş hücre kayıt üretmez. CSV/TSV tarayıcıda ayrıştırılır; belirsiz dersler ve kolonlar kayıttan önce kullanıcı tarafından eşleştirilir. Bu akış AI çağırmaz. Sonuç düzeltmeleri revizyon ve denetim kaydı kullanır.

## Geçmiş veri ve migration

İlgili temel migration `supabase/migrations/20260927152739_student_personalization.sql` dosyasıdır; sonrasındaki migration'lar da sırasıyla uygulanır. Aynı günkü `20260927152814_ai_student_reports.sql` AI sürüm/kota altyapısı içindir; modelin güncel şeması [AI/MCP rehberinden](../integrations/AI_MCP.md) takip edilir.

Geçiş mevcut konu, hâkimiyet geçmişi, deneme, doğru/yanlış/boş/net ve süreleri korur. Eski görevlerde kullanıcı/sınav/normalize ders kesin eşleşmesi; sayaç ve manuel sürelerde açık TYT/AYT etiketi varsa `course_id` bağlanır. Belirsiz çıplak ders adları değiştirilmez ve bağsız kalabilir.

Kesinleşmiş oturumun süresi, zamanları, aralıkları ve manuel kesinleşmiş süreler normal komut, MCP veya doğrudan tablo değişikliğiyle düzeltilemez. Bu SQL trigger korumasıdır; `timer.correct` de `DURATION_IMMUTABLE` döndürür. Okul puanı revizyonla değiştirilebilir. Yetkili hesap kapatma zinciri ayrı kalır.

Şema değişikliğinde yeni migration ekle; tarihsel migration'ı veya eski etiketleri tahminle yeniden yazma. Uygulamayı geri alırken ek tablolar ve yeni kullanıcı verisi korunur. Migration dosyasının bulunması, ilgili ortamda uygulandığının kanıtı değildir; ortam kontrolleri [SETUP.md](../SETUP.md) içindedir.

## Kod ve doğrulama haritası

| Değiştirilecek alan | Dosyalar |
| --- | --- |
| Tipler, doğrulama, normalleştirme | [`src/lib/education.ts`](../../src/lib/education.ts), `src/lib/education-ui.ts` |
| API ve SQL geçidi | [`src/app/api/education/route.ts`](../../src/app/api/education/route.ts), [`src/lib/server/education.ts`](../../src/lib/server/education.ts) |
| Kurulum, ayarlar, seçici | `src/components/education-setup.tsx`, `education-settings.tsx`, `course-selector.tsx`, `personalization-page.tsx` |
| Panel ve kayıt uzlaştırma | `src/components/dashboard.tsx`, `src/lib/study-command-queue.ts`, `optimistic-education.ts` |
| Sonuç girişi ve grafik | `src/components/school-results-entry.tsx`, `school-results.tsx`, `src/lib/school-results.ts` |
| Tıp profiliyle iki aşamalı kayıt | `src/lib/medicine-profile-save.ts`, `src/components/medicine/setup.tsx` |

Sözleşme için `tests/education*.test.ts`, `tests/school-results.test.ts` ve `supabase/tests/education.test.ts`; tarayıcı akışı için `tests/e2e/student-personalization.spec.ts`, `school-results.spec.ts` ve `tests/classroom-e2e/student-personalization.spec.ts` kullanılır. PGlite testleri geçmiş veri, yetki, makbuz ve SQL kurallarını doğrular; gerçek Supabase Auth/Storage veya üretim eşzamanlılığı kabulünün yerine geçmez. Güncel bir değişiklik için bu paketler yeniden çalıştırılır; arşivdeki test sayıları yeni kontrol sonucu değildir.

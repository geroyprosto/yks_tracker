# Test ve kabul kaydı

Güncelleme: 25 Eylül 2026. Birim test, yerel PostgreSQL entegrasyonu, tarayıcı incelemesi ve gerçek Supabase/Google/OpenAI/MCP doğrulaması ayrı kanıtlardır.

## 25 Eylül 2026 Aşama 3 yerel doğrulama

| Kontrol | Sonuç |
| --- | --- |
| `pnpm test:all` | **169/169 geçti.** OAuth hook/gateway ve `get_analysis_sources` dahil tam yerel birim + PGlite/servis koşusu; 51 DB testi bu toplama dahildir. |
| PGlite DB testleri (`pnpm test:all` içinde) | **51/51 geçti.** Günlük AI, tarihli çalışma, OAuth audience hook ve owner gateway migration'ları yerel PGlite'da sınandı; altısı da uzak YKSim projesine uygulandı. Yerel test canlı OAuth/Data API/Storage kabulü değildir. |
| `pnpm exec tsx --test tests/mcp.test.ts tests/manual-study.test.ts tests/study-report.test.ts tests/progress-breakdown.test.ts tests/study-statistics-summary.test.ts` | **22/22 geçti.** Tarihli süre kaydı, rapor toplamları ve MCP araç sözleşmesi için hedefli yerel kontroller. |
| `pnpm exec tsx --test supabase/tests/manual-study.test.ts` | **4/4 geçti.** Tarihli kaydın veritabanı komutu, tekrar anahtarı ve sahiplik sınırı için odaklı yerel kontroller. |
| `pnpm exec tsx --test tests/mcp-security-metadata.test.ts tests/mcp-topic.test.ts tests/mcp.test.ts` | **12/12 geçti.** Bu koşu yeni analiz aracı eklenmeden önceki dokuz araç, OAuth güvenlik meta verisi ve konu düzeyi yazmasının sözleşme kontrolleridir. |
| `pnpm exec tsx --test tests/journal-ai.test.ts` | **3/3 geçti.** Kanıtı olmayan alanın atılması, `store:false` şemalı yanıt, ölçülen kullanım ve kaynak özeti için yerel birim kontrolleri. |
| `pnpm exec tsx --test supabase/tests/journal-ai.test.ts` | **3/3 geçti.** Ortak AI bütçesi, tekrar anahtarı ve öneri durumları için yerel veritabanı kontrolleri. |
| `pnpm exec playwright test tests/e2e/phase2-flow.spec.ts --grep "journal AI suggestion"` | **1/1 geçti.** Önerinin ayrı incelenmesi, boş alanlara uygulanması ve açık kayıt adımı için tarayıcı sözleşmesi; ücretli OpenAI çağrısı değildir. |
| Yeni MCP analiz/gateway testleri | `tests/mcp-analysis-tool.test.ts`, `supabase/tests/mcp-oauth-audience.test.ts` ve `supabase/tests/mcp-owner-gateway.test.ts` toplam **8/8** testle 169/169 tam koşuya dahil edildi. 14/31 gün sınırı ve günlük alan gizliliği; OAuth JWT ile doğrudan sahip tablo/PDF Storage reddi; normal tarayıcı erişimi ve dört komutluk servis geçidi yerel PGlite/mock ortamında sınandı. |
| `pnpm test:e2e` | İlk tam koşu **48/49** idi: eski “Oturumlar” seçicisi arayüzdeki “Kayıtlar” adına göre düzeltildi. Sonraki tam koşu **49/49 geçti**. Testte sağlayıcılar HTTP mock ile izole edilir; bu canlı OAuth/AI kabulü değildir. |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Yeni gateway/analiz aracı koduyla **üçü de geçti**. Build çıktısı canlı sağlayıcı kabulü değildir. |
| Canlı Aşama 3 kabulü | YKSim uzak Supabase'e altı Aşama 3 migration'ı uygulandı; canlı toplam **14**. Hook ve gateway uzak sürümleri `20260925171059` ve `20260925171128`. Audience hook henüz OAuth Server'da yapılandırılmadı/etkinleştirilmedi. Uzak SQL'de 24 public sahip tablosunda restrictive policy, özel PDF Storage'da bir restrictive policy, üç gateway RPC'sinde yalnız `service_role` yetkisi ve bilinmeyen sahip için ret doğrulandı; hook yapılandırması boş ve yapılandırılmamış istemcide `aud=authenticated` kaldı. Advisor yeni gateway uyarısı göstermedi. İlk dört analiz tablosu ile yeni günlük AI önerisi ve tarihli çalışma tablolarında RLS; yeni RPC'lerde service/authenticated yetkileri doğrulandı. OpenAI kredisi **0 USD**; API anahtarı, ödeme veya ücretli çağrı yok. Vercel hesabı/projesi, HTTPS yayını, cron ve etkin MCP yok; Supabase OAuth keşif uçları son kontrolde **404**. Uygulanan gateway migration'ı OAuth JWT'lerini doğrudan sahip tablo ve özel PDF Storage erişiminden restrictive RLS ile dışlamayı hedefler; sunucu doğrulanmış sahip için dört komut türünü allowlist eder. Doğrudan Data API/Storage reddi ve gerçek OAuth/ChatGPT kabulü doğrulanmadan MCP kapalı kalmalı. Gerçek AI önerisi, tarihli bulut yazması, zamanlı rapor ve ChatGPT bağlantısı kabul edilmedi. |

Bu bölüm kod, yerel test ve migration uygulama kanıtıdır. Altı Aşama 3 migration'ı YKSim uzak veritabanına uygulandı; audience hook yapılandırılmadı/etkinleştirilmedi, gateway policy/RPC uzak SQL denetimi tamamlandı; gerçek OAuth/Data API/Storage kabulü bekliyor. Kalan ücretli API/bütçe, Vercel/HTTPS ve OAuth adımları [Aşama 3 kurulumunda](PHASE3_SETUP.md); bunlar bitmeden canlı kabul yapılmış sayılmaz.

## Önceki Aşama 2 doğrulaması (24 Eylül)

| Kontrol | Sonuç |
| --- | --- |
| `pnpm test` | **74/74** birim testi geçti; PDF görsel okuma için açık izin, seçili sayfalar, yapılandırılmış öneri ve hata durumları dahil. |
| `pnpm test:db` | **30/30** PGlite/servis testi geçti; sürümlü TYT/AYT/branş, günlük gizliliği, PDF hash/idempotency/atomik kayıt ve Google belirteç tablosunun sunucu sınırı dahil. |
| `pnpm test:all` | **104/104** birleşik test geçti. |
| `pnpm test:e2e` | **34/34** geçti. Kurulumsuz test sunucusu 3100 portunda ayrıştırıldı; gerçek bağlı uygulama 3000 portunda kaldı. Testte kişisel veriler HTTP mock ile izole edilir. |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Güncel OCR değişiklikleriyle üçü de yeniden geçti. |
| Canlı Google OAuth ve Calendar API | Kullanıcı uygulamanın izin akışını tamamladı. Bulutta sahip hesabına ait **1** bağlantı, **3** seçilmiş takvim ve dolu `last_success_at` doğrulandı; en az bir sağlayıcı okuması başarılı. Yerel sunucu OAuth env değerleriyle yeniden başlatıldı. |
| Önceki görsel denetim | Altı tema için 1440 ve 360 px'te Denemelerim, Çalışma İstatistikleri, Günlüğüm ve PDF incelemesi: **48 ekran görüntüsü**, yatay taşma/tarayıcı hatası yok. PDF modalı iki eksende merkezlenmiş olarak ölçüldü. |

Bu OCR kontrolü sırasında YKSim Free Supabase projesinde (`efekpsnejfxiilfkjfar`, Frankfurt) yedi migration, özel PDF bucket/RLS ve tek doğrulanmış sahip kaydı doğrulanmıştı. Sonraki katalog migration'ı ve altı Aşama 3 migration'ıyla canlı toplam 14'e çıktı. Kullanıcının gerçek girişi sonrasında sahip profili ve başlangıç konu kataloğunun oluştuğu doğrulandı. PGlite testleri transaction/RLS mantığını, HTTP mock'lar istemci sözleşmesini doğrular. Bunlar canlı özel PDF yükleme, başka kullanıcı reddi, iki cihaz veya OpenAI görsel çağrısının yerini tutmaz. Google OAuth bağlantısı ve ilk Calendar API okuması ayrıca canlı doğrulandı; izin iptali, yeniden bağlama, token yenileme ve farklı günlerde etkinlik gösterimi test edilmedi. OCR kodu seçili sayfaları yalnız yükleme başına açık izinle gönderir; gerçek OPENAI_API_KEY henüz ayarlanmadı. [Kurulum rehberi](SETUP.md) ve [OCR notu](PDF_IMPORT_OCR.md) kalan canlı adımları açıklar.

Görseller: [Denemeler masaüstü](../artifacts/phase2-qa/ocean-1440-exams.png), [İstatistikler mobil](../artifacts/phase2-qa/rose-360-stats.png), [ortalanmış PDF masaüstü](../artifacts/phase2-qa/white-1440-pdf-viewport.png), [ortalanmış PDF mobil](../artifacts/phase2-qa/rose-360-pdf-viewport.png).

## Önceki kontrol kayıtları

Aşağıdaki sayılar önceki aşamalarda alınmış tarihsel ölçümlerdir; güncel toplamlar üstteki tabloda yer alır.
## Gerçekten çalıştırılan kontroller

| Kontrol | Komut / ortam | Sonuç |
| --- | --- | --- |
| İlerleme birim testleri | node node_modules/tsx/dist/cli.mjs --test tests/progress.test.ts | **30/30 geçti**, 0 başarısız/atlanan/TODO; 155,5286 ms. |
| Veritabanı/servis/HTTP entegrasyonu | pnpm exec tsx --test supabase/tests/core.test.ts | **18/18 geçti**; Beyaz/Siyah tema ile soru/test kaydı, revizyon, idempotency ve sahiplik kontrolleri dahil. PGlite 0.5.8. |
| Zaman/aralık birim testleri | tests/timing.test.ts | **10/10 geçti**; gerçek aktif aralık ve saat dilimi hesapları. |
| TypeScript | pnpm exec tsc --noEmit | **Geçti**; ana geliştiricinin son gerçek koşusu, çıkış 0. |
| Önceki çekirdek + DB/servis birlikte koşusu | tests/*.test.ts + supabase/tests/*.test.ts | **55/55 geçti** = 30 ilerleme + 10 zaman + 15 DB/servis; son birlikte koşu 1421 ms. |
| Tüm proje lint | ESLint . | **Geçti**; ana geliştiricinin son gerçek koşusu. |
| agent-browser ve ekran incelemesi | Kurulum gerektiren gerçek yerel ekran | Ekran yüklendi; etkileşim snapshot'ı doğru, tarayıcı hatası 0. Masaüstü ve 360 px görüntüleri gözle incelendi. |
| Playwright E2E | Edge; 6 gerçek kurulum/API + 13 HTTP mock | **19/19 geçti**, tamamlayıcı renkler sonrası son tam koşu 11,1 saniye. Gerçek Supabase giriş/yazma testi değildir. |
| Production build | pnpm build / Next.js 16.3.6 | **Geçti**; tüm uygulama/API yolları production build'e alındı. |
| Gerçek sağlayıcı/Auth/iki cihaz | Önceki bulut durumu | O tarihte kurulum yoktu; güncel Auth, Google bağlantısı ve proje sonucu yukarıda. İki cihaz ve OpenAI sağlayıcı testi bekliyor. |

### Soru/test takibi ve analizinin son doğrulaması

- `pnpm test`: **51/51** birim testi geçti; bunların 5'i gün/hafta/ay aralıkları, önceki dönem ve ayın hafta gruplaması içindir.
- `pnpm exec tsx --test supabase/tests/core.test.ts`: **18/18** yerel PGlite testi geçti. Yeni kayıtların idempotency, revision, audit ve RLS sahipliği bu testlere dahildir.
- `pnpm build` ve ilgili TSX/TypeScript ESLint kontrolleri geçti.
- Altı temada 1440, 1920 ve 360 px tarayıcı kontrolü: iki kartın yerleşimi, analiz sayfasına geçiş, günlük/haftalık/aylık dönemler, önceki dönem, renk ayrımı ve taşma kontrol edildi. Sayfa hatası ve `/api/command` yazma isteği yoktu. Önizleme kapalıyken gerçek boş görünüm izlendi.
- Görseller: [Siyah tema iki kart](../artifacts/practice-black-today-1440.png), [Gül mobil](../artifacts/practice-rose-today-360.png), [Gül analiz](../artifacts/practice-rose-analysis-1440.png).

Bu tarihsel soru/test kontrolleri tek başına canlı bulut kaydını kanıtlamıyordu. İlgili migration ve sahip hesabı artık kurulu; gerçek soru/test ekleme akışı ayrıca kabul edilmeli.

### İlerleme birim testleri

Kapsam: 120/400=%30; %70 görev + %50 süre=%64; 3/6 saat=%50; hedef aşımı; boş plan/sıfır ağırlık/sıfır hedef; tanımsız bileşenler; sıfır ile tanımsız farkı; kısmi/özel görev ağırlığı; kullanıcı zorluk katsayıları; alt adımların ana ağırlığı eşit paylaşması; 0–1 sınırlaması; sıfır pay ve normalizasyon; geçersiz sayı/ağırlık/pay; kalıcı başlangıç+birikmiş saniye hesabı.

İki bileşenden yalnız biri tanımlıysa onun pozitif payı normalize edilir. Tek tanımlı bileşenin payı 0 ise puan null kalır. NaN/sonsuz girdiler UI'ye NaN puan olarak taşınmaz. Komut şemaları geçersiz girdileri ayrıca reddeder.

### PostgreSQL ve servis entegrasyonu

Gerçek migration, RLS, PostgreSQL fonksiyonları ve transaction davranışı PGlite üzerinde çalıştırıldı. **Yalnız Supabase Auth kimlik kaynağı bu testlerde taklit edildi.** Ayrı bulut kontrolünde doğrulanmış sahip hesabıyla giriş ve profil/katalog başlangıcı görüldü; bu yine tüm JWT/cookie/ağ/girişli komut akışlarının kabulü değildir. Test Auth taklidi uygulama koduna dahil değildir ve demo giriş açmaz.

Kapsam:

- İlk sahibin boş kişisel verileri ve sıfır öğrenme düzeyli düzenlenebilir kataloğu.
- Anonim/başka kullanıcı erişimi, doğrudan tablo yazma ve özel şema sınırları.
- Aynı işlem anahtarının tek kayıt üretmesi; aynı anahtar/farklı içerik reddi.
- Kısmi güncellemede diğer alanların korunması; eski sürümün reddi.
- Alt adımların eşit payı ve çift ağırlık üretmemesi.
- Aynı gündeki görevleri atomik yukarı/aşağı sıralama; eski eşit konumları düzeltme, tek plan snapshot'ı ve eski sürüm reddi.
- Tekrarın hâkimiyeti bozmaması; düzey geçmişi.
- Ayar değişiminde bugünkü plan sürümü ve önceki gün snapshot'larının korunması.
- Tek etkin sayaç, kalıcı aktif aralıklar, mola dışlama ve tekrar bitirmede tek kayıt.
- Tarayıcı kapalı kaldığında geri sayımın hedefte sınırlanması.
- 6 saati aşan kronometrede doğrulama ve düzeltmede audit/geçmiş korunması.
- Konu hiyerarşisi döngüsü ve başka hesaba referans reddi.
- Doğrudan RPC'de geçersiz iç içe JSON reddi ve açık tablolarda RLS.
- Soru/test kayıtlarında gün, sınav ve ders bazlı kalıcılık; ekleme/güncelleme/silme, idempotency, revision, audit, negatif/sıfır toplam reddi ve RLS sahipliği.
- Ortak servis adapter'ında doğrulama ve sürüm çakışması hata eşlemesi.
- Meşru localhost/Vercel origin kabulü, cross-origin ve forwarded-host sahteciliği reddi.

### Tarayıcı doğrulamasının sınırı

Bu tarihsel 19 senaryoda 6 test yerel kurulumsuz uygulama/API üzerinde, kalan 13 test HTTP yanıtları taklit edilerek çalıştı. Daha sonra gerçek Supabase sahibiyle giriş ve profil/katalog başlangıcı ayrıca doğrulandı. Sözleşme testleri; giriş/yazma hatalarının modal içinde görünmesi, taslağın korunması, yenilemeden sonra tema/az hareket/sade tercihleri, süre azaltımı ve zorunlu gerekçe, atomik sıralama komutu ve hedef düzenleme akışlarını kontrol eder.

Masaüstü ve 360 px görüntüler gözle incelendi; mobil menünün kapanması ayrıca doğrulandı. Son görseller: [masaüstü](../artifacts/verified-desktop.png), [mobil](../artifacts/verified-mobile.png), [mobil ekran](../artifacts/verified-mobile-viewport.png).

### Zaman ve aralık testleri

10 birim test; arka plandan dönen kronometre, duraklatılmış/bitmiş oturumda zaman eklenmemesi, gelecekteki başlangıç, geri sayım hedef sınırı, İstanbul gece yarısı ve mola dışlama, kalan geri sayımın gün sınırı, 23/25 saatlik yaz saati geçişleri, çoklu gece yarısında toplamın korunması ve geçersiz aralıkların süreyi artırmamasını doğruladı. İki cihazın gerçek çevrimdışı eşitlemesi henüz uygulanmadı.

## Palet ve halka yenilemesi

24 Eylül 2026 tarihli görsel düzeltme:

- 9 palet açık ve koyu görünümde aydınlatıldı; referansların orta/açık renkleri tuval, kart ve menü yüzeylerine dağıtıldı. Pastel ailesi her iki görünümde de açık kalır.
- Göstergeler 28 px kalın, temaya uyumlu neon SVG halkalara dönüştürüldü. Halka içi yüzdeler ve renkli sayısal açıklamalar eklendi.
- Birleşik puan halkasının bölümleri görev ve sürenin gerçek katkısını gösterir: %70 görev ilerlemesi ve %50 süre ilerlemesi → 49 + 15 = %64.
- Ders dağılımı yalnız gerçek aktif çalışma aralıklarını kullanır; yerel gece yarısını böler, molaları dışlar ve beşten fazla dersi ilk dört + diğer dersler olarak gruplar. Boş veriye örnek kayıt eklenmez.
- Mobilde halkalar büyük, dikey satırlara dönüşür. Süre metni halkanın içine sığacak şekilde ölçeklenir.

Son doğrulama: **46/46 birim testi** (30 ilerleme + 10 zaman + 6 halka/dağılım), **17/17 tarayıcı testi**, lint, TypeScript ve production build geçti. Yeni tarayıcı testleri tüm 18 tema/görünüm birleşiminde kart metni kontrastını, 360 px taşma kontrolünü, gerçek boş hesabı ve yalnız HTTP taklidiyle dolu halkaları doğrular. Palet yüzeylerinin metin kontrastı ayrıca incelendi; yoğun arka plan parlaması azaltıldı.

Görseller: [gerçek boş hesap](../artifacts/redesign-real-empty-steel.png), [sentetik dolu masaüstü](../artifacts/redesign-synthetic-steel-desktop.png), [sentetik mobil](../artifacts/redesign-synthetic-steel-mobile.png), [sentetik pastel açık](../artifacts/redesign-synthetic-pastel-light.png), [sentetik orman koyu](../artifacts/redesign-synthetic-forest-desktop.png). Sentetik veriler yalnız izole tarayıcı yanıtlarında bulunur; uygulamaya veya veritabanına yazılmaz.

## Tamamlayıcı renkler ve Beyaz/Siyah temalar

Kullanıcının son düzeltmesiyle 9 paletin ana renkleri korundu; halkalara, odak kartına ve tamamlanan görevlere karşıt renk aileleri eklendi. Pembe–yeşil, mavi–kayısı, turkuaz–mercan ve mor–yumuşak altın eşleşmeleri, sakin açık/koyu zeminlerle kullanılıyor. Önceki tek renk yüzey dağılımı bu tasarımla değiştirildi; Pastel de artık gerçek açık/koyu görünüm sunar.

Beyaz ve Siyah bağımsız, sabit zeminli iki tema olarak eklendi. Renkli temaya dönüldüğünde önceki açık/koyu/sistem tercihi korunur. Toplam 11 seçenek vardır. Yeni tema kimlikleri TypeScript, komut doğrulaması ve ek PostgreSQL migration ile uyumludur.

- 19/19 tam tarayıcı testi geçti. 9 × 2 renkli görünümde ana/ikincil metin hem kart hem zeminde en az 4.5:1 kontrastı koruyor. Beyaz/Siyah zeminleri, tercih kalıcılığı, pembenin yeşille ayrılması ve 360 px taşma kontrol edildi.
- 16/16 yerel DB/servis testi geçti; iki yeni temanın kaydı diğer ayarları koruyor, bilinmeyen tema reddediliyor.
- Bu tarihsel renk düzeltmesinde lint, TypeScript ve production build geçti. Bulut Supabase kurulumu daha sonra tamamlandı.

Son görseller yalnız tarayıcıya verilen sentetik test kayıtlarını gösterir: [pembe–yeşil açık](../artifacts/contrast-synthetic-rose-light-desktop.png), [pembe–yeşil koyu](../artifacts/contrast-synthetic-rose-dark-desktop.png), [Beyaz](../artifacts/contrast-synthetic-white-desktop.png), [Siyah](../artifacts/contrast-synthetic-black-desktop.png). Uygulamaya örnek veri kaydedilmedi.

## Kullanıcının 18 kabul senaryosu

| No | Kabul | Mevcut kanıt / kalan iş |
| --- | --- | --- |
| 1 | 120/400 ağırlık %30 | Birim testi geçti. |
| 2 | %70 görev / %50 süre → %64 | Birim testi geçti. |
| 3 | 3/6 saat %50; mola dahil değil | Birim ve yerel PostgreSQL mola dışlama geçti; gerçek hesap E2E gerekli. |
| 4 | Aşım/boş/sıfır/alt görev/geçmiş ayar | Birim ve geçmiş snapshot PostgreSQL testleri geçti; gerçek UI akışı gerekli. |
| 5 | Yenileme/duraklatma/kurtarma/tekrar güvenliği | Süre hesabı ve yerel transaction/aralık/tekrar testleri geçti; gerçek girişli yenileme E2E gerekli. |
| 6 | Gece yarısı/çevrimdışı/iki cihaz | İstanbul gece yarısı, çok gün ve yaz saati hesaplarının birim testleri geçti. Gerçek iki cihaz/çevrimdışı kuyruk henüz yok. |
| 7 | Tema kalır, sayaç/veri sıfırlanmaz | Yerel görünüm kalıcılığı ve HTTP mock ile yenileme/aktif sayaç istemci sözleşmesi geçti. Gerçek hesapla etkin oturum senaryosu ayrıca gerekli. |
| 8 | Hâkim konuya tekrar düzeyi bozmaz | Yerel PostgreSQL testi geçti; gerçek hesap E2E gerekli. |
| 9 | Deneme doğrulama/negatif net/alt toplam | Aşama 2 kodu ve yerel DB testleri geçti; canlı deneme kaydı kabulü bekliyor. |
| 10 | PDF inceleme/düzeltme/kayıt/tekrar | Yerel PDF ve atomik kayıt testleri geçti; özel bucket/RLS kuruldu. Canlı yükleme ve isteğe bağlı OpenAI çağrısı bekliyor. |
| 11 | Gerçek grafik/filtre/örnek sayısı | Aşama 2 hesaplama ve mock ekran testleri geçti; canlı sonuç verisiyle kabul bekliyor. |
| 12 | Google yalnız okuma ve scopes | İki salt okunur kapsam kodu ve mock testleri geçti. Uygulama OAuth akışı tamamlandı; sahibi için 3 takvim seçildi ve Calendar API okuması başarılı. Google'ın verdiği izin kapsamlarının bağımsız denetimi ve yeniden bağlama akışı ayrıca yapılmadı. |
| 13 | Calendar süre/görev üretmez | Takvim akışı ayrı salt okunur; mock testleri geçti. Gerçek Google bağlantısında tekrar doğrulanmalı. |
| 14 | Yetkisiz kullanıcı/MCP özel veri göremez | Yerel PostgreSQL RLS ve MCP kimlik doğrulama sözleşmesi testleri geçti; gerçek ChatGPT OAuth, HTTPS ve yetkisiz kullanıcı kabulü bekliyor. |
| 15 | AI anahtarsız çekirdek; sahte bağlantı yok | OpenAI anahtarı olmadan gerçek sahip girişi ve profil/katalog başlangıcı doğrulandı; tam kayıt akışı ayrıca kabul edilmeli. |
| 16 | Rapor/MCP tekrarları çift sonuç üretmez | Yerel rapor, günlük AI önerisi, tarihli çalışma ve MCP tekrar kontrolleri kodlandı/test edildi; gerçek sağlayıcı ve OAuth akışında mükerrer ücret/kayıt kabulü bekliyor. |
| 17 | Dışa alma/restore kimlik/ilişki korur | Aşama 4; henüz yapılmadı. |
| 18 | Mobil/masaüstü kullanılabilirliği | Masaüstü ve 360 px tarayıcı testleri/görselleri doğrulandı; gerçek Android kurulumu ve sağlayıcıya girişli akış ayrıca gerekli. |

## Yeniden çalıştırma

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:all
pnpm test:e2e
pnpm build
```

pnpm test ilerleme ve zaman birim testlerini; pnpm test:db PostgreSQL/servis testlerini; pnpm test:all ikisini birlikte çalıştırır. E2E için Playwright tarayıcısı ve test konfigürasyonunun beklediği yerel sunucu gerekir. Gerçek sağlayıcı kurulumu ayrı yapılır.

Gerçek kurulum sonrası minimum akış:

1. İzinli hesapla giriş ve yenileme; izin verilmeyen ikinci hesap ve oturumsuz API isteğinin reddi.
2. Görev/konu ekle-düzenle; ikinci cihazda yeniden oku; kısmi/tamamlanmış/geri alınmış durumlar.
3. Başlat-duraklat-sürdür-yenile-bitir; eşzamanlı iki başlangıç/tekrar bitirme.
4. Hedef ötesinde kapalı kalan geri sayım; gece yarısı aralığının doğru yerel günlere ayrılması.
5. Tema değişirken çalışan sayaç, mobil gezinme, dokunma hedefi ve yatay taşma.
6. Yalnız sentetik test verisi kullan. Üretim verisinde silme/üzerine yazma testleri yapılmaz.

## Kart zemini ve neon gezinme vurgusu

Son görsel düzeltmede kart renkleri korundu; geniş sayfa zemini sakin tamamlayıcı tonlara taşındı. Tek, sabit ve yüzde 15 yoğunluklu köşe geçişi kullanılır. Beyaz/Siyah temalarının nötr zemini korunur.

Seçili masaüstü ve mobil menü öğesi, ikinci halka rengiyle neon dolgu ve hafif parıltı kullanır. Koyu etiket metni parlak zeminde okunabilirliği korur; sade görünüm parıltıyı kapatır.

Gerçek boş API üzerinde 10 görünüm/gezinme kontrolü: Okyanus ve Gül açık/koyu, 360 px mobil menü, Bugün/Görevlerim/Ayarlar seçili durumu. Yatay taşma ve tarayıcı hatası görülmedi; seçili menü metni kontrastı Okyanus için 7.72–9.11:1, Gül için 9.87–10.94:1. Production build geçti. Yeni test verisi veya kalıcı test senaryosu eklenmedi.

Son gerçek ekranlar: [Okyanus koyu](../artifacts/canvas-nav-ocean-dark-desktop.png), [Okyanus açık](../artifacts/canvas-nav-ocean-light-desktop.png), [mobil](../artifacts/canvas-nav-ocean-dark-mobile.png), [mobil menü](../artifacts/canvas-nav-ocean-dark-mobile-menu.png).

## Tutarlı yüzey tonları — son renk düzeltmesi

24 Eylül 2026: Önceki geniş tamamlayıcı zemin ve köşe geçişi kaldırıldı. Ana zemin, menü, kart ve odak kartı artık aynı düşük doygunluklu renk ailesinin kademelerini kullanır. Karşıt renkler seçili menü, halkalar ve küçük vurgularda korunur. Tasarım gerekçesi ve incelenen kaynaklar: [renk sistemi](DESIGN.md).

Gerçek boş uygulama üzerinde 20 etkin tema/görünüm birleşimi kontrol edildi. Ana, ikincil ve vurgu metinlerinin zemin/kart/yükseltilmiş yüzey/menü üzerindeki en düşük kontrastı 4.72:1; seçili menü metni 4.5:1 üzerinde. Yatay taşma ve tarayıcı hatası görülmedi. 1440 px ve 1920 px masaüstü, açık/koyu Gül ve 360 px mobil ekranlar gözle incelendi. Production build geçti. Bu düzeltmede önceki veri ve hesaplama testleri tekrar çalıştırılmadı.

Güncel gerçek ekranlar: [Çelik koyu](../artifacts/coherent-steel-dark-wide-viewport.png), [Çelik açık](../artifacts/coherent-steel-light-desktop-viewport.png), [Gül koyu](../artifacts/coherent-rose-dark-desktop-viewport.png), [Gül açık](../artifacts/coherent-rose-light-desktop-viewport.png), [mobil](../artifacts/coherent-steel-dark-mobile.png).

## Aurora beyaz zemin ve yeşil geçişler

24 Eylül 2026: Orman ve Bordo seçilebilir temalardan kaldırıldı; toplam 9 seçenek var. Aurora sabit beyaz zemine alındı. Diğer temalar için kayıtlı açık/koyu/sistem tercihi korunur. Odak kartı, grafik çubukları ve ilk iki halka rengi geçiş kullanır; diğer kartlar beyazdır. Boş hesapta grafiklere değer eklenmez.

- Güncellenen mevcut 19/19 tarayıcı senaryosu geçti (5 görünüm, 14 kurulum/istemci sözleşmesi).
- Gerçek boş Aurora masaüstü ve mobil ekranları, yalnız HTTP yanıtlarında sentetik dolu grafikler incelendi. Yatay taşma veya tarayıcı hatası yok.
- Eski yerel ve sunucu tercihlerinde Orman → Grafit, Bordo → Gül dönüşümü doğrulandı. Açılışta API yazma isteği gönderilmedi.
- Aurora saklanan koyu tercihle de açık kaldı; diğer temaya dönünce tercih korundu. Metin kontrastı kontrolleri geçti.
- Production build ve değişen uygulama dosyalarının ESLint kontrolü geçti. Veri şeması ve hesaplama mantığı değişmedi.

Görseller: [gerçek boş masaüstü](../artifacts/aurora-real-empty-desktop-viewport.png), [gerçek boş mobil](../artifacts/aurora-real-empty-mobile.png), [sentetik dolu grafikler](../artifacts/aurora-synthetic-desktop-viewport.png), [grafik detayı](../artifacts/aurora-synthetic-daily.png). Sentetik kayıtlar yalnız izole test yanıtlarında bulunur. [Ek kontrol sonuçları](../artifacts/aurora-verification.json).

## Altı tema ve görev/grafik kartı geçişleri

24 Eylül 2026: Çelik Mavisi, Grafit ve Aurora seçenekleri kaldırıldı. Kalan 6 tema Gül, Okyanus, Mürdüm/Krem, Pastel, Beyaz ve Siyah. Varsayılan Okyanus; kayıtlı kaldırılmış temalar mevcut temalara eşlenir ve açılışta sunucuya yazılmaz.

Bugünün görevleri ve Çalışma ritmin kartları, mevcut odak/sayaç kartıyla aynı tema bazlı geçiş sistemine alındı. Parlak üst geçiş metinlerden ayrı; içerik koyu gövde üzerinde. Diğer kartlar ve sayfa zemini nötr kaldı. Sade görünüm dekoratif geçişi kapatır. Boş grafikte çalışma kaydı üretilmez.

Production build, TypeScript ve değişen uygulama dosyalarının ESLint kontrolü geçti. Gerçek boş Okyanus ekranı ve iki değişen kart gözle incelendi; geçişler doğru alanlarda, içerik okunabilir.

Güncel ekranlar: [görev kartı](../artifacts/gradient-cards-real-empty-ocean-dark-tasks.png), [çalışma grafiği](../artifacts/gradient-cards-real-empty-ocean-dark-rhythm.png), [masaüstü](../artifacts/gradient-cards-real-empty-ocean-dark-desktop.png).

Son doğrulama: 19/19 mevcut E2E testi geçti. 10 etkin tema/görünümün gerçek boş ve yalnız HTTP yanıtında sentetik dolu durumları olmak üzere 20 masaüstü görünümü kontrol edildi; görev/ritim kartı metinlerinde örneklenen en düşük kontrast 5.49:1. Mobil Okyanus, Gül ve Beyaz kontrollerinde taşma/üst üste binme yok; sayfa hatası ve görsel kontrol sırasında API yazma isteği görülmedi. [Görsel kontrol sonuçları](../artifacts/gradient-cards-audit.json).

## İsteğe bağlı örnek grafik önizlemesi

Kurulum yapılmamış boş çalışma alanında Bugün sayfası örnek grafik önizlemesini varsayılan olarak açar. Açık bir banner ve “Gerçek boş görünümü göster” düğmesi vardır; kullanıcı dilediğinde gerçek boş ekranı açabilir, sonra “Örnekleri göster” ile dönebilir. Seçim yalnız cihazın localStorage alanında tutulur.

Önizleme dört açıkça “Örnek ·” etiketli görev, bugün iki dersin bitmiş oturumları ve hafta içinde iki farklı gündeki süreleri gösterir. Görev, süre ve birleşik halkalar ile ders dağılımı ve haftalık çubuklar kısmen dolar. Örnek görevlerin değişiklik düğmeleri pasiftir. Kaynak AppState değiştirilmez; API veya veritabanına örnek kayıt yazılmaz. Kurulum yapılıp gerçek hesaba geçildiğinde örnek görünüm uygulanmaz. Gece yarısından hemen sonra da yalnız önizlemenin sanal saati ayarlanarak bugünkü grafikler dolu gösterilir.

Mevcut 10/10 ilgili tarayıcı senaryosu geçti: gerçek API boş kaldı, önizleme açık/kapalı ve yenileme tercihi çalıştı, mobilde yatay taşma yok, görsel kontrolde `/api/command` yazma isteği yapılmadı. Derleme, TypeScript ve hedefli ESLint geçti.

Görseller: [masaüstü örnek](../artifacts/gradient-cards-sample-preview-ocean-desktop.png), [mobil örnek](../artifacts/gradient-cards-sample-preview-ocean-mobile.png), [gerçek boş görünüm](../artifacts/gradient-cards-real-empty-ocean.png).

## YKS geri sayımı

Bugün sayfasının en altında Çalışma ritmin kartının yanında dört haneli YKS geri sayımı bulunur. Masaüstünde iki kart aynı satırda, dar ekranda alt alta görünür. Koyu, hafif ışıklı kart ve rakam kutuları seçilen altı temanın renk ailesini kullanır; sade görünümde dekoratif ışık kapanır.

Hesapta sınav tarihi kayıtlıysa gün/saat/dakika/saniye her saniye İstanbul saatine göre seçilen takvim gününün başlangıcına kadar hesaplanır. Karttaki düğme Ayarlar > Plan ve hedefler > Sınav tarihi alanını açar. Tarih yoksa gerçek görünüm dört çizgi ve tarih ayarlama çağrısı gösterir. Kurulum yapılmamış hesabın açık örnek önizlemesinde, bugünden 180 takvim günü sonrası yalnızca temsili tarih olarak gösterilir; resmî sınav tarihi olmadığı kartta belirtilir. Örnek tarih API veya veritabanına kaydedilmez.

Production build ve değişen dosyaların ESLint kontrolü geçti. İki odaklı Playwright testi örnek/gerçek ayrımını, canlı saniyeyi, ayar bağlantısını, altı temayı ve 360 px mobil taşma durumunu doğruladı. [Okyanus alt sıra](../artifacts/yks-bottom-charts-ocean.png), [Mürdüm alt sıra](../artifacts/yks-bottom-charts-plum.png), [Siyah mobil](../artifacts/yks-countdown-black-mobile.png).

## Animasyonlu çalışma sayacı odak ekranı

Çalışma zamanı kartının sağ altındaki Büyüt düğmesi, kaynağın konumundan tam ekran odak alanına animasyonla geçer. Küçült veya Escape aynı oturumu sürdürerek ana sayfaya döner; alttaki küçük sayaçtan yeniden açılabilir. Seçilen tema neon rakamlara, kutulara, halkalara ve zemine uygulanır. Hareket azaltma tercihi genişleme/küçülme ve rakam animasyonlarını kapatır.

50 dakika gibi bir saatin altındaki hedeflerde dakika/saniye; 70 dakika gibi hedeflerde saat/dakika/saniye kutuları gösterilir. Saat kutusu seçilmiş en az bir saatlik hedef boyunca korunur. Kronometrede saat dolunca saat kutusu eklenir. Büyük ekranda süre/ad seçimi, başlatma, duraklatma, sürdürme ve bitirme vardır. Başarısız kayıt ekranı kapatmaz; başarılı bitirmede son rakamlar sabitlenip kart küçülür.

Kurulum yapılmamış alanda açıkça Örnek sayaç olarak işaretlenen yerel deneme yapılabilir. Bu oturum tarayıcı belleğinde tutulur, API/veritabanına veya çalışma istatistiklerine eklenmez; sayfa yenilenince silinir. Hesap bağlıysa mevcut timer.start/pause/resume/finish komutları ve revision denetimi kullanılır.

Altı yeni odak testi ile 14 mevcut istemci/kurulum testi geçti. 50/70 dakika, tam ekranda gerçek başlatma komutu, saat sınırı, mola süresinin dışarıda kalması, küçültüp geri açınca sürenin korunması, başarılı/başarısız bitirme, örnekte sıfır API yazması, altı tema, Escape/klavye odağı ve hareket azaltma doğrulandı. 360×800 mobil ve 800×450 yatay görünümde yatay taşma yok; kısa ekranda içerik dikey kaydırılabilir. Production build, TypeScript ve hedefli ESLint geçti.

Görseller: [Gül odak ekranı](../artifacts/focus-timer-rose-desktop.png), [mobil](../artifacts/focus-timer-rose-mobile.png), [süre ayarı](../artifacts/focus-timer-setup-rose-mobile.png), [yatay ekran](../artifacts/focus-timer-rose-landscape.png).



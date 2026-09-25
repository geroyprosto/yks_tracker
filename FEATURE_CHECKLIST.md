# YKSim — Özellik tamamlanma kontrol listesi

Güncelleme: 25 Eylül 2026. **Aşama 1 ve 2 uygulaması için YKSim Free Supabase projesi Frankfurt'ta kuruldu; sekiz Aşama 1–2 migration'ı, tek sahip hesabı ve ilk Google Calendar API okuması doğrulandı. Aşama 3 AI raporu, 14 günlük sunucu işi, günlük AI alan önerisi, tarihli elle çalışma kaydı ve altı okuma/dört yazma araçlı MCP kaynağı yerel kodda hazır. Altı Aşama 3 migration'ı uzak veritabanına uygulandı (canlı toplam **14**); yeni günlük ve tarihli çalışma tablolarında RLS/RPC yetkileri doğrulandı. OpenAI hesabında 0 USD kredi var; bu teslimde ödeme, API anahtarı veya ücretli çağrı yapılmadı. Vercel hesabı/projesi ve HTTPS adresi yok, cron/MCP kapalı, Supabase OAuth keşif uçları 404; Audience hook ve MCP owner gateway migration'ları uzak veritabanına uygulandı; hook henüz OAuth Server'da yapılandırılmadı/etkinleştirilmedi, gateway policy/RPC uzak SQL denetimi tamamlandı. Gerçek AI, tarihli bulut yazma veya ChatGPT kabulü yapılmadı.** Tüm kapsam tamamlanmış değildir. Orijinal gereksinimler [docs/USER_REQUIREMENTS.md](docs/USER_REQUIREMENTS.md), kurulum sınırları [docs/PHASE3_SETUP.md](docs/PHASE3_SETUP.md) dosyasındadır.

Durumlar:

- **çalışıyor:** Belirtilen sınır içinde gerçekten doğrulandı.
- **kodlandı; canlı akış testi bekliyor:** Kod/şema mevcut; ilgili sağlayıcıyla tam kullanıcı akışı henüz kabul edilmedi.
- **kısmen kodlandı; canlı akış testi bekliyor:** Akışın bir kısmı çalışıyor; açık alt adım ve gerçek sağlayıcı testi bekliyor.
- **test edilmedi:** Kod veya taslak var; belirtilen davranış henüz doğrulanmadı.
- **henüz yapılmadı:** İleriki iş; bir ekran/menü bağlantısı özelliği tamamlamaz.

## Aşama 1

| Özellik | Durum | Kapsam / açık kabul |
| --- | --- | --- |
| Tam talimat, PRD ve 4 aşamalı plan | çalışıyor | Tam kullanıcı metni korundu; aşamalar/kabul koşulları yazıldı. |
| Next.js/React/TypeScript iskeleti ve lockfile | çalışıyor | Boş klasörde Node 24, Next 16.3.6 ve React 19.2.8 ile kuruldu. Tüm proje lint, typecheck ve production build geçti. |
| Türkçe, İstanbul günü, tr-TR, pazartesi | çalışıyor | İlk ekranlar ve zaman yardımcıları test edildi; ayrıntılı dönem raporları Aşama 2'de. |
| Boş başlangıç, sahte kişisel veri yok | çalışıyor | Gerçek yerel /api/state ve tarayıcı testi boş kişisel kayıtları; PostgreSQL testi sıfır düzeyli başlangıç kataloğunu doğruladı. |
| Duyarlı gezinme ve Bugün ekranı | çalışıyor | Gerçek kurulumsuz ekran masaüstünde ve 360 px genişlikte test edildi, görseller incelendi. Girişli gerçek sağlayıcı akışı bekliyor. |
| 6 etkin tema (Gül, Okyanus, Mor, Pastel, Beyaz, Siyah), açık/koyu/sistem, az hareket/sade görünüm | çalışıyor | Yerel görünüm/kalıcılık testleri geçti. Hesap eşitlemesi ve etkin sayaç istemci davranışı HTTP mock ile denendi; gerçek Supabase kabulü gerekli. |
| Tamamlayıcı renkler, kalın neon halkalar ve ders dağılımı | çalışıyor | Altı etkin temada sakin zemin, karşıt vurgu renkleri, 28 px halka ve sayısal dağılım. Kurulumsuz önizleme ve gerçek boş görünüm ayrıdır. |
| Günlük soru/test kaydı ve gün/hafta/ay analizi | kodlandı; canlı akış testi bekliyor | TYT/AYT ders kayıtları; ekleme/düzenleme/silme, önceki eş dönem farkı, ders ve sınav dökümleri hazır. 5 hesaplama ve 18 yerel DB testi geçti; altı tema ve 360 px görsel kontrol edildi. Supabase migration ve sahip hesabı bulutta kuruldu; kalıcı kayıt için canlı ekleme/düzenleme testi bekliyor. Kurulumsuz örnekler açıkça etiketli ve veritabanına yazılmaz. |
| Sahip hesap giriş/API kimlik doğrulaması | kodlandı; canlı akış testi bekliyor | Yerel URL/publishable anahtar, doğrulanmış Auth hesabı, ALLOWED_USER_EMAIL ve tek sahip allowlist kuruldu. Gerçek giriş sonrası sahip profili ve başlangıç konu kataloğu doğrulandı; oturum yenileme ve tüm API yolları ayrıca kabul edilmeli. |
| RLS ve sahiplik | kodlandı; canlı akış testi bekliyor | Yerel PGlite'da anonim/başka kullanıcı reddi geçti; bulutta RLS ve özel PDF bucket policy'leri doğrulandı. Gerçek farklı kullanıcı ve oturumsuz HTTP denemesi gerekli. |
| PostgreSQL kalıcılığı ve cihazlar arası okuma | kodlandı; canlı akış testi bekliyor | DB/API kodu; iki cihazda gerçek kayıt doğrulanmadı. |
| Ders/konu/alt konu modeli ve başlangıç kataloğu | kodlandı; canlı akış testi bekliyor | Başlangıç listesi resmî eksiksiz 2027 kapsamı değildir. |
| Konu arama/filtre/ekleme/düzenleme | kodlandı; canlı akış testi bekliyor | Gerçek ekleme/düzenleme ve mobil akış testi gerekli. |
| Öğrenme düzeyi/çalışma türü ayrımı ve geçmiş | kodlandı; canlı akış testi bekliyor | Tekrarın düzeyi bozmadığı ve geçmiş kaydı yerel PostgreSQL testinde geçti. Gerçek girişli UI gerekli. |
| Konu kaynak/not/sonraki adım | kodlandı; canlı akış testi bekliyor | Mevcut alanların gerçek kayıt testi gerekli. |
| Konu test/soru/yardım sonuçları ve hâkimiyet önerisi | henüz yapılmadı | Test/soru sonuçları, yardım ihtiyacı ve son çalışma tarihi alanları eksik. Hâkimiyet önerisi ayrı günlerde doğruluğa dayanmalı. |
| Görev ekleme/düzenleme, tarih/konu/kaynak/dakika/zorluk/öncelik | kodlandı; canlı akış testi bekliyor | Form → transaction → yeniden yükleme gerçek hesapta doğrulanmalı. |
| Görev taşıma/sıralama/geri alma/kısmi ilerleme | kodlandı; canlı akış testi bekliyor | Atomik yukarı/aşağı sıralama ve eski sürüm reddi yerel PostgreSQL'de geçti; gerçek hesap UI testi gerekli. |
| Görev alt adımları ve ana ağırlığın paylaşılması | kodlandı; canlı akış testi bekliyor | Eşit adım payı ve çift sayılmama birim/yerel PostgreSQL testleri geçti; gerçek hesap UI testi gerekli. |
| Görev şablonları | henüz yapılmadı | Yeniden kullanılabilir kullanıcı şablonları. |
| Test/sayfa/soru hedefinin ayrı sayısal alanları | henüz yapılmadı | Mevcut açıklama/tamamlanma ölçütü tüm analitik alanların yerine geçmez. |
| 120/400=%30; kısmi/özel ağırlık | çalışıyor | src/lib/progress.ts için birim test geçti. |
| 3/6 saat=%50; birleşik %70/%50=%64 | çalışıyor | Saf hesaplama testleri geçti; gerçek molasız süre kaynağı ayrı kabul. |
| Boş/sıfır hedef, tanımsız bileşen ve aşım | çalışıyor | Saf hesaplama testleri geçti; halkaların UI testi ayrı kabul. |
| Özel katsayı/pay, günlük/hafta günü hedefleri | kodlandı; canlı akış testi bekliyor | Özel katsayı birim, geçmiş plan PostgreSQL ve hedef formu HTTP mock testleri geçti; gerçek hesap kabulü gerekli. |
| Günlük plan/puanlama snapshot sürümleri | kodlandı; canlı akış testi bekliyor | Önceki gün snapshot'ını koruma yerel PostgreSQL testinde geçti; gerçek hesap kabulü gerekli. |
| Dinlenme günü ve kayıt eksikliği ayrımı | kodlandı; canlı akış testi bekliyor | Dinlenme, doğrulanmış sıfır, eksik ve açık gün raporda ayrı; işaretler sürümlü yerel DB komutuyla saklanır. |
| Kronometre/geri sayım ve görev bağlamı | kodlandı; canlı akış testi bekliyor | Süre hesaplama birim testi geçti; gerçek başlangıç/bitirme gerekli. |
| Duraklat/sürdür, kalıcı aktif aralıklar | kodlandı; canlı akış testi bekliyor | Mola dışlama, yenileme ve yeniden açılma gerçek hesapta denenmeli. |
| Tek etkin oturum, tekrar anahtarı ve sürüm | kodlandı; canlı akış testi bekliyor | Tek etkin oturum ve tekrar güvenliği yerel PostgreSQL testinde geçti. Gerçek eşzamanlı iki cihaz kabulü gerekli. |
| Geri sayım hedefinde sınırlama | kodlandı; canlı akış testi bekliyor | Uzun kapalı kalma sonrası hedef sınırı yerel PostgreSQL testinde geçti; gerçek tarayıcı/provider kabulü gerekli. |
| Oturum düzeltme/uzun çalışma onayı | kodlandı; canlı akış testi bekliyor | 6 saat üstü onay ve azaltarak düzeltme yerel PostgreSQL'de geçti. Bitmiş oturum düzeltme ekranı ve zorunlu neden alanı HTTP mock testinde geçti; süre artırma henüz yok. |
| Tarihli elle çalışma süresi kaydı | kodlandı; canlı akış testi bekliyor | Tarih, ders ve 1–1440 dakika açık onayla ayrı `manual_study_entries` kaydına yazılır; sayaç başlangıç/bitiş saati uydurulmaz. Gün toplamı, ders dağılımı ve kayıt geçmişine katılır. Migration uzak projeye uygulandı; gerçek sahip kaydı bekliyor. |
| Yerel gece yarısında aralık bölme | çalışıyor | 10 zaman birim testi içinde İstanbul günü, çoklu gün ve 23/25 saatlik yaz saati geçişleri doğrulandı. Gerçek sağlayıcı rapor akışı ayrı kabul. |
| İsteğe bağlı kısa/uzun mola döngüsü | henüz yapılmadı | Pomodoro süresine zorlama yapılmayacak. |
| Focus To-Do doğrulanmış adapter / CSV-JSON eşleme | henüz yapılmadı | Resmî API/dışa aktarma örneği incelenmedi; bağlantı iddiası yok. |

## Aşama 2

| Özellik | Durum | Kapsam / açık kabul |
| --- | --- | --- |
| Sürümlü TYT/AYT Sayısal/branş formatları | kodlandı; canlı akış testi bekliyor | TYT ve AYT alt dersleri sürümlü şablonda tutulur; branşın kendi soru sayısı vardır. Yerel DB testleri geçti; ilgili migration buluta uygulandı. Gerçek deneme kaydı kabulü gerekli. |
| Deneme giriş/düzenleme, net/puan/sıralama ayrımı | kodlandı; canlı akış testi bekliyor | Doğru/yanlış/boş veya yalnız net, eksik ders, negatif net ve ayrıca raporlanan genel net desteklenir. Puan ve sıralama ayrı alanlardır; revizyon, RLS ve audit yerel DB'de test edildi. |
| Gerçek sonuç grafikleri, filtre/ortalama/örnek sayıları | çalışıyor | Grafik kayıt listesinden hesaplanır; yayın, tür, alt ders, dönem ve ölçü filtreleri; tek kayıt, hafta ve ay ortalaması; n sayısı ve boş dönem ayrımı birim testlerinde doğrulandı. Kurulumsuz örnekler açıkça etiketlidir. |
| Gün/hafta/ay/yıl/özel süre raporları | çalışıyor | Yalnız aktif aralıklar ve İstanbul günleri kullanılır. Ders, konu ve çalışma türü dağılımı; günlük bağlantılar; dinlenme, doğrulanmış sıfır ve eksik kayıt ayrımı vardır. Gerçek bulut hesabı kabulü bekliyor. |
| PDF özel yükleme/çıkarma/inceleme/düzeltme | kısmen kodlandı; canlı akış testi bekliyor | 10 MiB/10 sayfa sınırı, özel Storage, metin çıkarma, kaynak sayfası, aday seçimi, elle düzeltme ve açık kaydetme hazır. Taranmış ilgili sayfalar, varsayılan kapalı yükleme onayı verilirse sunucuda JPEG'e çevrilip OpenAI Responses API ile öneri çıkarabilir; otomatik deneme kaydı yoktur. Kod/birim testleri geçti; OPENAI_API_KEY ve canlı sağlayıcı kabulü bekliyor. [Ayrıntı](docs/PDF_IMPORT_OCR.md). |
| PDF hash/parmak izi/idempotency | kodlandı; canlı akış testi bekliyor | SHA-256 aynı dosya tespiti, olası mükerrer uyarısı, aday başına tek kayıt, transaction içinde deneme+provenans+audit ve tekrar anahtarı yerel DB'de test edildi. Özel bucket ve RLS/policy bulutta doğrulandı; gerçek yükleme/indirme ve mükerrer kayıt akışı denenmedi. |
| Serbest günlük ve isteğe bağlı alanlar | kodlandı; canlı akış testi bekliyor | Orijinal metin korunur; yapılandırılmış alanlar isteğe bağlıdır. İstanbul tarihine tek kayıt, düzenleme/silme, analizden çıkarma ve AI'ye alan bazlı paylaşım seçimi yerel DB'de test edildi. AI analizi Aşama 3'tedir. |
| Salt okunur Google OAuth/takvim seçimi/kesme | çalışıyor | Uygulama OAuth izin akışı tamamlandı; yerel sunucuda Google istemci bilgileri ve sunucu Supabase secret key ayarlı. Bulutta sahip hesabına ait 1 bağlantı, 3 seçilmiş takvim ve başarılı ilk Calendar API okumasını gösteren last_success_at doğrulandı. Bağlantıyı kesme, yeniden bağlama, izin iptali ve token yenileme canlı denenmedi. |
| Bugünün Programı/yenileme/özel etkinlik halleri | kodlandı; canlı akış testi bekliyor | Seçili üç takvimden en az bir canlı API okuması başarılı. Saatli, tüm gün, tekrar eden, iptal edilen ve gece yarısı aşan etkinlikler; elle/odak/5 dk yenileme ve bağlantı durumları mock testlerinde geçti. Bu özel olay türleri ve farklı günlerin gerçek hesap ekranı henüz kabul edilmedi; etkinlik süreleri çalışma kaydı sayılmaz. |
## Aşama 3

| Özellik | Durum | Kapsam / açık kabul |
| --- | --- | --- |
| OPENAI_MODEL ve gerçek model erişim kontrolü | kodlandı; canlı akış testi bekliyor | Yapılandırılabilir model ve `/v1/models/{model}` erişim kontrolü var; gpt-6-astra aday, API hesabında erişim doğrulanmadı. |
| Sunucuda AI, bütçe/istek sınırı, kullanım/maliyet | kodlandı; canlı akış testi bekliyor | Sunucu Responses API, şemalı çıktı ve `store:false` kullanır; aylık istek/tahmini USD sınırı SQL ile uygulanır. Dört Aşama 3 migration'ı uygulandı; altı tabloda RLS ve ilgili RPC yetkileri doğrulandı; API anahtarı ve gerçek kullanım testi bekliyor. OpenAI proje sert harcama sınırı ayrıca kurulmalı. |
| İzinli günlük düzenleme ve dönem analizi | kodlandı; canlı akış testi bekliyor | Deterministik özet, seçilmiş günlük alanları, kaynak/eksik günler ve kullanıcı isteğiyle rapor UI/API hazır. Gerçek sağlayıcı çağrısı yapılmadı. |
| MCP analiz kaynakları (`get_analysis_sources`) | kodlandı; canlı akış testi bekliyor | Varsayılan son 14, en çok 31 İstanbul günü için hesaplanmış özet ve günlük kaynakları döner. Yalnız açıkça AI ile paylaşılan günlük alanları yer alır; analiz dışı günlük ve paylaşılmamış metin çıkmaz. Eksik gün sıfır sayılmaz; araç ücretli model çağrısı veya rapor yazması yapmaz. Gerçek ChatGPT/OAuth kabulü yok. |
| Günlük metninden isteğe bağlı AI alan önerisi | kodlandı; canlı akış testi bekliyor | 3–4.000 karakter kullanıcı düğmesiyle sunucuya gönderilir; yalnız metinde dayanağı olan alanlar önerilip gözden geçirilir, boş alanlara istenirse uygulanır ve ayrıca kaydedilir. Dönem analizi paylaşım seçimi değişmez. Raporlarla ortak aylık sınır kullanılır; migration uzak projeye uygulandı; API anahtarı ve ücretli çağrı yok. |
| Kullanıcı etkinleştirmeli 14 günlük sunucu işleri | kodlandı; canlı akış testi bekliyor | Başlangıç günü ve açık opt-in, günlük Vercel cron yolu, `CRON_SECRET`, 14 günlük pencere ve işlem durumu var. Vercel yayını ve zamanlanmış canlı çağrı henüz yok. |
| Geçmiş raporlar ve veri değişince eskime | kodlandı; canlı akış testi bekliyor | Kaynak özeti/hash, saklı rapor, eski veri işareti ve aynı dönem/veri için tekrar isteği önleme kodu var. İki Aşama 3 migration'ı buluta uygulandı; gerçek tekrar çağrı kabulü bekliyor. |
| Yetkili OAuth/MCP dar okuma-yazma araçları | kısmen kodlandı; canlı akış testi bekliyor | `/api/mcp` varsayılan kapalı; JWT imzası/issuer/audience/client_id/sahip kontrolü ile altı okuma ve dört idempotent yazma aracı (`create_task`, `create_study_session`, `create_exam`, `update_topic_status`); yeni okuma aracı `get_analysis_sources` var. Sahip girişli `/oauth/consent` ve onay/ret API yolları kodlandı; Supabase OAuth Server, Authorization Path, OAuth istemcisi/DCR, kaynak audience ve gerçek ChatGPT akışı henüz kurulup doğrulanmadı. OAuth keşif uçları 404. Audience hook ve owner gateway uzak veritabanına uygulandı. Hook yapılandırılıp etkinleştirilmeden, doğrudan Data API/Storage erişimi reddi gerçek OAuth akışında doğrulanmadan MCP açılmamalı. |
| OAuth Data API/Storage güvenlik geçidi | kısmen kodlandı; canlı akış testi bekliyor | [Uygulanan gateway migration'ı](supabase/migrations/20260925182000_mcp_owner_gateway.sql) OAuth `client_id` taşıyan JWT'nin sahip tabloları ve özel PDF Storage'a doğrudan erişimini restrictive RLS ile reddetmeyi, normal tarayıcı oturumlarını korumayı hedefler. Sunucu doğrulanmış sahip için secret key ile `mcp_owner_state`/`mcp_owner_command` çağırır; yalnız `task.create`, `manual_study.create`, `exam.create`, `topic.update` izinli. Audience hook da uzak veritabanına uygulandı ama OAuth Server'da yapılandırılmadı/etkinleştirilmedi; policy/RPC uzak SQL denetimi tamamlandı; gerçek red/izin kabulü henüz yapılmadı, MCP kapalı. |
| ChatGPT tarihli çalışma süresi aktarımı | kısmen kodlandı; canlı akış testi bekliyor | `create_study_session` yalnız kullanıcı onaylı tarih, ders, 1–1440 dakika ve UUID `request_id` alır; sahte saat aralığı üretmez. `list_study_sessions` bitmiş sayaç ve tarihli elle kayıtları sınırlı döndürür. Migration uzak projede, yerel test kodu hazır; gerçek OAuth/MCP ve bulut yazma kabulü yok. |
| ChatGPT konu öğrenme düzeyi güncelleme | kısmen kodlandı; canlı akış testi bekliyor | `update_topic_status` açık onay, UUID `request_id`, `list_topics` ile bulunan tam konu kimliği/sürümü ve 0–4 öğrenme düzeyi ister. Eski sürüm reddedilir; aynı istek anahtarı tekrarında yeni değişiklik yapılmaz. Yerel araç kodu/testi var, gerçek OAuth/MCP kabulü yok. |
| ChatGPT PDF/şemalı deneme veri aktarımı | kısmen kodlandı; canlı akış testi bekliyor | `create_exam` yalnız yapılandırılmış deneme sonucunu, `confirmed_by_user=true` ve UUID `request_id` ile kabul eder; PDF/dosya yolu/URL alamaz. Kullanıcı onayı ve tekrar güvenliği gerçek ChatGPT bağlantısında doğrulanmadı. |

## Aşama 4 ve yayın

| Özellik | Durum | Kapsam / açık kabul |
| --- | --- | --- |
| PWA manifest/ikon/temel service worker | test edilmedi | İlk iskelet; kurulabilirlik ve telefon testi gerekli. |
| IndexedDB çevrimdışı görev/sayaç kuyruğu | henüz yapılmadı | Şimdiki çevrimiçi gereksinim açıkça gösterilmeli. |
| İki cihaz çevrimdışı çakışma incelemesi | henüz yapılmadı | Sessiz toplama/veri ezme olmayacak. |
| Çıkışta yerel hassas veri ve kuyruk yaşam döngüsü | henüz yapılmadı | Kuyruk eklendiğinde eşitlenmemiş kayıt uyarısı. |
| Yanlış/takılma arşivi ve tekrar kuyruğu | henüz yapılmadı | Otomatik başarısız konu ilan edilmez. |
| Haftalık/aylık yol haritası | henüz yapılmadı | Günlük görev → haftalık → aylık ilişkiler. |
| Sürümlü JSON, CSV ve geri yükleme | henüz yapılmadı | Kimlik/ilişki korunacak; üzerine yazma açık onaylı. |
| Test edilmiş yedek geri dönüşü | henüz yapılmadı | Kurulumdan sonra ayrı test ortamında doğrulanmalı. |
| Tam güvenlik/yetki/OAuth/yükleme incelemesi | test edilmedi | İlk RLS/server sınırları tam güvenlik denetimi değildir. |
| Tam erişilebilirlik ve gerçek Android/Windows E2E | test edilmedi | Masaüstü/360 px tarayıcı ve modal hata görünürlüğü kontrolleri geçti. Tam erişilebilirlik denetimi, gerçek Android kurulumu ve sağlayıcı girişi yapılmadı. |
| GitHub push / Vercel canlı yayın | henüz yapılmadı | Vercel hesabı/proje bağlantısı ve HTTPS/üretim kurulum adımları gerekir; henüz görünmüyor. |

## Teslimin dürüst sınırı

Bu turda `pnpm test:all` **169/169** (51 PGlite veritabanı testi dahil), lint ve typecheck geçti. Production build de son gateway/analiz aracı koduyla geçti. Günlük AI önerisi için odaklı tarayıcı testi **1/1** geçti. İlk tam E2E'deki eski “Oturumlar” seçicisi “Kayıtlar” adına güncellendi; ardından tam `pnpm test:e2e` **49/49** geçti. Önceki OCR turundaki **104/104** birleşik ve **34/34** Playwright sonuçları tarihsel kanıttır. Altı tema için 1440/360 px önceki görsel kontrol yapıldı. Yerel test ve HTTP mock sonuçları ücretli OpenAI, gerçek bulut yazması, cron veya ChatGPT OAuth kabulü değildir.

YKSim Free Supabase projesi (`efekpsnejfxiilfkjfar`, Frankfurt), sekiz Aşama 1–2 migration'ı, özel PDF bucket/RLS ve doğrulanmış sahip hesabı kuruldu. Gerçek giriş sonrası bulutta sahip profili ve başlangıç konu kataloğunun oluştuğu doğrulandı. Google OAuth bağlantısı, üç takvim seçimi ve ilk Calendar API okuması canlı doğrulandı. Canlı yazma/iki cihaz, özel PDF yükleme, Google bağlantı uç durumları ve OpenAI görsel okuma çağrısı henüz kabul edilmedi. Altı Aşama 3 migration'ı uygulandı; toplam 14. İlk dört analiz tablosuyla yeni `journal_ai_suggestions` ve `manual_study_entries` tablolarında RLS, ilgili RPC yetkileri doğrulandı. Audience hook ve MCP owner gateway migration'ları uzak veritabanına uygulandı (uzak sürümler `20260925171059`, `20260925171128`). Hook OAuth Server'da yapılandırılmadı/etkinleştirilmedi; gateway policy/RPC uzak SQL denetimi tamamlandı; gerçek Data API/Storage red testi bekliyor. Gerçek AI raporu/önerisi, tarihli bulut kaydı, 14 günlük üretim işi ve ChatGPT OAuth bağlantısı yapılmadı. [docs/SETUP.md](docs/SETUP.md) genel kurulumu, [docs/PHASE3_SETUP.md](docs/PHASE3_SETUP.md) dış adımları ve [docs/TESTING.md](docs/TESTING.md) test kanıtını açıklar.
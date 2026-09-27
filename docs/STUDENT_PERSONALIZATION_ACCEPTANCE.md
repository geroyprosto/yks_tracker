# Kabul ve yayın durumu

Yerel geliştirme 27 Eylül 2026 tarihinde `codex/student-personalization` dalında yapıldı. Production migration, dağıtım, gerçek kişiye mesaj/e-posta, ücretli sağlayıcı denemesi veya plan yükseltmesi yapılmadı.

## Doğrulama kapsamı

- Mevcut başlangıç birim paketi: 155/155 geçti.
- Tam birim + SQL paketi: `pnpm test:all` — **266/266 geçti; atlanan test yok**.
- Tip/lint/derleme: `pnpm typecheck`, `pnpm lint`, `pnpm build` — tamamı geçti.
- Genel tarayıcı paketi: `pnpm exec playwright test` — **70/70 geçti**.
- Gerçek yerel RPC kullanan tarayıcı paketi: `pnpm exec playwright test --config playwright.classroom.config.ts` — 14/14 geçti. Her çalıştırma yeni, yalıtılmış PGlite veritabanı kullanır.
- Sentetik AI değerlendirme: `pnpm exec tsx scripts/evaluate-student-reports.ts` — altı çevrimdışı senaryo. Modelin gerçek üretim kalitesi ölçülmüş değildir.

Tarayıcı testleri Windows/Edge/Playwright ortamındadır. 360 px mobil, masaüstü, klavye, tema, azaltılmış hareket ve taşma kontrolleri içerir. Gerçek telefon, VoiceOver/NVDA veya gerçek Supabase Auth/Storage kabulü yerine geçmez. Görsel kontroller `artifacts/student-personalization-desktop.png` ve `artifacts/student-personalization-mobile.png` üzerinde de yapıldı.

## Kabul senaryoları

| Senaryo | Yerel kanıt |
|---|---|
| A: Üniversite, dört ders, sayaç, toplu puan ve ders grafiği | `tests/classroom-e2e/student-personalization.spec.ts`; gerçek yerel RPC |
| B/C/D: Lise + YKS, hedef aç/kapat, eski YKS veri/net/süre korunması, okul/YKS ayrımı | `tests/education.test.ts`, `supabase/tests/education.test.ts`, `tests/education-ui.test.ts` |
| E: Dönem arşivi, yeniden adlandırma, oturum bağlamı | Eğitim SQL testleri; aktif oturumda dönem/profil değişimi reddedilir, ad snapshot’ları korunur |
| F/G: Boş/sıfır/87,5/16–20/tarih/CSV, farklı tür/ölçek | `tests/school-results.test.ts`, `tests/e2e/school-results.spec.ts`; tür/ölçekler anlamlarına göre ayrılır |
| H: Yeniden gönderimde çift kayıt, geç gelen GET | SQL makbuz testleri, yanıt kaybıyla tekrar gönderim; `tests/e2e/student-personalization.spec.ts` eski GET ve 409 sonrası veri yenileme senaryoları |
| I: Sahiplik, onay ve rol ayrımı | Eğitim SQL testleri + mevcut sınıf/Storage/MCP testleri; başkasının ders/dönem/sonuç kimliği reddedilir |
| J: Kesinleşmiş süre değişmez, puan değişebilir | Normal komut, doğrudan SQL, aralık ekleme/taşıma/düzeltme/silme testleri; sınav puanı revizyon testi |
| K: Tek üretim, ayda dört, ortak hesap/bütçe ve sınır yarışı | `supabase/tests/ai-pilot.test.ts`; rapor + günlük ortak kota, İstanbul ayı, rezervasyon, belirsiz gönderim |
| L/M: AI kapalı çekirdek, az veri, şema ve eski rapor | Çekirdek E2E’de bütün sağlayıcı anahtarları boş; AI şema/provider mock testleri; eski rapor görüntüleme |
| N: Kurulum/ayar/taslak/geri/iptal/mobil | Kurulum E2E ve genel tarayıcı testleri; aynı kurulum bileşeni iki akışta kullanılır |
| O: Altı ay ve 20 kullanıcı | Eğitim SQL paketinde 3.600 oturum/aralık + 960 sonuç, 20 eşzamanlı Promise gönderimi; PGlite işlemleri kuyrukta seri yürütür |

O testi ayrı yerel veritabanında çalışır. Gerçek PostgreSQL bağlantı havuzu, 20 eşzamanlı HTTP kullanıcısı, ağ gecikmesi ve Supabase üretim kapasitesi **ölçülmedi**. Yerel kuyruk süreleri üretim kapasitesi iddiası değildir. Ayrı staging erişimiyle bu kabul tamamlanmalıdır.

Migration testi önceki görev, konu, konu geçmişi, deneme, net, oturum, manuel süre ve aralık kayıtlarını snapshot ile karşılaştırır. Yeni nullable `course_id` ilişkileri hariç geçmiş kayıtlar ve önemli süre/net toplamları aynı kalır. Belirsiz çıplak ders etiketleri değiştirilmez. YKS konu hâkimiyeti sınav puanından türetilmez.

## AI şeması ve maliyet kararı

Yeni rapor `schema_version: 2`, `overview`, `study_observations`, `result_observations`, `next_actions`, `limitations` alanlarından oluşur. Başlıklar UI’da sabittir. Genel durum 35, gözlem 25, öneri 20 kelime sınırındadır; dizi uzunlukları 2/2/3/2, toplam üst sınır 250 kelimedir. Sunucu şemayı, kelime sayısını, yinelenen metni ve izinli `evidence_ids`/`course_id` değerlerini ayrıca doğrular. Yarım/red/geçersiz cevap tamamlanmış rapor olmaz; otomatik ücretli düzeltme veya pahalı modele geçiş yoktur.

Son 7/14/30 günün hesaplanmış özeti gönderilir. Okul puanları ve YKS netleri ayrı tutulur; ham PDF, bütün geçmiş, kullanıcı adı/e-posta ve paylaşılmamış günlük alanları gönderilmez. Eski düz metin raporları saklanır. Rapor açmak çağrı yapmaz; kaynaklar değiştiğinde tarihli rapor korunur ve değişiklik işaretlenir. Yeni öneriler otomatik görev oluşturmaz.

Başlangıç değerlendirme adayı sunucu ayarı `OPENAI_MODEL=gpt-4.1-mini-2025-04-14`. 27 Eylül 2026’da resmi belgelerden Responses/Structured Outputs desteği ve 1 milyon token başına $0,40 giriş / $1,60 çıkış / $0,10 önbellekli giriş fiyatı kontrol edildi: [model belgesi](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Bu fiyat doğrulaması hesapta modele erişim veya Türkçe kalite testi değildir.

Çevrimdışı paket YKS, lise, üniversite, az veri, farklı ölçekler ve talimat enjeksiyonu içerir. Gerçek model kalitesi, gecikme, sağlayıcı token tüketimi ve gerçek fatura **ölçülmedi**. Açık ücretli test onayı sonrası değerlendirme komutunun `--paid-approved` yolu, `AI_EVAL_ISOLATED=true` ve altı ayrı sentetik `AI_EVAL_ACCOUNT_IDS` gerektirir. Bu yol da uygulamanın kota/bütçe mekanizmasını kullanır.

Hesap kotası sunucu/SQL tarafında sabit dört kullanımdır; Europe/Istanbul takvim ayı ve sunucu saati kullanılır. Rapor + mevcut günlük önerisi bu hakkı paylaşır. Uygulama USD bütçesi `private.ai_budget_policy` ile ayrıca kontrol edilir. `private.ai_application_usage` hesap silinse de uygulama harcamasını korur. Gönderim öncesi atomik rezervasyon yapılır; kesin gönderilmemiş hata iade edilir, gönderim sonrası belirsizlik rezervasyonu korur. Operatör `private.ai_reconcile_unbilled` işlemini yalnız sağlayıcıdan ücret oluşmadığına dair kanıtla kullanabilir; işlemin denetim kaydı vardır.

Model yanıtındaki token sayıları sağlayıcı kullanım bilgisidir; USD karşılığı yapılandırılmış fiyat üzerinden hesaplanır, fatura diye sunulmaz. `.env.example` bütçesi örnektir. Pilot sürümünde otomatik rapor ve ücretli PDF görsel okuma kapalıdır; mevcut metin tabanlı YKS PDF inceleme/önizleme korunur.

## Canlıya geçiş ve geri dönüş

1. Ayrı staging ortamında tam migration sırasını, RLS/Data API/Storage erişimini, Auth doğrulama/onay akışını, 20 eşzamanlı kullanıcıyı ve gerçek cihaz kabulünü tamamla.
2. Yedek al; canlı kayıt sayıları, net ve kesinleşmiş süre toplamlarını karşılaştırılabilir biçimde çıkar. Belirsiz etiket raporunu incele. Production migration için ayrı onay al.
3. Kod ve iki yeni migration birlikte yayınlanmalıdır; yeni API eski şemayla kullanılmamalıdır. Öğrenci/öğretmen onayı ve sınıf görevleri yeniden kontrol edilmelidir.
4. AI varsayılan kapalı kalır. Açmak için ayrıca onaylı bütçe kararı, anahtar/model/fiyat ayarları, `AI_ENABLED=true` ve `private.ai_budget_policy` etkinliği gerekir. `.env.example` tek başına DB kapısını açmaz. Gerçek sağlayıcı kabulü bu aşamada yapılır.
5. Sorunda AI’yı ortam değişkeni ve/veya DB politikasıyla kapat. Uygulama kodunu geri alırken veri tablolarını ve güvenlik korumalarını silme. Yeni eğitim verisini arşivle/koru; yıkıcı otomatik geri migration yoktur.

Önceki özel MCP/OAuth hook, gerçek Data API/PDF Storage reddi ve üretim sağlayıcısı kabulü gibi doğrulanmamış yayın işleri bu çalışmayla tamamlanmış sayılmaz. Öğrenci günlük/takvim paylaşımı genişletilmedi. Üretim dağıtımı ve ücretli değerlendirme ayrı onay isteyen adımlardır.

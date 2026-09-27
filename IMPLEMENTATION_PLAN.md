# YKSim — Uygulama planı

Güncelleme: 25 Eylül 2026. Öncelik: veri doğruluğu ve gizlilik → günlük kullanım → gerçek bağlantılar → görsel ayrıntılar. Aşama 1 ve 2 uygulaması Supabase'de tek sahip ve Google Takvim okumasına kadar kuruldu; bazı gerçek sağlayıcı kabul senaryoları bekliyor. Aşama 3'ün AI raporları, zamanlayıcısı ve MCP temeli yerel kodda hazır; iki yeni migration uzak veritabanına uygulandı; dört yeni tabloda RLS ile schedule RPC yetkileri doğrulandı. OpenAI anahtarı, Vercel yayını ve Supabase OAuth Server kurulumu yok; sahip izin ekranı ve onay/ret API yolları kodlandı. Tüm ürün henüz tamamlanmadı. Tam kapsam [PRD.md](PRD.md), uygulama durumu [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md), [Aşama 3 kurulum rehberi](docs/PHASE3_SETUP.md) ve asıl talimat [docs/USER_REQUIREMENTS.md](docs/USER_REQUIREMENTS.md) içindedir.

## Başlangıç bulguları ve kararlar

- Başlangıç klasörü boştu. Next.js 16.3.6, React 19.2.8, TypeScript, Tailwind 4 ve Supabase istemcileriyle yeni iskelet kuruldu; Node.js 24 ve pnpm lockfile kullanılıyor.
- Kod yazmadan kurulu Next.js belgeleri okunur; eski middleware/API örnekleri varsayılmaz.
- Gerçek kullanıcı verisi bulunmadığı için boş başlangıç; konu kataloğu ilerleme kaydı değildir.
- PostgreSQL tek kalıcı kaynak. Eksik Supabase kurulumu açıkça görünür; tarayıcı belleği gerçek senkronizasyon gibi sunulmaz.
- Kullanıcının onayıyla ücretsiz Supabase projesi ve Google Takvim OAuth bağlantısı önceki aşamada kuruldu. Bu Aşama 3 çalışmasında analysis ve schedule RPC yetki daraltma migration'ları uzak projeye uygulandı; dört tabloda RLS ve schedule RPC yetkileri doğrulandı. Ücretli OpenAI çağrısı, GitHub push veya Vercel yayını yapılmadı.
- İş kuralları paylaşılan domain/servis katmanında; sonraki MCP aynı işlemleri çağıracak.
- Doğrulanmayan 2027 tarihi boş kalır; konu listesi “düzenlenebilir başlangıç listesi” etiketi taşır.

## Aşama 1 — Günlük kullanıma temel

**Çıktı:** Türkçe, duyarlı arayüz; gerçek kayıt için kurulabilir güvenli Supabase altyapısı; konu ve görev akışı; ağırlıklı ilerleme; kalıcı sayaç. Hesap kurulmadan görülen ekran, bağlantı durumunu ve boş veri durumunu açıkça anlatır.

1. Depoyu/AGENTS.md/bağımlılıkları incele; PRD, plan, checklist ve kurulum belgelerini oluştur.
2. Sahip allowlist'i, sunucu kimlik doğrulaması, RLS ve sürümlü migration ekle. İlk sahip hesabı kurulumunu yaz; açık kayıt kapalı olsun.
3. Profil/konu/geçmiş/görev/plan sürümü/oturum/aktif aralık/audit modeli kur. Girdileri doğrula; işlemleri transaction ve idempotency ile koru.
4. CSS tokenları, tema aileleri, görünüm ayarları, erişilebilir bileşenler ve masaüstü/mobil gezinmeyi oluştur.
5. Boş durumlu Bugün, Görevlerim, Konularım ve Ayarlar akışları: gerçek kaydetme/yenileme/hata, görev bağlamlı sayaç, konu durumu ve arama.
6. Görev ağırlığı, kısmi ilerleme, süre ve birleşik göstergeyi deterministik hesapla. Geçmiş ayarları günlük snapshot'larla koru.
7. Kronometre/geri sayım, duraklat/sürdür/bitir, yeniden açılınca kurtarma, tek etkin oturum, hedef süresinde durma ve yerel gece yarısı bölmesini uygula.
8. Birim testleri; lint/typecheck/build; boş/kurulumsuz ekranın mobil/masaüstü tarayıcı kontrolü. Gerçek sağlayıcı kurulunca login, ekleme/düzenleme, RLS, eşzamanlılık ve ikinci cihaz testleri.

**Kapanış koşulu:** Kullanıcı girişinden başlayan gerçek veritabanı akışı ve kalıcı sayaç doğrulanır; test edilmemiş veya dış kurulum bekleyen öğeler ayrı raporlanır. Birim testin geçmesi Aşama 1'in tamamlandığı anlamına gelmez.

**Açık Aşama 1 kabulleri:** Gerçek hesapta görev/sayaç yazma, ikinci cihaz ve yetkisiz kullanıcı RLS testi; checklist'teki diğer alt özellikler. Aşama 1–2 için sekiz migration ve sahip girişi kurulmuştur. Şablonlar, ayrı soru/sayfa hedefleri, dinlenme günü ve konu detaylarının kalan alanları tamamlanmadan aşama tam kabul edilmiş sayılmaz.

## Aşama 2 — Sonuçlar ve bağlam

**Çıktı:** Denemeler, süre istatistikleri, günlük ve yalnız okunur Calendar.

1. Sürümlü TYT/AYT Sayısal/branş formatları; soru sayısına göre toplam net doğrulaması, isteğe bağlı ad ve varsayılan bugünün tarihi.
2. Gerçek kayıtlarla toplam net grafikleri, dönem/tür filtreleri, nokta/ortalama/örnek sayısı ve veri olmayan dönemler.
3. Gün/hafta/ay/yıl/özel aralık süre raporları; takvim gününden ilişkilere geçiş; dinlenme/eksik/sıfır ayrımı.
4. Orijinali korunan serbest günlük, isteğe bağlı alanlar, yerel tarih ilişkisi ve AI paylaşım seçimi.
5. Google OAuth ayrı bağlantı yaşam döngüsü; yalnız events.readonly ve gerekirse calendarlist.readonly; takvim seçimi, bugünün olayları, yenileme/süre sonu/çevrimdışı durumları. Takvim yazma kodu ve izni eklenmez.

**Kapanış koşulu:** Negatif net/hatalı toplamlar, grafikte örnek sayıları ve Calendar'ın hiçbir çalışma/görev yazması üretmediği test edilir. Yerel veritabanı ve tarayıcı sözleşmeleri doğrulandı; gerçek sahip girişi ve ilk Google Calendar API okuması da yapıldı. Google bağlantı uç durumlarının canlı kabulü bekliyor.

## Aşama 3 — AI ve yetkili ChatGPT bağlantısı

**Çıktı:** Kullanıcının açtığı AI, iki haftalık sunucu işi ve kimliği doğrulanmış MCP kayıt araçları.

1. Güncel resmî OpenAI model/SDK belgeleri ve hesap erişimi doğrulanır. OPENAI_MODEL yapılandırması, API anahtarı sınırı, kullanım/maliyet, istek/harcama sınırı ve açık kurulum durumları.
2. Kodla hesaplanmış istatistikler + izinli alanlar ile rapor; kaynak günler/eksikler/örnek sayıları; belirsizlik ve alternatif açıklamalar.
3. Kullanıcının etkinleştireceği başlangıç tarihinden 14 günlük sunucu planlama, durum/hata, tekrar ücretlendirmesini önleyen idempotency/cache, veri değişince eskime uyarısı.
4. Resmî MCP/Apps/Plugins belgeleriyle uygun OAuth. Dar şemalı araçlar, doğrulanmış sahip, servis katmanında yetki, audit ve gerçek işlem sonrası kayıt kimliği/link.
5. Şemalı deneme sonucu için açık kullanıcı onayı ve tekrar anahtarı isteyen `create_exam` aracı kodlandı; gerçek özel bağlantıda kabul edilecek.

**Kapanış koşulu:** AI anahtarsız çekirdek çalışır; izinsiz günlük alanları gönderilmez; tekrar rapor/MCP yazması çift kayıt oluşturmaz; yetkisiz kimlik tüm özel verilere kapalıdır. Model erişimi ve özel bağlantı kurulumu doğrulanmadan “hazır” gösterilmez.

**25 Eylül 2026 durum:** Dönem raporu, kaynak gün/eksik veri, izinli günlük alanları, tahmini kullanım sınırı, geçmiş rapor/eskime ve 14 günlük cron yolu kodlandı. Dört okuma ve iki idempotent yazma aracı (`create_task`, yapılandırılmış sonuç isteyen `create_exam`) içeren MCP kaynağı varsayılan olarak kapalıdır. İki Aşama 3 migration'ı buluta uygulanıp dört tabloda RLS ve schedule RPC yetkileri doğrulansa da model erişimi/ücretli çağrı denenmediği, Vercel yayını bulunmadığı ve Supabase OAuth Server açılmadığı ve kodlanan kullanıcı izin ekranı canlı sağlayıcıyla sınanmadığı için Aşama 3 canlı kabulü yapılmadı. OAuth `aud` değerinin MCP kaynağına bağlanması ayrıca çözülmeli; ayrıntılar [PHASE3_SETUP.md](docs/PHASE3_SETUP.md) içinde. Şemalı deneme aktarım aracının gerçek ChatGPT kabulü bekliyor.

## Aşama 4 — Çevrimdışı, dayanıklılık ve yayın hazırlığı

**Çıktı:** Kurulabilir ve bakım yapılabilir kişisel PWA; geri yüklemesi denenmiş yedek.

1. Manifest/ikon/service worker/kurulum yönergelerini tamamla; hassas yanıtlar önbelleğe alınmaz.
2. IndexedDB görev/sayaç kuyruğu, UUID/idempotency/sürüm, görünür senkron durumu; iki çevrimdışı cihaz çakışmalarında inceleme; çıkışta yerel veri temizliği.
3. Yanlış/takılma arşivi, tekrar önerileri, aylık yol haritası ve günlük/haftalık hedef ilişkileri.
4. Sürümlü JSON dışa alma/geri yükleme, CSV; kimlik/ilişki koruma; silme/üzerine yazma açık onayı; ayrı ortamda restore testi.
5. Klavye/odak/kontrast/az hareket, mobil taşma/dokunma ve ekran okuyucu kontrolleri. Yetki, RLS, OAuth, rate limit, yükleme, SSRF ve prompt injection testleri.
6. Vercel çevre değişkenleri, domain/callback, özel depolama, zamanlayıcı ve yedek bakım kontrolleri; kullanıcı yetkisinden sonra yayın.

**Kapanış koşulu:** Tam talimatın 18 kabul senaryosu ve gerçek sağlayıcı kontrolleri tamamlanır; geri yükleme kanıtı, bilinen sınırlar ve bakım rehberi teslim edilir.

## Sonraki oturumun başlangıcı

1. Bu plan, checklist ve TESTING.md okunur; çalışma ağacı ve kullanıcı değişiklikleri incelenir.
2. Gerçekte değişen kod ve test kanıtlarıyla durum güncellenir.
3. Aşama 3'te uygulanan migration'ın işlevleri ve gerçek model erişimi/maliyet sınırı doğrulanır; ardından bir manuel rapor ve 14 günlük üretim zamanlaması sınanır. Özel MCP bağlantısı için kodlanan OAuth izin ekranının canlı testi, authorization path/Site URL kaydı, resource audience ve HTTPS yayını ayrıca tamamlanır.
4. Aşama 1–2'nin eksik canlı kabul senaryoları ve Aşama 4 işleri checklist'te açık tutulur; gerçek bağlantı veya ücretli analiz denenmeden başarı üretilmez.






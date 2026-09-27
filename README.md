# YKSim

Sümeyra için Türkçe, kişisel YKS takip uygulaması. Boş klasörden Next.js 16.3.6, React 19.2.8 ve Node.js 24 ile kuruldu. Günlük çalışma, deneme sonuçları, süre raporları ve günlüğü tek alanda izler. Kalıcı kayıt için Supabase kurulumu gerekir. Kurulum yapılmadığında uygulama bunu açıkça gösterir; örnek başarı veya kayıt oluşturmaz.

**Durum (26 Eylül 2026):** Aşama 1 ve 2 uygulaması, ücretsiz Supabase projesi, tek sahip hesabı ve salt okunur Google Takvim bağlantısı kuruldu. Aşama 3'ün AI dönem raporları, 14 günlük sunucu zamanlaması, Günlüğüm'de isteğe bağlı AI alan önerisi, tarihli elle çalışma kaydı ve altı okuma/dört yazma aracı içeren özel MCP temeli yerel kodda hazır. Çalışma, deneme ve konu düzeyi yazmaları açık kullanıcı onayı ister; tüm MCP yazmaları tekrar anahtarı kullanır. Yeni `get_analysis_sources` aracı varsayılan son 14 (en çok 31) günün hesaplanmış özet ve kaynaklarını yalnız AI ile paylaşılmış günlük alanlarıyla döndürür; ücretli model çağrısı yapmaz. Deneme aracı PDF dosya yolu aktarmaz, çalışma aracı sahte sayaç saati oluşturmaz. OAuth izin ekranı ve onay/ret yolları kodlandı; Supabase OAuth/OIDC keşif uçları son kontrolde 200 döndü. Önceki sekiz migration ile altı Aşama 3 migration'ı uzak veritabanına uygulandı (canlı toplam **14**); yeni günlük AI önerisi ve tarihli çalışma tablolarında RLS ve RPC yetkileri doğrulandı. Kullanıcının ekran görüntüsünde 5 USD API kredisi görüldü; otomatik yüklemeyi kapattığını ve 2 USD/ay sert sınırı kaydettiğini bildirdi (hesap ayarları bağımsız okunmadı). Yerel anahtarın varlığı ve model erişimi doğrulandı; 19–25 Eylül döneminin ilk ücretli AI raporu buluta kaydedildi (1058 input/1025 output token, tahmini 0,06183 USD). Vercel CLI 60.0.0 ile `geroy` takımının `yks-tracker` projesine üretim yayını yapıldı; yerel `.vercel/project.json` bağlantısı bu projeye düzeltildi. Kullanıcının açık onayıyla 19 ortam değişkeni yalnız Production ortamına aktarıldı; sunucu sırları Secret olarak kaydedildi. [Canlı YKSim](https://yks-tracker-puce.vercel.app) erişilebilir; `/api/state` oturumsuz istekte `configured:true`, `SIGN_IN_REQUIRED` ve HTTP 401 döndürüyor, kişisel veri vermiyor. Codex Vercel eklentisinin boş takım listesi/403 sorunu sürse de CLI erişimi ve yayın çalışıyor. Supabase Site URL değeri `https://yks-tracker-puce.vercel.app` olarak düzeltildi; OAuth Server `/oauth/consent` ile açık ve OAuth/OIDC keşfi HTTP 200. `MCP_ENABLED=true` ile kaynak meta verisi 200, tokensız/geçersiz tokenlı istekler 401 dönüyor. ChatGPT gerçek callback adresiyle public PKCE istemcisi kaydetti; tam istemci–MCP audience eşlemesi ve Custom Access Token hook etkin. DCR kayıt sonrasında yeniden kapatıldı. Kişisel YKSim eklentisinde OAuth bağlantısı, gerçek token değişimi ve ChatGPT “Araçları yenile” akışı tamamlandı. Son üretim loglarında kimliği doğrulanmış MCP POST istekleri 200 döndü. Gerçek araçla veri okuma/yazma, token yenileme/iptal ve doğrudan Data API/Storage reddi kabulü henüz tamamlanmadı. Üretimde `AI_SCHEDULER_ENABLED=true`; `dpl_CdBEKDNxqsviGXB1VpbnpwxaT7TQ` READY ve günlük `0 2 * * *` cron kaydı doğrulandı. Doğru bearer ile `/api/cron/analysis` HTTP 200 ve `{ok:true,completed:0,skipped:0,failed:0}`, kimliksiz istek 401 döndü. `analysis_settings` toplam 0/etkin 0 olduğundan bu kontrol model çağrısı veya rapor üretmedi; kullanıcı iki haftalık zamanlamayı henüz açmadı. Gerçek 14 günlük dönem ve otomatik tetikleme kabulü bekliyor. Audience hook ve MCP owner gateway migration'ları uzak veritabanına uygulandı. Custom Access Token hook etkinleştirildi; gateway policy/RPC uzak SQL denetimi tamamlandı; gerçek Data API/özel PDF Storage red testi bekliyor. Gateway, OAuth tokenıyla doğrudan erişimi restrictive RLS ile reddetmek ve doğrulanmış sahip için dört komuta sınırlı sunucu geçidi sunmak üzere tasarlandı; gerçek OAuth tokenı ile güvenlik kabulü henüz tamamlanmadı. Canlı giriş ekranı izole tarayıcıda hatasız doğrulandı; kullanıcı giriş yaptığını bildirdi. Kullanıcı canlı Denemelerim listesinde ve istatistiklerin tüm dönem görünümünde eski kayıtlarını gördüğünü doğruladı; görünürlük bildirimi ilgili geçmiş bölümlerine gidilerek çözüldü, veri taşıma veya geri yükleme gerekmedi. Günlük AI önerisi, tarihli bulut kaydı ve raporun tarayıcı akışı henüz kabul edilmedi. Kurulum adımları ve sınırlar [Aşama 3 rehberinde](docs/PHASE3_SETUP.md) ve [özellik kontrol listesinde](FEATURE_CHECKLIST.md) açıklanır.

## Bilgisayarında aç

Gerekenler: Node.js 24.x ve projenin package.json dosyasındaki pnpm 11.19.0. Proje klasöründe bir terminal aç:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Tarayıcıda [localhost:3000](http://localhost:3000) veya [127.0.0.1:3000](http://127.0.0.1:3000) adresini aç. Bu adım arayüzü açar; kişisel kayıtların kaydedilmesi için aşağıdaki kurulumu tamamla. Bu bilgisayar adresi telefondan aynı adresle açılamaz. Telefon ve diğer cihazlarda [canlı YKSim](https://yks-tracker-puce.vercel.app) adresini kullan.

## Verilerini kalıcı kaydet

Adım adım tek liste [docs/SETUP.md](docs/SETUP.md) içinde: Supabase projesi, yalnız senin hesabın, migration, sahip UUID'si ve üç ayar. Şifreni ve gizli anahtarlarını sohbet veya repository'ye koyma.

```powershell
Copy-Item .env.example .env.local
```

.env.local içindeki yer tutucuları kendi değerlerinle doldur:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_ME
ALLOWED_USER_EMAIL=you@example.com
```

Ardından geliştirme sunucusunu yeniden başlat ve uygulamada e-posta/şifrenle giriş yap. Supabase Auth'taki kullanıcı UUID'sinin veritabanındaki tek sahip kaydı olması gerekir; yalnız e-posta ayarı yeterli değildir. Çekirdek çalışma özellikleri secret anahtar gerektirmez. Google Takvim bağlantısı için sunucuda SUPABASE_SECRET_KEY, Google OAuth bilgileri ve şifreleme anahtarı gerekir; ayrıntılar [Google Takvim kurulumu](docs/GOOGLE_CALENDAR_SETUP.md) içinde. APP_ORIGIN Google bağlantısı ve OAuth izin ekranı için sunucu ortamında doğru origin olarak ayarlanmalıdır; üretimde Supabase Auth Site URL ile eşleşir.

İlk giriş yalnız ders/konu başlangıç listesi oluşturur. Geçmiş çalışmalar, deneme sonuçları, hâkimiyet ve günlükler doldurulmaz. Konu listesi düzenlenebilir başlangıç listesidir; 2027'nin eksiksiz resmî müfredatı olduğu iddia edilmez.

## Günlük kullanım

1. Ayarlar'dan hedef yılı/sıralamayı, günlük hedefi ve görünümü düzenle.
2. Konularım'dan konunun öğrenme düzeyini belirle. Tekrar çalışmak düzeyi kendiliğinden düşürmez.
3. Görevlerim'den güne bir iş ekle; net dakika, kişisel zorluk ve tamamlanma ölçütünü yaz.
4. Görev üzerinden veya plansız bir çalışma başlat. Molada duraklat, dönüşte sürdür, bitince kaydet.
5. Görevi gerçekten tamamlandığında işaretle. Sayaç bitmesi görevi veya konuyu otomatik tamamlamaz.

Görev ilerlemesi planlanan dakika × zorluk ağırlığıyla hesaplanır. Günlük plan ilerlemesi varsayılan olarak %70 görev + %30 süre içerir. Boş plan veya sıfır hedef tanımsız gösterilir; fazla süre eksik görevleri tamamen kapatmaz.

Tamamlanan oturumların hatalı fazla süresini bir neden yazarak azaltabilirsin. Bitmiş sayaç oturumunun süresini artırma henüz desteklenmiyor. Tarih, ders ve net dakikası açıkça doğrulanan ayrı elle çalışma kaydı kimlik doğrulamalı API ve özel MCP kodunda var; migration uygulandı, fakat gerçek sahip hesabında yazma henüz doğrulanmadı; özel MCP bağlantısı OAuth yapılandırması ve canlı kabul bekliyor. Çevrimdışı kayıt kuyruğu henüz yoktur. İnternet kesilince kaydetme hatasını dikkate al; “kaydedildi” bilgisi görmeden değişikliği kaydedilmiş sayma. Tarayıcı/telefon kapalıyken alarmın tam zamanında çalışması garanti edilmez.

## Sonuçlar ve günlük

- **Denemelerim:** TYT, AYT Sayısal ve branş denemesi ekle; ders bazında doğru/yanlış/boş veya yalnız net gir. Yalnız genel net biliniyorsa bunu ayrı belirt. Net, puan ve sıralama birbirine karıştırılmaz. Tarih, yayın, ders, ölçü ve haftalık/aylık ortalama filtreleri gerçek kayıtlardan hesaplanır.
- **PDF'den deneme:** 10 MiB ve 10 sayfaya kadar PDF'yi özel depoya yükle. Metin katmanı varsa önerileri, kaynak satırlarını ve birden fazla aday sonucu incele; yanlış alanları düzeltip açıkça kaydet. ÖZDEBİR türü çok öğrencili TYT genel sonuç tabloları yerel olarak satırlara ayrılır; kendi adını arayıp seçmeden kayıt formu açılmaz. Tek öğrencilik TYT sonuç belgelerinde ders özet tablosu varsa doğru/yanlış/net, toplam net, puan ve genel sıralama yerel olarak çıkarılır. Raporda sınav tarihi yoksa tarih alanı boş kalır ve seçilmesi gerekir. Aynı dosya ve benzer sonuç uyarıları çift kaydı önlemeye yardımcı olur. Taranmış veya metni okunamayan PDF'lerde istersen yükleme sırasında görsel okumayı seç. Yalnız ilgili sayfaların görüntüleri sunucudan OpenAI API'ye gönderilir; sonuçlar yine elle incelenip açıkça kaydedilir. Bu seçim yapılmazsa PDF'yi açıp alanları elle doldur. Kurulum ve sınırlar [PDF görsel okuma](docs/PDF_IMPORT_OCR.md) içinde.
- **Çalışma İstatistikleri:** Gün/hafta/ay/yıl/özel dönem için net süreyi, günleri, geçmiş hedefleri ve ders/konu/çalışma türü dağılımını gör. Eksik kayıt, dinlenme ve doğrulanmış sıfır ayrı gösterilir. Kodlanan tarihli elle süre kayıtları da toplam ve geçmişte görünür; ilgili migration canlıya uygulandı; giriş yalnız kimlik doğrulamalı API veya ilerideki özel MCP üzerinden yapılabilir, gerçek hesap yazması henüz doğrulanmadı.
- **Günlüğüm ve Analiz:** Serbest metin ve isteğe bağlı alanlar kaydet; AI analizi için paylaşılabilecek alanları tek tek seç veya günlüğü analiz dışında tut. “AI ile öner” düğmesi en fazla 4.000 karakterlik metni yalnız açık isteğinle OpenAI API'ye gönderecek şekilde kodlandı; önerileri gözden geçirip boş alanlara uyguladıktan sonra günlüğü ayrıca kaydetmen gerekir. Bu düğme dönem analizi paylaşım seçimlerini değiştirmez. Günlük önerisi migration'ı uygulandı; anahtar ve model erişimi doğrulandı, fakat **günlük önerisi** sağlayıcıyla henüz denenmedi. Analiz sayfası deterministik istatistiklerden ve yalnız izin verdiğin günlük alanlarından dönem raporu oluşturacak şekilde kodlandı. İlk dönem raporu sunucu akışıyla üretilip kaydedildi; tarayıcı akışı ve 14 günlük gerçek cron için [Aşama 3 kurulumu](docs/PHASE3_SETUP.md) sürüyor.
- **Bugünün Programı:** Google bağlantısı kurulursa seçtiğin takvimlerin bugünkü etkinlikleri salt okunur görünür. Takvim etkinlikleri çalışma süresine eklenmez.
## Geliştirme ve kontroller

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm test:all
pnpm test:e2e
pnpm build
pnpm start
```

Son komut production build'den sonra çalışır. Bu Aşama 3 turunda `pnpm test:all` 169/169 (51 yerel PGlite DB testi dahil), lint ve typecheck geçti; günlük AI önerisi için odaklı Playwright testi de 1/1 geçti. Eski sekme seçicisi düzeltildikten sonra tam `pnpm test:e2e` 49/49 geçti. Production build de son gateway/analiz aracı koduyla geçti. Önceki Aşama 2 turunda altı temanın masaüstü ve mobil görünümleri incelendi. Gerçek sahip girişi ve ilk Google Takvim okuması daha sonra doğrulandı. Aşama 3 için altı migration uzak veritabanında; ilk ücretli OpenAI dönem raporu ve bulut kaydı doğrulandı. Vercel cron kaydı ve yetkili boş iş çağrısı doğrulandı; ücretli rapor üretmedi. Yeni günlük ve tarihli çalışma yollarında sahip hesabıyla bulut yazması ve gerçek 14 günlük otomatik rapor henüz canlı test edilmedi. ChatGPT OAuth/araç yenileme canlı geçti; gerçek araç veri okuma/yazması ayrıca kabul edilmeli. MCP gövde okuma düzeltmesi için odaklı 21/21 test ve TypeScript geçti. Kullanıcı üretime girişini ve Denemelerim/istatistik geçmişinde eski kayıtlarının görünmesini doğruladı. Önceki test sayıları ve kalan senaryolar [docs/TESTING.md](docs/TESTING.md) ve [özellik listesinde](FEATURE_CHECKLIST.md) yer alır. Build sonucu gerçek sağlayıcı kabulünün yerini tutmaz.

- [PRD.md](PRD.md): Ürün kuralları ve kapsam.
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): Dört aşama, açık işler ve sonraki oturum.
- [FEATURE_CHECKLIST.md](FEATURE_CHECKLIST.md): Çalışıyor / dış kurulum bekliyor / test edilmedi / henüz yapılmadı.
- [docs/USER_REQUIREMENTS.md](docs/USER_REQUIREMENTS.md): Orijinal talimatın tamamı.
- [docs/SETUP.md](docs/SETUP.md): Hesap, migration, seed, yayın ve bakım adımları.
- [docs/GOOGLE_CALENDAR_SETUP.md](docs/GOOGLE_CALENDAR_SETUP.md): Google OAuth, callback, izinler ve sunucu sırları.
- [docs/PHASE3_SETUP.md](docs/PHASE3_SETUP.md): AI maliyet sınırı, migration, sunucu zamanlaması ve özel OAuth/MCP hazırlığı.
- [docs/SOURCES.md](docs/SOURCES.md): Resmî doğrulama ve sınırları.

Analysis, schedule RPC yetki daraltma, günlük AI önerisi, tarihli çalışma, MCP audience hook ve owner gateway migration'ları uzak Supabase projesine uygulandı (uzak sürümler `20260925171059`, `20260925171128`); toplam 14 migration var. Custom Access Token hook etkin; gateway policy/RPC uzak SQL denetimi tamamlandı; gerçek OAuth/Data API/Storage kabulü bekliyor. İlk ücretli OpenAI dönem raporu ve Vercel üretim yayını doğrulandı. Son yayın CLI ile yapıldı; bu işlem yeni GitHub push içermedi.














# Öğretmen ve sınıf alanı

Öğretmen/yönetici ekranı: `/classroom`; e-posta iletisi gerektirmeyen, uygulama içinden onaylanan başvuru: `/register`.

35 öğrencili güvenli yerel demo için `pnpm dev:demo` çalıştırıp `http://127.0.0.1:3300/demo` adresini açın. Ayşe Demir'in 10, Mehmet Yıldız'ın 25 öğrencisi bulunur. Aynı sayfadan örnek öğrenci ve yönetici hesaplarına geçilir. Demo gerçek verilerden ayrıdır ve üretimde kapalıdır.

Kurulum, erişim kuralları, e-posta ayarları ve testler: [docs/CLASSROOM.md](docs/CLASSROOM.md).


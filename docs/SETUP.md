# Supabase ve ortam kurulumu

Bu rehber gerçek Auth, veritabanı ve Storage bağlantısını kurar. Yalnız arayüzü incelemek için [yerel demo](DEVELOPMENT.md) yeterlidir. Buradaki adımlar depodaki yapılandırmayı anlatır; herhangi bir uzak ortamın bugün kurulu veya doğrulanmış olduğunu iddia etmez.

## 1. Ortam dosyasını hazırla

Node.js ve pnpm sürümleri ile başlatma komutları [geliştirme rehberindedir](DEVELOPMENT.md). Henüz dosyan yoksa proje kökünde:

```powershell
Copy-Item .env.example .env.local
```

Mevcut `.env.local` dosyasının üzerine yazma. Yer tutucuları kendi geliştirme projenin değerleriyle değiştir; ortam değişince Next.js sunucusunu yeniden başlat.

| Grup | Değişkenler | Ne zaman gerekir? |
| --- | --- | --- |
| Temel bağlantı | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_USER_EMAIL` | Gerçek Supabase ile çalışan uygulamada. Mevcut `getConfiguration()` üçüne de ihtiyaç duyar. E-posta sahip hesabını tanımlar; öğrenci rolü vermez. |
| Uygulama adresi | `APP_ORIGIN` | Kullanılan şema ve host; ör. `http://localhost:3000`. Yol, query veya fragment ekleme. OAuth ve origin denetimlerinde kullanılan adresle tarayıcı adresi aynı olmalı. |
| Sunucu erişimi | `SUPABASE_SECRET_KEY` | Uygulama içi hesap oluşturma, Google Takvim, AI ve özel MCP gibi ayrıcalıklı sunucu işlemlerinde. |
| Google Takvim | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` | İsteğe bağlı; [Google kurulumu](integrations/GOOGLE_CALENDAR.md). |
| AI | `AI_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL`, fiyat ve bütçe değişkenleri | İsteğe bağlı; ayrıca veritabanı bütçe politikası gerekir. [AI ve MCP](integrations/AI_MCP.md). |
| MCP | `MCP_ENABLED`, `MCP_PUBLIC_URL` | İsteğe bağlı sahip bağlantısı; OAuth/hook kurulumu da gerekir. [AI ve MCP](integrations/AI_MCP.md). |
| Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | İsteğe bağlı durum önbelleği ve [canlı güncelleme](features/REALTIME.md). |
| Nova | `NOVA_ENABLED`, yerelde `NOVA_DEMO_ENABLED` | [Nova](features/NOVA.md) migration ve erişim koşullarıyla. |
| Bakım | `CRON_SECRET` | Korumalı cron uç noktaları. Analiz cron'u ücretli rapor üretmez. |

Diğer örnekler ve varsayılanlar [`.env.example`](../.env.example) içindedir. `CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED`, `RESEND_API_KEY` ve `CLASSROOM_EMAIL_FROM` eski sınıf e-posta akışına aittir; yeni başvuru onayları uygulama içindedir. Parola kurtarma e-postası ayrı bir Supabase Auth akışıdır.

Publishable anahtar tarayıcıda kullanılabilir; secret/service role anahtarı RLS'yi aşabilen sunucu yetkisidir. Secret anahtarını `NEXT_PUBLIC_` değişkenine, kaynak dosyasına veya loga koyma. [Supabase anahtar türleri](https://supabase.com/docs/guides/getting-started/api-keys).

## 2. Veritabanını hazırla

Geliştirme için üretimden ayrı Supabase projesi veya Docker ile yerel Supabase kullan. Yerel ayarlar [config.toml](../supabase/config.toml) içindedir; bunlar uzak dashboard ayarlarının güncel kopyası değildir. Örneğin yerel OAuth Server varsayılan kapalıdır.

Şema kaynağı [supabase/migrations](../supabase/migrations) klasörüdür. `.sql` dosyalarını dosya adındaki zaman sırasıyla uygula; yalnız ilk birkaç aşamayı seçmek güncel uygulamaya yetmez. `supabase/20260924000000_initial.sql.reference` eski taslaktır ve migration olarak çalıştırılmaz. `supabase/seed.sql` kasıtlı olarak kişisel veri içermez.

Bu rehberdeki CLI örnekleri `2.117.0` sürümüne sabitlenmiştir; komut/flag yardımı 15 Ekim 2026'da kontrol edildi. Sürümü değiştirirsen ilgili `--help` çıktısını tekrar kontrol et.

Yerel Supabase için Docker çalışırken:

```powershell
pnpm dlx supabase@2.117.0 start
pnpm dlx supabase@2.117.0 migration up --local
pnpm dlx supabase@2.117.0 migration list --local
```

CLI'nin verdiği yerel URL ve anahtarları `.env.local` içinde kullan. Auth kullanıcısı ve sahip yetkisi aşağıdaki adımda ayrıca kurulur; `seed.sql` bunları oluşturmaz.

Uzak bir geliştirme projesine Supabase CLI ile giriş yapıp doğru proje ref'ine bağlandıktan sonra geçmişi ve bekleyen değişiklikleri incele:

```powershell
pnpm dlx supabase@2.117.0 migration list --linked
pnpm dlx supabase@2.117.0 db push --linked --dry-run
```

Hedef, yedek ve geçmiş eşleşiyorsa bekleyen migration'ları uygulayan komut:

```powershell
pnpm dlx supabase@2.117.0 db push --linked
```

Bu işlem bağlı veritabanını değiştirir. Eski kurulum kayıtlarında uzak ve yerel migration zamanlarının farklı olduğu örnekler vardır; uyuşmazlıkta geçmişi körlemesine yeniden yazma, önce şema/geçmiş farkını çöz. Var olan veritabanında `db reset` kullanma. Yeni değişiklik için uygulanmış dosyayı düzenlemek yerine `pnpm dlx supabase@2.117.0 migration new aciklayici_ad` ile yeni migration oluştur.

## 3. Sahip, yönetici ve öğrenci erişimini ayır

İlk yöneticiyi `/register` ile oluşturma. Supabase Dashboard/yerel Studio içindeki Auth yönetiminden kendi e-posta/parolanla doğrulanmış kullanıcı oluştur. İlk uygulama girişinden önce [owner-setup.sql](../supabase/owner-setup.sql) dosyasındaki e-posta yer tutucusunu değiştirip hedef projenin SQL Editor'ında çalıştır. Bu script tek sahip kaydı oluşturur; var olan başka sahibi yeniden atamaz. `ALLOWED_USER_EMAIL` aynı hesabı göstermeli.

İlk kimlik okumasında `classroom_identity`, henüz `classroom_accounts` satırı yoksa `owner_allowlist` içindeki kullanıcı için `approved` yönetici hesabı oluşturur. Önceden öğrenci/öğretmen satırı oluşmuşsa sahip script'i bu rolü yükseltmez; yetkili yöneticinin mevcut hesap durumunu ayrıca düzeltmesi gerekir. Sahip allowlist'i ile `classroom_accounts` rol/durumları farklı denetimlerdir; yalnız e-posta veya yalnız Auth hesabı oluşturmak tüm uygulama erişimini kurmaz. Kaynaklar: [auth.ts](../src/lib/server/auth.ts), [classroom migration](../supabase/migrations/20260925214354_classroom.sql).

Öğrenciler `/register` üzerinden başvurur. Sunucu `SUPABASE_SECRET_KEY` ile Auth hesabını oluşturur; onay kararı uygulamadaki yönetici panelindedir. Bu kayıt yolu e-posta iletisi göndermeden Auth `email_confirm` bayrağını ayarlar; bu bayrak posta kutusu sahipliğinin kullanıcı tarafından doğrulandığı kanıtı değildir. Kullanıcı metadatasındaki rol isteğini yönetici yetkisi sayma. Güncel öğretmen alanı hem [uygulama bayrağı](../src/lib/classroom/availability.ts) hem [SQL koruması](../supabase/migrations/20261013122500_pause_teacher_updates.sql) ile duraklatılmıştır; yeniden açılması ikisinin birlikte değiştirilmesini gerektirir.

Supabase Auth Site URL'yi kullanılan uygulama adresine ayarla. Parola kurtarma için aynı origin'in `/auth/callback` ve `/auth/callback?type=recovery` adreslerini allowlist'e ekle. Yerel `localhost` ile `127.0.0.1` farklı origin'lerdir; kullandığın adresleri açıkça tanımla. Google callback'i ayrı olarak [Google rehberinde](integrations/GOOGLE_CALENDAR.md) kurulur.

## 4. Kurulumu kabul et

`pnpm dev` ile uygulamayı aç; sahip girişi, öğrenci başvurusu ve yönetici onayını kendi geliştirme ortamında dene. Onaylı öğrenciyle bir görev oluştur, yenile ve kaydın korunduğunu gör. Sayaç başlat/duraklat/bitir; oluşan süreyi ve ikinci cihazda aynı hesabı kontrol et. İlk state okuması başlangıç profil/katalog verilerini oluşturabilir; geçmiş çalışma veya başarı seed edilmez.

Oturumsuz ve başka kullanıcı oturumuyla özel kayıtların okunamadığını denetle. Profil fotoğrafı kullanılacaksa ilgili Storage migration/policy'lerinin de uygulanmış olduğunu doğrula. Yerel PGlite testlerinin gerçek Auth, Storage veya iki cihaz kabulünün yerine geçmediğini [test rehberi](TESTING.md) açıklar.

## Yayın ve bakım

Vercel için kurulum `pnpm install --frozen-lockfile`, derleme `pnpm build`, Node.js `24.x` olmalıdır. Production ve Preview ortamlarını ayrı değerlendir; Preview'ı kendiliğinden üretim kişisel verisine bağlama. URL değiştiğinde `APP_ORIGIN`, Supabase Site URL/redirect listesi ve etkin OAuth istemcilerinin callback adreslerini birlikte güncelle. Depodaki [yayın kuralları](../AGENTS.md) görev teslim sürecini tanımlar.

Şema değişiminden önce veritabanı ve özel Storage dosyaları için yedek al, ayrı test ortamında geri yüklemeyi doğrula. DB dump'ının fotoğraf/PDF dosyalarını da içerdiğini varsayma. Uygulama içi genel JSON/CSV restore akışı yoktur.

Sorun çözmede önce ortam yer tutucuları/sunucu yeniden başlatması, ardından Auth hesabı, `ALLOWED_USER_EMAIL`, sahip kaydı, `classroom_accounts.status` ve migration geçmişini kontrol et. Kayıt çakışmasında güncel state'i yeniden oku; eski revizyonu sessizce üzerine yazma.

Eski kurulum ve canlı deneme notları [kurulum geçmişinde](archive/SETUP_HISTORY.md) korunur; yeni ortamın güncel durumunu kanıtlamaz.

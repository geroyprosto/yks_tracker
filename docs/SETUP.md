# Kurulum, yayın ve bakım

Bu rehber temel hesap, veritabanı ve yayın adımlarını toplar. 24 Eylül 2026'da YKSim adlı ücretsiz Supabase projesi (`efekpsnejfxiilfkjfar`, Frankfurt) oluşturuldu; ilk sekiz Aşama 1–2 migration'ı, özel PDF bucket/RLS ve doğrulanmış tek sahip hesabı kuruldu. Gerçek giriş, sahip profili, başlangıç konu kataloğu, Google OAuth bağlantısı ve ilk Calendar API okuması doğrulandı. **25 Eylül iki Aşama 3 migration'ı da uzak veritabanına uygulandı (toplam 10); dört yeni tabloda RLS ve schedule RPC yetkileri doğrulandı; OpenAI ücretli çağrı, Vercel yayını ve ChatGPT OAuth bağlantısı yok.** AI ve MCP için [Aşama 3 kurulum rehberini](PHASE3_SETUP.md) izle.

## Tek dış kurulum kontrol listesi

### Şimdi: Aşama 1

- [x] Kendi Supabase kuruluşunda YKSim Free projesi Frankfurt'ta oluşturuldu; proje oluşturma maliyeti 0 $/ay olarak onaylandı.
- [x] Supabase Auth ayarında yeni kullanıcı kaydı kapatıldı. Herkese açık Auth ayarından `disable_signup=true` ve anonim girişin kapalı olduğu doğrulandı; mevcut sahibin e-posta girişi açık.
- [x] Authentication > Users bölümünde tek sahip Auth hesabı oluşturuldu ve e-postası doğrulandı. Parola sohbet veya depoya alınmadı.
- [x] [supabase/migrations](../supabase/migrations) altındaki sekiz Aşama 1–2 SQL migration'ı yeni YKSim projesine sırayla uygulandı: çekirdek, Beyaz/Siyah temalar, soru/test kayıtları, deneme sonuçları, Google Takvim bağlantısı, günlük/gün işaretleri, PDF içe aktarma ve OGM konu kataloğu yenilemesi. Özel Storage bucket ve RLS/policy varlığı doğrulandı. Başka projede uygulamadan önce şema ve yedeği değerlendir.
- [x] [owner-setup.sql](../supabase/owner-setup.sql) doğrulanmış e-postayla tek kullanıcıyı bularak uygulandı; tek sahip kaydı doğrulandı. Dosyanın yer tutucusu e-postadır, UUID veya parola girilmez. Farklı bir sahibi yeniden atamaz.
- [x] Proje URL'si ve publishable anahtar yerel ortama alındı. Tarayıcıya uygun anahtar publishable türündedir; service role/secret anahtarını NEXT_PUBLIC alanına koyma. [Supabase anahtar rehberi](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
- [x] Git tarafından yok sayılan .env.local dosyasında NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ALLOWED_USER_EMAIL ve yerel APP_ORIGIN ayarlandı; GOOGLE_TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ve SUPABASE_SECRET_KEY de yerel ortamda var. Değerleri depoya veya belgelere kopyalama. APP_ORIGIN yalnız şema + host içermeli ve NEXT_PUBLIC alanına taşınmamalı.
- [x] Node.js 24.x ve pnpm 11.19.0 ile bağımlılıklar kuruldu; yerel uygulama 3000 portunda çalıştı ve sahip girişi doğrulandı. Google OAuth değişkenleri eklendikten sonra sunucu yeniden başlatıldı. Gelecek env değişikliklerinde de yeniden başlat.
- [x] Kullanıcı kendi hesabıyla giriş yaptı; bulut DB'de sahip profili ve düzenlenebilir başlangıç konu kataloğu doğrulandı. İlk giriş kişisel çalışma veya başarı verisini otomatik üretmez; sonradan yapılan kayıtlar kullanıcıya aittir.
- [ ] Görev ekle, sayfayı yenile ve aynı kaydı tekrar gör. Sayaç başlat/duraklat/sürdür/bitir; ikinci cihazda aynı hesaptan sonucu doğrula.
- [ ] Oturumsuz ve izin verilmeyen başka bir test kullanıcısıyla özel kayıtların okunamadığını doğrula. Üretime geçmeden RLS/servis ve mobil E2E kabulünü tamamla.

**Migration notu:** supabase/20260924000000_initial.sql.reference önceki uygulanmamış taslağı korur; migration değildir ve çalıştırılmaz. migrations klasöründeki dosyalar tarih sırasıyla uygulanır. Çekirdek migration zaten uygulanmışsa henüz uygulanmamış dosyaları tarih sırasıyla uygula. Bu ek migration dosyaları mevcut kayıtları korur. Mevcut bir veritabanına eski taslağın uygulanmış olduğu anlaşılırsa güncel dosyayı körlemesine çalıştırma; önce şema farkı için ayrı migration hazırlanır.

**Seed:** Kullanım verisi seed'i yoktur. İlk sahibi yetkilendirmek owner-setup.sql ile yapılır; katalog ilk başarılı oturum/veri okumasında kurulur. Seed işlemi kullanıcının geçmiş başarısını veya çalışmasını uydurmaz.

### Aşama 2 dış kurulumları

- [x] PDF migration, özel exam-documents bucket ve sahip RLS/policy yapısı bulutta doğrulandı.
- [x] [Google Takvim kurulum rehberindeki](GOOGLE_CALENDAR_SETUP.md) adımlarla Calendar API, Web OAuth istemcisi ve izin ekranı kuruldu. Uygulama yalnız calendar.events.readonly ve calendar.calendarlist.readonly kapsamlarını ister. Kullanıcı uygulamadaki Google izin akışını tamamladı.
- [x] Google Console'da yerel callback http://localhost:3000/api/calendar/callback tanımlandı; APP_ORIGIN, GOOGLE_TOKEN_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET ve yalnız sunucuda kullanılan SUPABASE_SECRET_KEY yerelde ayarlandı. Sırlar depoya veya tarayıcıya konulmadı. Yayın için gerçek HTTPS alan adındaki /api/calendar/callback ayrıca tanımlanmalı.
- [x] [Google bağlantı migration dosyası](../supabase/migrations/20260924141529_google_calendar_connection.sql) buluta uygulandı. Bulutta sahibine ait bir bağlantı, seçilmiş üç takvim ve dolu last_success_at doğrulandı; bu en az bir başarılı canlı Calendar API okumasını gösterir.
- [ ] Bağlantıyı kesme/yeniden bağlama, izin iptali, token yenileme, tekrar eden/tüm gün/gece yarısı/saat dilimi etkinlikleri ve farklı günleri gerçek Google hesabıyla ayrıca dene. Mock testler bu uç durumları kapsar, canlı kabulün yerini tutmaz.
- [ ] Focus To-Do entegrasyonu istenirse önce resmî API veya gerçek dışa aktarma örneği doğrulansın. Mevcut sürümde “bağlı” sayılmaz.

### Aşama 3 dış kurulumları — yerel kod hazır, canlı bağlantı bekliyor

- [x] [Aşama 3 analysis migration'ı](../supabase/migrations/20260925092053_phase_three_analysis.sql) ve [schedule RPC yetki daraltma migration'ı](../supabase/migrations/20260925095509_lock_down_analysis_schedule.sql) uzak YKSim projesine uygulandı. Dört yeni tabloda RLS ve daraltılan schedule RPC yetkileri doğrulandı; claim/finalize işlevlerinin ve gerçek rapor akışının canlı kabulü hâlâ bekliyor.
- [ ] Ayrı OpenAI API projesinde **Enforce a hard limit** ile sert aylık harcama sınırı koy. Etkin metin modeli `gpt-6-luna` için erişimi ve o günkü [resmî fiyatı](https://developers.openai.com/api/docs/models/gpt-6-luna) doğrula; 26 Eylül 2026 ayarı `AI_INPUT_PRICE_PER_1M_USD=0.1`, `AI_OUTPUT_PRICE_PER_1M_USD=0.5`, aylık 2 USD/8 istektir. `OPENAI_MODEL`, token fiyatları, uygulama içi istek/USD sınırı ve sunucu `OPENAI_API_KEY` değerini birlikte ayarla. ChatGPT aboneliğini API kredisi sayma.
- [ ] İlk manuel analiz raporunu kullanıcı isteğiyle gerçek ve kısa bir dönem için çalıştır; yalnız izinli günlük alanları, eksik günler, kaynaklar, tokenlar, maliyet ve tekrar isteği davranışını denetle. Bu işlem ücretli olabilir; bu teslimde yapılmadı.
- [ ] Vercel HTTPS üretim yayını, Supabase/OpenAI sunucu sırları ve güçlü `CRON_SECRET` kur. `AI_SCHEDULER_ENABLED=true` değerini ancak yayında cron doğrulandıktan sonra aç; kullanıcı Analiz sayfasında başlangıç gününü seçip 14 günlük işi etkinleştirsin. Yerel kod tek başına tarayıcı kapalıyken çalışmaz.
- [ ] Supabase OAuth Server'ı aç; Authorization Path'i kodlanan `/oauth/consent` olarak kaydet, Auth Site URL ile sunucu `APP_ORIGIN` değerini aynı HTTPS origin'e ayarla. Gerekirse dinamik istemci kaydını aç veya istemciyi kaydet; kodlanan kullanıcı onay/ret ekranını, MCP kaynak audience'ını ve token yenilemeyi canlı akışta doğrula. `/api/mcp` temel kodu varsayılan kapalıdır; yalnız `MCP_ENABLED=true` yazmak güvenli bir ChatGPT bağlantısı kurmaz.
- [ ] HTTPS üzerindeki özel ChatGPT bağlantısında OAuth izin, altı dar aracın listesini, sahipliği, `create_task` ve `create_exam` kayıt kimliklerini, deneme için kullanıcı onayını ve aynı `request_id` ile yazma tekrarını kabul et. Kaynak audience ve araç güvenlik şeması gerçek ChatGPT akışında henüz doğrulanmadı.

### Yayından önce

- [ ] [FEATURE_CHECKLIST.md](../FEATURE_CHECKLIST.md) içindeki Aşama 1 kalanlarını ve kullanılacak sonraki özellikleri doğrula.
- [ ] Gerçek geri yükleme testi yap; sadece “yedek var” işaretlemek yeterli değildir.
- [ ] GitHub repository/erişim tercihini ve push yetkisini açıkça belirle.
- [ ] Vercel projesi/ortam/domain için ayrıca yayın yetkisi ver.
- [ ] Üretim ve Preview ortamlarının kullanıcı/veritabanı sınırlarını belirle. Preview'ların üretim kişisel verisine otomatik bağlanmasına izin verme.
- [ ] Vercel'e temel Supabase URL, publishable anahtar ve ALLOWED_USER_EMAIL değerlerini doğru ortamda ekle; etkinleştirdiğin Google, PDF, AI ve zamanlayıcı özelliklerinin ek sunucu sırlarını da [Aşama 3 rehberine](PHASE3_SETUP.md) göre ayarla. Sırları source dosyalarına veya build loglarına yazma.
- [ ] Build komutu pnpm build, kurulum pnpm install --frozen-lockfile, Node 24.x. Lockfile ve kurulu Next.js sürümü korunur.
- [ ] HTTPS üzerinde giriş, görev, konu, sayaç, mobil taşma ve oturumsuz erişimi tekrar dene.
- [ ] PWA kurulabilirliğini Android Chrome ve Windows Edge/Chrome'da dene. Tarayıcı menüsünde yükleme seçeneği görünürse ana ekrana/uygulamalara ekle. Manifest'in varlığı tek başına bu testi geçirmez.

## Güncel API sınırı

- POST /api/login: e-posta + şifre, sunucuda izinli e-posta kontrolü.
- POST /api/logout: oturumu kapat.
- GET /api/state: yetkili sahibin güncel durumu; cache yapılmaz.
- POST /api/command: şemalı iş komutu, request_id ve değiştirilen kaydın beklenen sürümü.

Komutlar yetkili servis katmanına gider. user_id istemciden gelen sahiplik iddiası olarak kullanılmaz. Google Takvim için salt okunur /api/calendar/* uç noktaları vardır. Aşama 3 için sahip oturumlu `/api/analysis`, `CRON_SECRET` korumalı `/api/cron/analysis` ve varsayılan kapalı `/api/mcp` yolları kodlandı; dış hizmet kurulumu ve canlı kabul olmadan AI raporu veya ChatGPT bağlantısı oluşturmaz.

## Bakım ve yedekleme

1. Migration, lockfile ve kurulum belgelerini birlikte sakla. Kullanıcı verisini repository'ye ekleme.
2. Veritabanını değiştirmeden önce sağlayıcının desteklediği yedek/dump yöntemini kullan. Şifreleri komut geçmişine, kaynak dosyasına veya konuşma çıktısına yazma.
3. Yedeği ayrı, özel test ortamına geri yükle. Görev/konu/oturum sayıları, UUID ilişkileri, plan sürümleri, sahiplik ve sayaç toplamlarını karşılaştır. Asıl veritabanının üzerine yazmak ayrıca açık onay gerektirir.
4. Özel Storage'daki PDF belgelerini de yedek/geri yükleme planına ekle; veritabanı dump'ının belge dosyalarını içerdiğini varsayma.
5. Gereksiz yedek/rapor/yerel kopyaların silinmesini gizlilik yaşam döngüsüne dahil et. Uygulama içi JSON/CSV dışa alma ve restore **henüz uygulanmadı**.
6. Bağımlılık güncellemelerinde kurulu Next.js belgelerini ve Supabase changelog'unu oku; lint/typecheck/test/build + ilgili gerçek akışı yeniden doğrula.
7. Hesap erişimi değişince e-posta allowlist, UUID allowlist ve etkin oturumları birlikte değerlendir. Değişiklik yapan kişi ve zamanı denetim kaydında koru.

## Sorun giderme

- **“Kurulum gerekli”**: .env.local değerlerini, publishable anahtar türünü ve sunucunun yeniden başlatıldığını kontrol et.
- **Giriş reddediliyor**: E-posta/şifre, doğrulanmış Auth hesabı, ALLOWED_USER_EMAIL ve owner_allowlist içindeki sahip kimliği eşleşmeli.
- **Tablo/fonksiyon bulunamadı**: Doğru migration doğru Supabase projesine uygulanmış mı kontrol et; eski referans dosyasını kullanma.
- **Başka cihazdan görülmüyor**: Aynı proje URL'si/hesap kullanıldığını ve API'nin başarı verdiğini doğrula. localStorage senkronizasyon kaynağı değildir.
- **Değişiklik çakışması**: Güncel veriyi yeniden oku, iki sürümü karşılaştırıp tekrar düzenle. Eski kaydı sessizce üzerine yazma.
- **İnternet yok**: Çevrimdışı yazma kuyruğu henüz yok; işlem kaydedilmiş gibi gösterilmez. Bağlandıktan sonra sonucu kontrol et.
- **Sayaç/alarm**: Tarayıcı arka planı veya telefon kilidi sesli alarmı geciktirebilir. Gerçek süre kalıcı aralıklardan hesaplanır; açık unutulan kayıtlar incelenmelidir.

Supabase projesi, ilk sekiz Aşama 1–2 migration'ı ve sahip hesabı kuruldu; gerçek giriş sonrası profil ve katalog doğrulandı. Google OAuth ve seçili takvimlerden canlı okuma doğrulandı. İki Aşama 3 migration'ı uzak veritabanına uygulandı; dört tabloda RLS ve schedule RPC yetkileri doğrulandı; gerçek AI raporu, Vercel cron ve ChatGPT OAuth bağlantısı yok. Canlı yazma/iki cihaz ve Google bağlantısını kesme/yenileme uç durumları henüz doğrulanmadı. Yerel PostgreSQL/servis testlerinde Auth kimlik kaynağı taklit edildi; önceki kanıtlar [TESTING.md](TESTING.md) dosyasındadır.


## Geliştirici için migration komutları

Bu teslimde Supabase CLI **2.117.0** sürümü ve aşağıdaki alt komutların yardım çıktıları kontrol edildi. CLI çağrıları sürüme sabitlenir. Yerel Supabase için Docker gerekir.

Mevcut yerel Supabase ortamına migration uygulamak:

```powershell
pnpm dlx supabase@2.117.0 migration up --local
```

Projeye bağlanmış uzak veritabanında önce uygulanacak değişiklikleri görmek:

```powershell
pnpm dlx supabase@2.117.0 db push --linked --dry-run
```

Uzak değişiklikler kullanıcı tarafından ayrıca yetkilendirildikten sonra:

```powershell
pnpm dlx supabase@2.117.0 db push --linked
```

Bu son CLI komutu çalıştırılmadı; ilk sekiz Aşama 1–2 migration'ı ve iki Aşama 3 migration'ı (toplam 10) bağlı Supabase aracılığıyla uygulandı. CLI ile göndermeden önce geçmişi ve dry-run çıktısını karşılaştır. Bağlantı/oturum açma ve Docker başlatma için kullandığın CLI sürümünün --help çıktısını izle.

Yeni migration dosyası oluşturmak için doğrulanmış komut:

```powershell
pnpm dlx supabase@2.117.0 migration new aciklayici_degisim_adi
```

supabase/seed.sql kasıtlı olarak kişisel veri içermez. Ayrı sahte veri seed komutu yoktur; sahibi owner-setup.sql ile yetkilendir, ardından ilk girişte GET /api/state profil ve başlangıç kataloğunu oluşturur.








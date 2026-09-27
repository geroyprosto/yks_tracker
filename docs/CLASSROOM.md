# Öğretmen, öğrenci ve yönetici alanı

## Yerel demoyu açma

```powershell
pnpm dev:demo
```

Bilgisayarda `http://127.0.0.1:3300/demo` adresini açın. Bu adres internete açık değildir. Komut, gerçek Supabase/e-posta/AI anahtarlarını alt süreçte devre dışı bırakır ve ayrı bir PGlite veritabanı kullanır. Mevcut 3000 portundaki uygulamaya dokunmaz.

- **Ayşe Demir:** 10 öğrenci.
- **Mehmet Yıldız:** 25 öğrenci.
- **Ecrin Yılmaz:** Ayşe öğretmenin öğrencisi; mesaj ve uyarıları denemek için uygun.
- **Kerem Şahin:** zamanlayıcı ve ikinci cihaz denemeleri için uygun.
- **Sümeyra · Demo Yönetici:** başvuruları onaylar, reddeder, öğretmen atar ve erişimi durdurur.
- **Selma Deniz / Ali Çınar:** örnek bekleyen başvurular.

Demo sayfasından hesabı seçmek yeterlidir; demo şifresi bulunmaz. Öğretmen ve öğrenciyi aynı anda denemek için iki farklı tarayıcı profili veya gizli pencere kullanın. Aynı profilin sekmeleri aynı oturumu paylaşır. Gerçek kayıt formu `/register`, sınıf alanı `/classroom` adresindedir. Yerel kayıt formunda **Başvuruyu demo olarak dene** seçeneği bulunur; e-posta gönderilmez ve şifre saklanmaz.

Üretimde `NODE_ENV=production` demo geçişini, demo başvurusunu ve yerel veritabanını kapatır; ortam değişkenini yanlışlıkla açmak bu kontrolü geçersiz kılamaz. Demo oturumu gerçek Supabase kimliği üretmez.

## Veri ve yetkilendirme

Yeni migration dosyaları:

- `20260925214354_classroom.sql`: hesaplar, başvurular, davetler, mesajlar, uyarılar, geri bildirimler, presence, istek makbuzları ve realtime olayları.
- `20260925215017_classroom_email_delivery.sql`: yalnızca sunucu servisinin kullanabildiği kalıcı e-posta kuyruğu.
- `20260926024334_classroom_study_order_lock.sql`: 10. ret sonrası beş dakikalık sunucu kilidi ve 15 dakikalık hatırlatma metni.
- `20260926030009_independent_student_accounts.sql`: doğrulanmış, davetsiz öğrenciye bireysel çalışma alanı açar; öğretmen davetiyle yapılan katılımı yönetici onayına bırakır ve önceki bekleyen davetsiz öğrenci başvurularını etkinleştirir.
- `20260926033638_email_free_registration_limit.sql`: e-posta göndermeyen sunucu kayıt yoluna kalıcı istek sınırı ekler.
- `20260926034053_application_approval_scope.sql`: yeni öğretmen ve bireysel öğrencileri yönetici onayına, davetli öğrencileri öğretmen onayına alır; yöneticiye tüm başvurularda müdahale yetkisi verir ve eski e-posta kuyruğunu devre dışı bırakır.
- `20260926045355_classroom_background_study_presence.sql`: çevrimiçi durumu cihaz kirasından, çalışan ders durumunu kayıtlı sayaçtan ayrı hesaplar.

Yönetici, `classroom_accounts` tablosunda `admin` rolüyle onaylanmış ayrı bir Auth hesabı olabilir. `owner_allowlist` ve `ALLOWED_USER_EMAIL` önceki sahibin özel çalışma verilerini korumayı sürdürür. Kayıt formu ve başvuru RPC'si yönetici rolünü kabul etmez. Başvuru rolü erişim yetkisi sağlamaz; Auth oturumu ile veritabanındaki onaylı hesap birlikte kontrol edilir. Kayıt sunucuda Auth hesabını e-posta bağlantısı göndermeden oluşturur. Auth kaydının teknik olarak onaylı işaretlenmesi, e-posta adresinin başvurana ait olduğunu kanıtlamaz. Şifreler yalnızca Supabase Auth'a gönderilir; yönetici ve öğretmen şifreleri göremez.

Öğretmen istatistikleri, kendi onaylı öğrencilerini döndüren dar kapsamlı RPC üzerinden gelir. Doğrudan tablo erişimleri kapalıdır; RLS etkin ve tablo izinleri geri alınmıştır. Öğretmen çalışma komutlarını kullanamaz. Öğrencinin günlüğü, kişisel notları, PDF belgeleri ve harici bağlantıları öğretmen çıktısına dahil edilmez. Öğrenci kendi kayıtlarını mevcut komut katmanından yönetir. Önceki sahip hesabının özel MCP ve AI entegrasyonlarına öğretmen yetkisi verilmez; yeni AI veya ödeme entegrasyonu eklenmemiştir.

Yeni davetsiz öğrenci ve öğretmen yönetici onayını bekler. Davetli öğrenci kendi öğretmeninin onayını bekler; yönetici her başvuruyu görüp gerektiğinde onaylayabilir veya reddedebilir. Önceden onaylanmış bireysel öğrencilerin erişimi korunur. Bireysel öğrenci daha sonra bir davetle başvurduğunda hesabı ve çalışma alanı açık kalır; mevcut sınıf ilişkisi varsa o da yeni başvuru onaylanana kadar korunur. Onay/ret ve mesaj/uyarı işlemleri istek UUID'si ile tekrar güvenlidir. İptal edilmiş/süresi dolmuş davetler başvuru oluşturamaz. Davetler 64 karakter rastgele token içerir ve birden fazla öğrenci tarafından kullanılabilir.

## Metrikler ve canlı durum

Günler **Europe/Istanbul**, haftalar **pazartesi–pazar** olarak hesaplanır. Süre, aktif çalışma aralıklarının gün sınırlarında bölünmüş birleşimidir; molalar eklenmez. Tarihli manuel süre kayıtları mevcut modeldeki gibi ayrıca dahil edilir. Güncel TYT/AYT, tarih ve kayıt zamanına göre son tamamlanmış denemedir; en yüksek sonuç değildir. AYT sayısal ve branş modeli korunur. Eksik veri `—` ile gösterilir.

Presence, cihaz başına 30 saniyelik heartbeat ve 75 saniyelik kira kullanır. Öğrenci sekmesi arka planda açıkken kira yenileniyorsa çevrimiçi görünür; site kapanınca çevrimiçi durumu düşer. Çalışıyor/molada bilgisi kayıtlı zamanlayıcıdan gelir: çalışan sayaç site kapalıyken de sunucu zamanına göre **Çalışıyor** görünür, duraklatılmış sayaçla kapalı site **Çevrimdışı** görünür. Tarayıcı kapalıyken JavaScript ve uyarı ekranı çalışmaz. Realtime kanal yalnızca kullanıcıya ait veri değişikliği kimliklerini taşır; istatistikler yeniden yetki denetiminden geçerek alınır. Öğretmen ekranı ayrıca 30 saniyede bir güncel durumu alır; bağlantı yeniden kurulurken de yeniler. SSE bağlantıları sunucusuz ortam süre sınırı için yenilenir.

Öğretmen, öğrenci satırındaki ayrı **Çalışma emri gönder** düğmesiyle tam ekran komut yollar. Öğrenci **Tamam** veya **Hayır** seçer; Tamam cevabı `accepted_at` ve 15 dakika sonrası için veritabanı tarihi oluşturur, ekranda geri sayım gösterir. Tamam, çalışma zamanlayıcısını kendi başına başlatmaz. Gerçek ders başlangıcı/yeniden başlatılması ayrı kaydedilmiş interval olayıdır. Bu sürede ders başlamazsa **“E hani başlıyordun?”** takip ekranı görünür. Zamanlayıcı tetikleyicisi, periyodik veritabanı görevi ve tekrar bağlantıda yapılan kontrol birlikte çalışır. İkinci uyarı ve geri bildirimlerde benzersizlik kısıtları vardır. **Hayır** sayısı sunucuda tutulur; düğme her ret sonrasında yer değiştirir. 10. basış tek geri bildirim üretir ve **“Peki, sen bilirsin.”** ekranını beş dakika boyunca sunucuda da kapatılamaz kılar. Süre dolduğunda ekran kapatılabilir. Öğrencinin formu ve zamanlayıcısı bu ekran sırasında korunur.

Uzak Supabase projesinde `classroom-alert-followup` adlı pg_cron görevi dakikada bir çalışır. Dolayısıyla zaman eşiği 15 dakikadır; periyodik yakalama bir dakikaya kadar gecikebilir. PostgreSQL eklentisi bulunmayan başka kurulumlarda `/api/cron/classroom` uç noktasını dakikada bir `Authorization: Bearer CRON_SECRET` ile çağırın. Çevrimdışı öğrenci uyarıyı sonraki bağlantıda görür; kapalı tarayıcı üzerinde ekran gösterilmez.

## Demo seed ve simülasyon

`src/lib/classroom/demo-seed.ts` içindeki `seedClassroomDemo(db, now)` yalnızca yerel PGlite şeması üzerinde çalışır. Aynı sürüm ve İstanbul gününde tekrar çağırmak kayıt çoğaltmaz veya aynı gün yaptığınız demo işlemlerini sıfırlamaz. Gün değişince sabit örnek kayıtların tarihleri yenilenir; eklenen demo kayıtları korunur. Yerel veri `tmp/classroom-demo` altında kalıcıdır. Testler ayrı `tmp/classroom-demo-e2e` veritabanı kullanır.

`refreshDemoPresence(db, now)` iki sınıftaki altı açıkça simüle edilmiş cihazı bağlı tutar; çalışma başlatmaz, interval veya süre eklemez. Çalışıyor/molada bilgisi kayıtlı zamanlayıcı durumundan gelir. Ecrin ve Kerem'in cihazları gerçek tarayıcı heartbeat ve zaman aşımıyla çalışır. Demo ekranındaki bağlantı durumları gerçek öğrenciler hakkında bilgi değildir.

## Gerçek kayıt ve e-posta kurulumu

Canlı uygulama: **https://yks-tracker-puce.vercel.app**. `/register` üzerinde ad, soyad, e-posta adresi ve en az 10 karakterli şifre alınır. Sunucu, `SUPABASE_SECRET_KEY` ile Auth kullanıcısını oluşturur ve kalıcı veritabanı sayacıyla kayıt denemelerini sınırlar. Başvurana veya yöneticiye onay e-postası gönderilmez. E-posta adresi giriş kimliği olarak kullanılır; sahipliği bu kayıt akışında doğrulanmaz. Onaylayan kişi adı, adresi, rolü ve davetli öğrenci için öğretmeni ekranda görür. Kullanıcı şifresi uygulama veritabanında tutulmaz ve onaylayan kişilere gösterilmez.

26 Eylül 2026 canlı güncellemesi: `email_free_registration_limit` ve `application_approval_scope` migration'ları uzak veritabanına sırasıyla `20260926034641` ve `20260926034647` sürümleriyle uygulandı. Vercel üretim yayını `dpl_FeVF5reQizWCE1vkhA96RoPBTKk9` hazır. Gerçek kayıt uç noktasında geçici bireysel başvuru `pending` döndü; onay öncesi çalışma API'si 403 verdi. Test hesabı silindi. Önceden doğrulama e-postası bekleyen öğretmen hesabı, kendi şifresi korunarak bekleyen yönetici başvurusuna alındı.

Arka plan durumu güncellemesi: `classroom_background_study_presence` migration'ı canlı veritabanına `20260926045355` sürümüyle uygulandı. Vercel üretim yayını `dpl_H9F3go79MXFMNgJpFfRpJvEjCRvW` hazır ve `https://yks-tracker-puce.vercel.app` adresine bağlı. Oturum API'si ve sınıf sayfası canlı adreste başarılı yanıt verdi.

Yeni öğretmen ve bireysel öğrenci başvuruları `/classroom` yönetici ekranına düşer. Öğretmen davetiyle gelen yeni veya mevcut öğrenci kendi öğretmeninin **Başvurular** sekmesine düşer; yönetici bütün başvuruları görüp karar verebilir. Onay öncesi yeni hesap çalışma veya öğretmen alanına erişemez. Önceden onaylanmış bireysel hesaplar etkin kalır. Onay kararı e-postaya gönderilmez; başvuran giriş yapıp başvuru ekranını yenileyerek durumunu görür.

Öğretmen davet bağlantısını öğrenciye kendi kanalıyla verir. `/join?token=...` ekranı öğretmenin adını gösterip **Evet** veya **Hayır** seçimi ister; **Hayır** başvuru oluşturmaz. **Evet** yeni hesap için kayıt formuna, mevcut hesap için giriş formuna götürür. Bireysel öğrenci yeni bir sınıfa başvururken mevcut çalışma erişimini korur; öğretmen ilişkisi ancak yeni başvuru onaylanınca değişir. İptal edilen veya süresi dolan davetle kayıt yapılamaz.

Supabase Auth'un genel e-posta doğrulaması ayarı açık kalabilir; uygulama içi kayıtlar doğrulama bağlantısı kullanmaz. Daha önce başlatılmış, doğrulama e-postası ulaşmadığı için bekleyen Auth hesapları ayrı ele alınmalıdır. SMTP daha önce Gmail üzerinden yapılandırılmıştı; `/forgot-password` ve `/reset-password` hâlâ e-posta teslimine bağımlıdır. Yeni kayıt akışının çalışması, şifre sıfırlama e-postasının her adrese ulaştığını kanıtlamaz. Şifre sıfırlama için `APP_ORIGIN/auth/callback?type=recovery` dönüş adresi Supabase izin listesinde olmalıdır.

`CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED`, `ADMIN_NOTIFICATION_EMAIL` ve Resend değişkenleri eski bildirim yolunun ayarlarıdır; uygulama içi onay migration'ı e-posta kuyruğunu kapatır. `.env.example` sır içermeyen değişkenleri listeler. Yerel geliştirmede `localhost` ile `127.0.0.1` çerezleri ayrı olduğundan bir akışı aynı tarayıcı ve sunucu adresinde tamamlayın.

## Doğrulama

Teslim kontrolü: 224 birim/veritabanı testi ve 6 gerçek veri akışlı sınıf tarayıcı senaryosu geçti. Sınıf senaryoları 320×568, 568×320, 375×812, 768 ve 1440 genişliklerinde kontrol içerir. Lint, TypeScript, yerel ve Vercel üretim build başarılı. Öğretmen koyu görünümündeki önceki otomatik erişilebilirlik taramasında sıfır kesin ihlal kalmıştı; yeni başvuru ekranları sınıf tarayıcı testlerinde doğrulandı.

```powershell
pnpm lint
pnpm typecheck
pnpm test:all
pnpm test:e2e
pnpm test:classroom
pnpm build
```

Genel ve sınıf Playwright sunucuları `.next-e2e` kullandığından bu iki tarayıcı komutunu sırayla çalıştırın. Sınıf testleri gerçek yerel API ve Postgres veritabanıyla, ağ yanıtlarını taklit etmeden çalışır. 15 dakikalık zaman geçişleri, cihaz değişimi, eski interval ve tekrar giriş senaryoları veritabanı testlerinde doğrulanır. Son kayıt güncellemesinde birim/veritabanı testleri, 8 kurtarma testi, kayıt/onay tarayıcı senaryosu, TypeScript ve üretim derlemesi geçti. Tam sınıf tarayıcı koşusundaki mesajlaşma senaryosu Playwright trace dosyası hatası verdi; ilgili kayıt/onay senaryosu ayrı koşuda başarılı oldu.

Görsel kontrol kaynakları: [Claude](https://claude.com/product/overview) ve [Linear](https://linear.app/). Bu ürünlerin nötr yüzey ve ölçülü vurgu yaklaşımından hareket edildi; öğrenci teması yeniden tasarlanmadı. Öğretmen açık/koyu görünümü ve adaçayı/mavi gri/mürdüm tercihleri ayrı anahtarlarla saklanır.

Supabase güvenlik danışmanı sınıf tablolarındaki **RLS açık, politika yok** kayıtlarını bilgi düzeyinde bildirir; bunlar doğrudan erişimi kapalı tutan bilinçli RPC tasarımıdır. Mevcut projede sızdırılmış şifre koruması ayarı ayrıca kapalıdır; sağlayıcı planınız destekliyorsa [şifre korumasını](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) etkinleştirebilirsiniz.

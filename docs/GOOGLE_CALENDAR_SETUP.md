# Google Takvim kurulumu

Bu bağlantı, uygulama girişinden ayrı bir Google iznidir. Yalnızca seçilen takvimlerdeki **bugünün etkinlikleri** okunur. Uygulama takvime yazmaz; etkinlik süresini çalışma istatistiğine dönüştürmez.

**Yerel canlı durum (24 Eylül 2026):** YKSim'in Google Web OAuth istemcisi ve sunucu sırları yerel ortamda tanımlandı; uygulama sunucusu yeniden başlatıldı. Sahip, uygulamadaki Google izin akışını tamamladı. Bulut veritabanında sahibine ait bir bağlantı, üç seçili takvim ve dolu `last_success_at` doğrulandı; en az bir Calendar API okuması başarılı. Bu sonuç, bağlantıyı kesme/yeniden bağlama, izin iptali, token yenileme veya farklı günlerdeki etkinliklerin gerçek hesapla sınandığı anlamına gelmez.

## Sahip hesabı için kurulum

1. Supabase kurulumunu ve sahip hesap girişini tamamla. `google_calendar_connections` migration dosyasını uygula.
2. Google Cloud Console'da bir proje aç, **Google Calendar API**'yi etkinleştir ve OAuth izin ekranını hazırla. Uygulama test modundaysa kendi Google hesabını test kullanıcısı olarak ekle.
3. **Web application** türünde OAuth istemcisi oluştur. Yetkili yönlendirme adresi olarak yerel kullanım için `http://localhost:3000/api/calendar/callback`, yayın için kendi HTTPS alan adındaki `/api/calendar/callback` adresini ekle. Adresin şeması, alan adı, portu ve sonundaki `/` Google Console kaydıyla bire bir aynı olmalı.
4. Sunucu ortamına aşağıdaki değişkenleri ekle. Hiçbirini `NEXT_PUBLIC_` ile başlatma; gerçek değerleri repository'ye yazma.

   - `APP_ORIGIN`: örn. `http://localhost:3000` veya `https://uygulaman.example` (sonunda yol/`/` yok).
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Web OAuth istemcisinden.
   - `SUPABASE_SECRET_KEY`: Supabase proje ayarlarından **secret key** (`sb_secret_...`). Sunucu tarafından yalnız Google bağlantı satırlarını okumak/yazmak için kullanılır. Tam veri yetkisi verdiğinden tarayıcıya gönderilmemelidir.
   - `GOOGLE_TOKEN_ENCRYPTION_KEY`: rastgele 32 bayt anahtarın base64 biçimi. Yerelde `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` ile oluştur. Anahtarı değiştirmeden önce Google bağlantısını kes. Anahtar kaybolursa eski belirteç çözülemez; yerel kaydı silip Google Hesabı izinlerinden erişimi kaldırarak yeniden bağlan.

5. Uygulamayı yeniden başlat. Ayarlar → Bağlantılar → Google Takvim → **Bağla** yolunu kullan. Google izin ekranında yalnızca `calendar.events.readonly` ve `calendar.calendarlist.readonly` kapsamları istenir. Takvimleri işaretleyip seçimi kaydet.

Bağlantıyı kesmek Google'dan izni iptal etmeyi dener ve yerel şifreli belirteci siler. Google erişilemezse yerel kayıt yine silinir; bu durumda [Google Hesabı üçüncü taraf bağlantıları](https://myaccount.google.com/connections) sayfasından uygulama iznini ayrıca kaldır.

## Veri ve hata sınırları

- OAuth `state` ve PKCE doğrulayıcısı 10 dakikalık, HttpOnly, SameSite=Lax çerezlerdir; callback sonrası silinir.
- Yenileme belirteci sunucuda AES-256-GCM ile şifrelenerek saklanır. Google erişim belirteci yalnızca tek sunucu isteğinin belleğinde tutulur.
- Google etkinlik API'si tekrarları tekil olaylara açacak şekilde sorgulanır, iptaller dışlanır, tüm sayfalar okunur. Gün sınırı Europe/Istanbul üzerinden hesaplanır; tüm gün ve gece yarısını aşan etkinlikler dahil edilir.
- Bugün kartı açılışta, pencereye dönünce, beş dakikalık aralıkta ve elle yenilenir. Çevrimdışında son görülen program geçici olarak ekranda kalır, kalıcı takvim kopyası oluşturulmaz.
- Google izni kaldırılır veya yenileme belirteci geçersizleşirse yeniden bağlantı gerekir. İlk canlı OAuth akışı ve Calendar API okuması doğrulandı; izin iptali, yeniden bağlanma ve belirteç yenileme akışları ayrıca denenmelidir.

Resmî belgeler: [Google Calendar kapsamları](https://developers.google.com/workspace/calendar/api/auth), [OAuth web sunucusu akışı](https://developers.google.com/identity/protocols/oauth2/web-server), [Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [Supabase API anahtarları](https://supabase.com/docs/guides/getting-started/api-keys).

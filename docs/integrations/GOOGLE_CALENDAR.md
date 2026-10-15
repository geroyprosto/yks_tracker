# Google Takvim bağlantısı

Uygulama girişinden ayrı bir Google OAuth iznidir. Yalnız seçilen takvimlerdeki bugünün etkinlikleri okunur; takvime yazılmaz ve etkinlik süreleri çalışma kayıtlarına eklenmez. Önce [Supabase ve hesap kurulumunu](../SETUP.md) tamamla.

Bu rehber uygulamanın entegrasyon sözleşmesidir. Önceki Google Console ayarları veya doğrulama durumu güncel kabul edilmez; tarihli canlı kayıt [arşivdedir](../archive/GOOGLE_CALENDAR_HISTORY.md).

## Kurulum

1. Güncel migration zincirini uygula; [Google bağlantı migration'ı](../../supabase/migrations/20260924141529_google_calendar_connection.sql) bu zincirin parçasıdır.
2. Google Cloud projesinde Calendar API ve OAuth izin ekranını hazırla. **Web application** istemcisi oluştur.
3. İstemciye kullandığın uygulamanın tam callback adresini ekle: yerelde `http://localhost:3000/api/calendar/callback`, üretimde `https://alan-adi/api/calendar/callback`. `APP_ORIGIN` aynı şema, host ve portu göstermeli. `localhost` ile `127.0.0.1` farklı origin'lerdir. JavaScript origin eklemek callback kaydının yerine geçmez.
4. Aşağıdaki sunucu değişkenlerini ayarla; hiçbirini `NEXT_PUBLIC_` ile dışarı açma.

| Değişken | Değer/sorumluluk |
| --- | --- |
| `APP_ORIGIN` | Yalnız şema ve host/port; yol veya sonda `/` olmadan |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Web OAuth istemcisi |
| `SUPABASE_SECRET_KEY` | Şifreli bağlantı kaydına sunucu erişimi |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Rastgele 32 bayt anahtarın base64 biçimi |

Anahtar üretmek için yerel terminalde:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Üretilen değeri yalnız sunucu ortamında sakla. Şifreleme anahtarını değiştirmeden önce bağlantıları kesip yeniden bağlanmayı planla; eski anahtarla şifrelenen belirteçler yeni anahtarla açılamaz.

5. Sunucuyu yeniden başlat. Uygulamadaki Google Takvim ayarından bağlan; takvimleri seçip kaydet. İstenen kapsamlar `calendar.events.readonly` ve `calendar.calendarlist.readonly` ile sınırlıdır.
6. İzin ekranının test/üretim ve doğrulama koşullarını kendi Google Cloud projen için kontrol et. Google hesabının olması tek başına uygulamaya erişim hakkı vermez; YKSim hesap/onay denetimi ayrıca sürer.

Alan adı değişince `APP_ORIGIN`, Supabase Site URL/redirect ayarları ve Google callback adreslerini birlikte güncelle. `/about`, `/privacy` ve `/terms` sayfaları uygulamada bulunur; OAuth marka/izin ayarlarında doğru ortamın adreslerini kullan.

## Veri akışı ve hata sınırları

- OAuth `state` ve PKCE doğrulayıcısı 10 dakikalık HttpOnly, SameSite=Lax çerezleridir; callback sonrası silinir.
- Yenileme belirteci sunucuda AES-256-GCM ile şifrelenir. Erişim belirteci sunucu isteğinin belleğinde tutulur; tarayıcıya dönmez.
- Gün sınırı `Europe/Istanbul` üzerinden hesaplanır. Tekrarlanan etkinlikler açılır, iptaller dışlanır ve sayfalar okunur; tüm gün/gece yarısını aşan etkinlikler ilgili güne dahil edilir.
- Bugün kartı açılışta, pencereye dönünce, beş dakikada bir ve elle yenilenir. Çevrimdışında son görünüm geçici olarak kalabilir; kalıcı takvim kopyası oluşturulmaz.
- Bağlantıyı kesme Google iznini iptal etmeyi dener ve yerel şifreli kaydı siler. Google erişilemiyorsa yerel silme yine yapılır; kullanıcı Google hesabındaki uygulama izinlerini ayrıca kaldırabilir.

## Kod ve kabul

[Calendar route'ları](../../src/app/api/calendar), [sunucu OAuth/okuma servisi](../../src/lib/server/google-calendar.ts), [token deposu](../../src/lib/server/google-calendar-store.ts), [tarih ve etkinlik kuralları](../../src/lib/google-calendar.ts) ve [ayar bileşeni](../../src/components/google-calendar-settings.tsx) birlikte bu entegrasyonu oluşturur.

[Birim testleri](../../tests/google-calendar.test.ts), [sunucu testleri](../../tests/google-calendar-server.test.ts) ve [tarayıcı senaryosu](../../tests/e2e/calendar.spec.ts) yerel sözleşmeyi doğrular. Gerçek hesapta bağlama, seçme, okuma, bağlantıyı kesme, izin iptali ve yeniden bağlamayı ayrıca dene. Token yenileme, tekrar eden/tüm gün/gece yarısı etkinlikleri canlı kabulde ayrı kontrol edilir.

Sağlayıcı kaynakları: [OAuth web sunucusu akışı](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar kapsamları](https://developers.google.com/workspace/calendar/api/auth), [Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list). Sağlayıcı paneline ilişkin değişken koşulları uygulama kodundan çıkarma.

# Çalışma alanı güncelleme kontrolü

Çalışma alanı, diğer oturumlardaki değişiklikleri kısa HTTP sürüm kontrolleriyle fark eder. Supabase kalıcı kayıt kaynağıdır. Redis'te kullanıcı başına tutulan opak bir sürüm değeri yalnızca yeni durum okunması gerektiğini bildirir; çalışma kayıtlarının yerine geçmez.

Bu belge güncel akışı anlatır. Eski SSE ve kanal aboneliği tasarımı [tarihsel kayıtta](../archive/REALTIME_HISTORY.md) korunur. Tam durum önbelleği ayrı bir mekanizmadır; [performans referansına](../reference/PERFORMANCE.md) bakın.

## Bir değişikliğin akışı

1. Web çalışma/eğitim komutu veya MCP sahip komutu Supabase işleminden başarılı sonuç alır.
2. `scheduleStudyDirty`, cevap sonrasında kimliği doğrulayıp `publishStudyDirty` çağrısını planlar. Doğrulanmış sunucu kimliği varsa tekrar Auth isteği gerekmez.
3. Redis'teki kullanıcıya ait sürüm anahtarı yeni rastgele UUID ile değiştirilir. Değerin ömrü yedi gündür; mesaj geçmişi, stream veya PubSub aboneliği oluşturulmaz.
4. Görünür ve çevrimiçi çalışma alanı `GET /api/realtime?session=1` ile sürümü kontrol eder.
5. Sürüm değişmişse istemci normal `/api/state` okumasını planlar. Gelen durum, bekleyen yazmalar ve eski okuma yanıtları için Dashboard'un mevcut korumalarından geçer.

Redis işlemi kayıt cevabını bekletmez. Kimlik doğrulama veya Redis bildirimi başarısız olursa başarılı Supabase kaydı geri alınmaz. Kullanıcının kendi işleminin ekranda hemen görünmesi istemci yazma kuyruğundan gelir; diğer oturumun değişikliği fark etmesi sürüm kontrolü ve ardından durum okumasını bekler.

## HTTP ve yetki sözleşmesi

`GET /api/realtime?session=1` her istekte canlı hesap yetkisini ve origin bilgisini denetler. Erişim `requireAiStudyContext` ile onaylı öğrenci veya mevcut sahip bağlamına sınırlıdır. Kullanıcı kimliği ve Redis anahtarı istek girdisinden alınmaz.

| Durum | Yanıt |
| --- | --- |
| Redis yapılandırılmış, sürüm mevcut | `{ "enabled": true, "version": "<uuid>" }` |
| Redis yapılandırılmış, henüz sürüm yazılmamış | `{ "enabled": true, "version": null }` |
| Redis yapılandırılmamış | `{ "enabled": false }` |
| Demo hesabı | HTTP 403, `DEMO_INTEGRATION_DISABLED`; canlı Redis'e erişilmez. |
| Redis hatası veya beklenmeyen değer | HTTP 503, `REALTIME_UNAVAILABLE`; upstream ayrıntıları dönmez. |

Yanıtlar `private, no-store` kullanır. Redis kimlik bilgisi, çalışma kaydı, komut girdisi veya kullanıcı kimliği dönmez. Anahtar kapsamı Supabase proje URL'si, `VERCEL_ENV` ve doğrulanmış kullanıcı kimliğinin SHA-256 özetinden oluşur; aynı proje ve production ortamındaki iki adres aynı kapsamı paylaşır.

Eski açık sekmelerin kendi kanalına yaptığı SSE isteği yetki kontrolünden sonra HTTP **204** alır; bu, EventSource yeniden bağlanmasını durdurur. Başka kanal, birden çok kanal veya `session=1` ile kanal parametresinin birleşimi reddedilir. Güncel istemci SSE bağlantısı açmaz. `@upstash/realtime` paketinin bağımlılıklarda bulunması, bu akışta kullanıldığı anlamına gelmez.

## Yenileme ve hata davranışı

| Koşul | Davranış |
| --- | --- |
| Sağlıklı, görünür, çevrimiçi sekme | Yanıt tamamlandıktan yaklaşık 30 saniye sonra yeni sürüm kontrolü. |
| İlk başarılı sürüm kontrolü | İlk durum okuması ile sürüm tabanı arasındaki olası boşluğu kapatmak için durum yenilemesi. |
| Sürüm değişti | Durum yenilemesi. |
| Sürüm değişmedi | Yaklaşık beş dakikada bir onarım okuması. |
| Redis kapalı veya kontrol hatası | Yaklaşık 120 saniyelik kontrol/onarım aralığı. |
| Sekme tekrar görünür veya bağlantı geri geldi | Hemen kontrol ve onarım okuması. |
| Gizli sekme veya çevrimdışı durum | Zamanlayıcı durur, etkin istek iptal edilir. |

Her HTTP kontrolünün istemcide 10 saniye zaman aşımı vardır. Redis istemcisi 500 ms ile sınırlıdır ve otomatik yeniden deneme yapmaz. Cevap sonrası işte Auth doğrulaması ve yayın için ayrıca süre sınırları bulunur. İstemcinin `connected` durumu son sürüm kontrolünün başarısını ifade eder; açık sunucu bağlantısı anlamına gelmez.

Doğrudan SQL veya `scheduleStudyDirty` kullanmayan yazmalar sürüm değerini değiştirmeyebilir. Onarım okumaları bu boşluğu kapatır. Sürümün Redis'ten silinmesi veya süresinin dolması da bir değer değişimi olarak algılanabilir; bu veri kaybı sayılmaz.

## Kurulum ve kod haritası

Sunucuda `UPSTASH_REDIS_REST_URL` ve `UPSTASH_REDIS_REST_TOKEN` kullanılır. Aynı Redis tam durum önbelleğini de sağlayabilir. Token tarayıcıya verilmez. `CLASSROOM_DEMO_ENABLED=true` iken canlı Redis'e erişilmez. Genel ortam kurulumu [SETUP.md](../SETUP.md) içindedir.

| Kaynak | Sorumluluk |
| --- | --- |
| [`src/lib/server/study-realtime.ts`](../../src/lib/server/study-realtime.ts) | Redis istemcisi, kapsam, sürüm yazımı ve cevap sonrası bildirim planlama. |
| [`src/lib/server/study-realtime-route.ts`](../../src/lib/server/study-realtime-route.ts) | Kısa sürüm kontrolü, origin/kanal doğrulaması ve eski SSE istemcisine 204. |
| [`src/app/api/realtime/route.ts`](../../src/app/api/realtime/route.ts) | Canlı hesap yetkisini route'a bağlar. |
| [`src/lib/realtime-client.tsx`](../../src/lib/realtime-client.tsx) | Görünürlük, ağ, sürüm ve onarım zamanlayıcısı. |
| [`src/components/dashboard.tsx`](../../src/components/dashboard.tsx) | Bildirimi güvenli durum okumasına bağlar; bekleyen yazmaları korur. |

## Doğrulama

```powershell
pnpm exec tsx --test tests/study-realtime.test.ts
pnpm exec playwright test tests/e2e/study-realtime.spec.ts
```

Testler sahip/ortam izolasyonunu, origin kontrolünü, gizli değerlerin yanıtta yer almamasını, kayıt sonrası bildirim sırasını, Redis hata geri dönüşünü, eski SSE bağlantılarının kapanmasını ve tarayıcı yenileme davranışını kapsar. Genel test önkoşulları [TESTING.md](../TESTING.md) içindedir.

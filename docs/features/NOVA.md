# Nova: günlük simülasyon ve yarış

Nova, YKSim içinde kalıcı bir gün programı ve kullanıcının gerçek çalışma kayıtlarıyla karşılaştırılan ayrı bir yarış puanı bulunan dijital çalışma arkadaşıdır. `/nova` veya ana menüdeki Nova bölümünden açılır. Varsayılan görünüm **Nova Bugün**'dür; model kurulumu veya bilgisayarda yardımcı süreç gerektirmez.

Önce bu belgeyi okuyun. Motorun veri ve puanlama kuralları [NOVA_CORE.md](../reference/NOVA_CORE.md), genel geliştirme ve test akışı [DEVELOPMENT.md](../DEVELOPMENT.md) ile [TESTING.md](../TESTING.md) içindedir.

## Ürün sınırı

| Görünüm | İçerik |
| --- | --- |
| Nova Bugün | Mevcut simüle etkinlik, gün akışı, tamamlanan çalışma süresi, enerji/odak/stres ve yarışa geçiş. |
| Yarış | Gerçek kullanıcı ölçümleri ile Nova ölçümlerinin 0–100 puan karşılaştırması; bileşenler ve kesinleşmiş ortak günlerin toplamı. |
| Nova Lab | Simülasyon tercihleri, motor sürümü, gün tohumu, yerel tarih ve yansıtılmış simülasyon durumu. |

Nova'nın çalışmaları kullanıcının çalışma kayıtlarına veya gerçek liderlik tablosuna yazılmaz. Simülasyon durumları ve puan ağırlıkları ürün parametreleridir; psikolojik ölçüm veya sınav başarısı tahmini değildir. Eksik ölçümler iki taraftan da çıkarılır ve kalan ağırlıklar normalize edilir. Soru kaydı doğru/yanlış içermiyorsa doğruluk üretilmez.

## Kodda izlenecek akış

1. [`src/components/nova/workspace.tsx`](../../src/components/nova/workspace.tsx) Bugün/Yarış/Lab görünümlerini yönetir; `/api/nova` durumunu okur ve ayar komutunu gönderir.
2. [`src/app/api/nova/route.ts`](../../src/app/api/nova/route.ts) HTTP sınırıdır. GET durumu senkronize eder; POST aynı origin kontrolünden sonra komutu doğrular.
3. [`src/lib/server/nova.ts`](../../src/lib/server/nova.ts) hesap yetkisini doğrular, gerçek çalışma durumunu okur, eksik günleri oluşturur ve tamamlanan günleri kesinleştirir.
4. [`src/lib/nova/core.ts`](../../src/lib/nova/core.ts) verilen saat, seed ve ölçümlerden günlük simülasyonu üretir. [`presentation.ts`](../../src/lib/nova/presentation.ts) ortak ölçüm seçimini, [`race-summary.ts`](../../src/lib/nova/race-summary.ts) haftalık toplamı hesaplar.
5. [`src/lib/nova/web-types.ts`](../../src/lib/nova/web-types.ts) tarayıcıya gönderilen durum sözleşmesidir. Ham veritabanı durumu yerine bu dar yanıt kullanılır.

GET yalnızca tablo okuması değildir: ilk profil/gün oluşturma, geçmiş gün tamamlama ve yarış gözlemi kaydetme işlemleri yapabilir. Bu işlemler kullanıcının gerçek çalışma kayıtlarını değiştirmez.

## Erişim ve API

Nova, sunucuda `NOVA_ENABLED=true`, onaylı öğrenci veya yönetici hesabı ve iptal edilmemiş ayrı bir `nova_access_grants` kaydı gerektirir. Ortam değişkenini açmak hesaplara otomatik izin vermez. Sunucu RPC'leri için sunucuda `SUPABASE_SECRET_KEY` gerekir; tarayıcıya verilmez. Ortam kurulumu [SETUP.md](../SETUP.md) içindedir.

| İstek | Sözleşme |
| --- | --- |
| `GET /api/nova` | `serverNow`, `profile`, yansıtılmış `today`, `dayInfo`, `race`, `weekly`, `settings`, `catchupRemaining` ve `demo` döner. |
| `POST /api/nova` | Yalnız `{ "operation": "settings", "settings": { ... } }` kabul edilir. Desteklenen ayarlar `timezone` ve 0–0,05 aralığındaki `weekly_adaptation_limit` değeridir. |

İlk resmî gün oluştuktan sonra farklı saat dilimine geçiş veritabanında `NOVA_TIMEZONE_LOCKED` ile reddedilir. Aynı dilimin tekrar kaydı serbesttir. Proaktif mesaj, hafıza veya cihaz ayarları güncel HTTP sözleşmesinde kabul edilmez.

Güncel sunucu yalnız şu RPC'leri kullanır:

| Yetki | RPC'ler | Amaç |
| --- | --- | --- |
| Tarayıcı hesabı | `nova_access`, `nova_settings_update` | Erişim kontrolü ve simülasyon ayarları. |
| Sunucu | `nova_engine_initialize`, `nova_engine_state`, `nova_engine_day`, `nova_engine_race` | Profil, güvenilir snapshot okuması, günlük kayıt/finalizasyon ve yarış gözlemi. |

Veritabanında RLS ve RPC içi sahip/erişim kontrolleri bulunur. Aktif depolama; `nova_access_grants`, `nova_profiles`, `nova_settings`, `nova_daily_states` ve `nova_events` üzerinden ilerler. Şemanın kaynağı [Nova migration'ı](../../supabase/migrations/20261013123222_nova_local_companion.sql) ve onu izleyen migration'lardır. Arşivdeki [eski veritabanı sözleşmesi](../archive/NOVA_DATABASE_HISTORY.md), kaldırılmış sohbet RPC'lerini de içerir; güncel kurulum veya uygulama API rehberi olarak kullanılmaz.

## Kalıcılık ve yenileme

Gün snapshot'ı `nova_id + local_date` için bir kez saklanır. Seed veya motor sürümünün değişmesi ikinci bir resmî gün üretmez; geçmiş günler yeni sürümle yeniden üretilmez. Günün hedefleri snapshot'ta tutulur ve yarışta iki taraf için aynı paydalar kullanılır.

Gün sınırı IANA saat dilimiyle hesaplanır. İstemciye `projectDay` sonucu verilir; sunucu saatinde bitmemiş etkinliğin sonucu, durum etkisi ve neden kodu gösterilmez. Her senkronizasyon en fazla yedi tarihi sırayla işler. Bugüne henüz ulaşılamadıysa `catchupRemaining=true` olur ve sonraki yenileme devam eder.

Haftalık gösterge, son yedi **kayıtlı tarihteki** kesinleşmiş ve iki puanı da bulunan günleri toplar. Devam eden veya tek tarafın puanı eksik günler dışarıda kalır. Ortak gün yoksa toplam `null` olur; eksik günler sıfır sayılmaz. Üst sınır ortak gün sayısı × 100, en fazla 700 puandır. Bu toplama ile haftalık tempo adaptasyonunun yedi tamamlanmış gün şartı farklıdır; ayrıntılar [motor referansında](../reference/NOVA_CORE.md) açıklanır.

Sayfa görünür ve çevrimiçiyken yaklaşık 30 saniyede bir yenilenir; odaklanma ve yeniden bağlantı da okumayı tetikler. Yenileme hatasında son alınan durum korunur ve **Tekrar dene** gösterilir. Çevrimdışı ayar komutu sunucuya kaydedilmiş sayılmaz.

## Kaldırılmış sohbet ve Bridge

Yerel modelle sohbet, yanıt kuyruğu, cihaz eşleştirme, hafıza önerileri ve proaktif mesaj ayarları 14 Ekim 2026'da ürün akışından kaldırıldı. `GET /api/nova/chat` ve `POST /api/nova/bridge`, HTTP **410** ile `NOVA_CHAT_REMOVED` döndürür. `/api/nova` üzerindeki eski mesaj, retry, hafıza, düello, eşleştirme, cihaz, geçmiş ve kaynak komutları da aynı kodla reddedilir.

Eski sohbet/cihaz verileri ve SQL işlevleri migration geçmişinde korunur. Güncel uygulama bunları çağırmaz veya tarayıcı durumuna eklemez. Bu durum SQL nesnelerinin kaldırıldığı ya da yetkilerinin yeni bir migration ile iptal edildiği anlamına gelmez. Eski kurulum ve model ölçümleri yalnız [tarihsel doğrulama kaydıdır](../archive/NOVA_VERIFICATION.md).

## Doğrulama

```powershell
pnpm test:nova
pnpm test:nova:e2e
```

İlk komut saf motoru, sunum kurallarını, kaldırılmış komutları ve Nova veritabanı sözleşmelerini sınar. İkinci komut izole Next/PGlite ortamında Bugün/Yarış/Lab akışını, kalıcılığı, erişimi, yenileme hatasından kurtulmayı, puan grafiklerini ve farklı ekran genişliklerini sınar. Gerçek hesap, Ollama veya model bağlantısı kullanılmaz. Depo geneli kontroller ve CI kapsamı [TESTING.md](../TESTING.md) içindedir. Bu belge geçmiş test sayılarını güncel başarı sonucu olarak sunmaz.

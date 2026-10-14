# Nova: simüle çalışma arkadaşı

Nova, YKSim içinde kalıcı gün programı ve adil puan karşılaştırması olan dijital çalışma arkadaşıdır. `/nova` veya ana menüdeki Nova bölümünden açılır; varsayılan bölüm **Nova Bugün**'dür.

Yerel modelle sohbet kaldırıldı. Sohbet sekmesi, mesaj gönderimi, yanıt kuyruğu, cihaz eşleştirme, hafıza önerileri ve proaktif mesaj ayarları artık ürünün parçası değildir. Nova'nın günlük yaşamı ve yarışı web uygulamasında çalışır; bilgisayarda yardımcı süreç veya model başlatmak gerekmez. Bu karar, yerel bağlantı ve yanıt üretimi sorunlarını Nova'nın günlük kullanımından çıkarır ve simülasyon özelliklerini geliştirmeyi kolaylaştırır.

## Ekranlar

- **Nova Bugün:** mevcut simüle etkinlik, gün akışı, tamamlanan çalışma süresi, enerji/odak/stres ve yarışa geçiş.
- **Yarış:** kullanıcının gerçek kayıtlarıyla Nova'nın simüle kayıtlarının 0–100 puan karşılaştırması, bileşenler ve kesinleşmiş ortak günlerin haftalık toplamı.
- **Nova Lab:** simülasyon tercihleri, motor sürümü, gün tohumu, yerel tarih ve ham simülasyon durumu. Teknik model bağlantısı veya cihaz yönetimi içermez.

Nova'nın çalışmaları kullanıcının gerçek çalışma kayıtlarına eklenmez. Eksik ölçümler iki taraf için aynı şekilde çıkarılır; kalan ağırlıklar normalize edilir. Soru doğruluğu kaydedilmemişse uydurulmaz. Ayrıntılar: [motor ve puan belgesi](NOVA_CORE.md).

## Mimari ve erişim

- `src/lib/nova/core.ts`: dışarıdan saat, seed ve ölçüm alan saf günlük simülasyon motoru.
- `src/lib/server/nova.ts`, `GET /api/nova`: yetkili hesap için gün senkronizasyonu, durum ve yarış verisi.
- `POST /api/nova`: yalnız simülasyon ayarları (`timezone`, `weekly_adaptation_limit`). Aynı origin ve hesap erişimi doğrulanır.
- `src/components/nova/`: Bugün, Yarış ve Lab görünümleri; yalnız simülasyon durumunu yeniler.
- Nova erişimi `NOVA_ENABLED=true` ve ayrı `nova_access_grants` izni gerektirir. Demo/PGlite ortamı gerçek hesaplardan ayrıdır.

`GET /api/nova/chat` ve `POST /api/nova/bridge`, HTTP **410** ve `NOVA_CHAT_REMOVED` kodunu döndürür. Eski mesaj, yeniden deneme, hafıza ve eşleştirme komutları da işlenmez. Eski sohbet/cihaz verileri arşiv olarak veritabanında kalır; yeni Nova ekranına veya model işleme bağlamına aktarılmaz. Önceki kurulum rehberleri [Bridge](NOVA_BRIDGE.md) ve [Windows paketi](NOVA_WINDOWS_PACKAGE.md) belgelerinde kullanım dışı olarak işaretlenmiştir.

## Kalıcılık ve yenileme

Gün snapshot'ı `nova_id + local_date` için bir kez kaydedilir; sayfa yenilemek ikinci gün veya yeniden puanlama üretmez. Gün sınırı IANA saat dilimiyle hesaplanır. Yalnız sunucu saatine kadar tamamlanan etkinlik sonuçları görünür; gelecekteki sonuçlar gizlidir. Her senkronizasyon en fazla yedi geçmiş günü sıralı olarak tamamlar. Motor sürümü geçmiş günleri yeniden üretmez.

Haftalık özet son yedi **kayıtlı tarihteki** kesinleşmiş ortak günleri toplar. Devam eden günler ve tek tarafın puanı eksik günler dışarıda kalır. Ortak gün yoksa toplam null olur; eksik günler sıfır sayılmaz. Üst sınır ortak gün sayısı × 100, en fazla 700 puandır. Haftalık güç değişimi en fazla ±%5'tir.

Sayfa görünürken durum 30 saniyede bir yenilenir. Yenileme başarısız olursa son alınan simülasyon görünür kalır ve **Tekrar dene** ile yeniden okunabilir. Çevrimdışı değişiklik sunucuya kaydedilmiş sayılmaz.

## Doğrulama

~~~powershell
pnpm test:nova
pnpm test:nova:e2e
pnpm lint
pnpm typecheck
pnpm build
~~~

Uçtan uca testler izole Next/PGlite ortamında Bugün/Yarış/Lab akışını, kalıcılığı, erişim denetimini, kaldırılmış endpoint'leri, yenileme hatasından kurtulmayı ve 320/768/1024/1440 piksel genişliklerini doğrular. Ollama veya bir model bağlantısı kullanılmaz. Önceki model ölçümleri [tarihsel doğrulama kaydında](NOVA_VERIFICATION.md) kalır; güncel Nova için model kalite iddiası oluşturmaz.

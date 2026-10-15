# Kayıt, önbellek ve gecikme

Bu rehber güncel kodun performans açısından önemli akışlarını gösterir. Önce [mimariyi](../ARCHITECTURE.md) oku. Önceki canlı/sentetik ölçümler [tarihsel incelemede](../archive/PERFORMANCE_HISTORY.md) tutulur; eski süreler ve test başarısızlıkları güncel sürüm ölçümü değildir.

## Kayıt akışı

[study-command-queue.ts](../../src/lib/study-command-queue.ts) kesinleşmiş durum ile bekleyen komutları ayırır. Desteklenen komutların iyimser görünümü yerelde uygulanır; kalıcı yazmalar sırayla gönderilir. Geçici kimlikler sunucunun kanonik kimlikleriyle değiştirilir. Aynı isteğin tekrarında aynı `request_id` kullanılır; çatışma veya başarısızlık ayrı ele alınır. Bu kuyruk kalıcı çevrimdışı senkronizasyon sağlamaz.

[service.ts](../../src/lib/server/service.ts) uygun öğrenci komutlarında `yks_student_command` RPC'siyle yetki denetimi ve kaydı aynı veritabanı turunda yapar. Diğer yolların tam durum yanıtı sözleşmesi ayrıdır. Minimal yanıtın başarılı olması arka plan `/api/state` okumasının da başarılı olduğu anlamına gelmez.

## İsteğe bağlı Redis önbelleği

[state-cache.ts](../../src/lib/server/state-cache.ts) iki `UPSTASH_REDIS_REST_*` değişkeniyle etkinleşir. Durum kaydının TTL'si 60 saniye, Redis istek zaman aşımı 250 ms'dir. Redis hatası normal veritabanı yoluna düşer; geçici olarak önbellek atlanır.

Önbellek tek başına yetki veya güncellik kaynağı değildir: `yks_state_cache_snapshot` RPC'si canlı yetkiyi ve veri revizyonunu doğrular. Hesap/proje/ortam ve gün sınırları birbirinden ayrılır. Redis hızlandırma aracıdır; Supabase kalıcı kaynaktır.

Çalışma değişiklik sinyali farklı bir Redis anahtarı kullanır; TTL ve polling aralıkları [REALTIME.md](../features/REALTIME.md) içinde açıklanır. Bu mekanizma açık bir SSE bağlantısı değildir.

## Ölçüm ve doğrulama

- [save-metrics.ts](../../src/lib/save-metrics.ts): görünür/kalıcı onay/sonraki okuma süreleri. Bu süreleri toplayıp tek bir kullanıcı bekleme süresi diye yorumlama.
- [state-cache.test.ts](../../tests/state-cache.test.ts), [DB cache testleri](../../supabase/tests/state-cache.test.ts): revizyon ve yetki korunumu.
- [study-command-queue.test.ts](../../tests/study-command-queue.test.ts), [command-response.test.ts](../../tests/command-response.test.ts): sıra, makbuz ve yanıt sözleşmeleri.
- [analysis-status-performance.test.ts](../../tests/analysis-status-performance.test.ts): sentetik servis gecikmesi; gerçek üretim hızının kanıtı değildir.
- [save-latency.spec.ts](../../tests/e2e/save-latency.spec.ts), [instant-command-queue.spec.ts](../../tests/e2e/instant-command-queue.spec.ts): geciktirilmiş istekler ve arayüz toparlanması.

Yeni ölçüme commit, ortam, veri hacmi, örnek sayısı ve sıcak/ilk istek ayrımını ekle. Tarayıcı, ağ, Auth, SQL ve sonradan yapılan görünüm okumasını ayır. Genel sorgu istatistiği tek bir kullanıcının uçtan uca gecikmesi değildir. Bölge yapılandırması [vercel.json](../../vercel.json) içindedir; gerçek deployment metadata ayrıca kontrol edilir.

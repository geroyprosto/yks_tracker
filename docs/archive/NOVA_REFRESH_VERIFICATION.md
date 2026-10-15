> **Tarihsel kayıt:** Bu belge önceki geliştirme dönemini korur; güncel kurulum, canlı durum veya test sonucu olarak kullanılmaz. [Güncel okuma sırası](../README.md) · [Arşiv açıklaması](README.md).

# Nova sohbet yenilemesi: doğrulama ve yayın sırası

> Tarihsel kayıt: Sohbet, model çıkarımı ve Bridge 14 Ekim 2026'da kaldırıldı. Bu belgedeki eski kurulum/yayın adımları güncel kullanım talimatı değildir. Güncel Nova [NOVA.md](../features/NOVA.md) içinde açıklanır.

13 Ekim 2026. Bu belge ilk hazırlık ve karşılaştırma sonuçlarını kaydeder; aşağıdaki ölçümler yerel geliştirme ortamında yapıldı. Sonraki onaylı yayın sırasında sohbet RPC migration'ı üretime uygulandı ve Windows PowerShell 5.1 için Bridge sürüm kontrolü düzeltildi. Yayın sırası ve yerel ölçüm sınırları aşağıdadır.

## Model ve donanım

Yerel Ollama listesinde yalnız `qwen3.5:latest` vardı; Bridge'in varsayılanı `qwen3:8b` ile eşleşmiyordu. Ölçümlerde mevcut model adı açıkça seçildi; otomatik model değiştirme, indirme veya bulut çıkarımı yapılmadı. Eski qwen3:8b ölçümleri bu karşılaştırmaya dahil değildir.

Ölçüm sonrası `ollama ps` anlık çıktısı **100% GPU**, **8192 bağlam**, **5,8 GB**, yaklaşık **13 dakika** bellek tutma süresi gösterdi. Bu, modelin GPU belleğine yerleşimini gösterir; GPU kullanım yüzdesi ölçümü değildir. `nvidia-smi` mevcut değildi. [Ollama FAQ](https://docs.ollama.com/faq), `PROCESSOR` sütununun yorumunu ve `keep_alive` davranışını açıklar.

## Aynı girdilerle sıcak karşılaştırma

`../evals/nova/conversation-cases.ts` (dönem kaynağı; güncel depoda yok), eski ve yeni agent ile gerçek `generateAgentReply` akışında çalıştırıldı. Eski kod dondurularak sıcak koşu tekrarlandı. Girdi özeti her iki tarafta aynıydı: `b7f555bc309f4bd036563d96fb069b9f4be2e2e1be4f5500f83589e8145af8d6`.

| Ölçüm | Önce | Sonra |
|---|---:|---:|
| İlk denemede kabul | 6/9 | 7/9 |
| Tek onarım sonrası kabul | 8/9 | 9/9 |
| Onarım yapılan vaka | 3 | 2 |
| Toplam süre p50 | 2000 ms | 1630 ms |
| Toplam süre p95 | 3686 ms | 3399 ms |
| Ortalama süre | 2445 ms | 1956 ms |
| Çıktı tokenı, onarım dahil | 986 | 760 |

Ortalama süre yaklaşık %20 azaldı. İlk token medyanı yeni adapterda **685 ms** idi; eski, akışsız adapterda bu ölçülemiyordu. İki sıcak koşunun ilk model yükleme süresi yaklaşık 7 ms idi. Ayrı soğuk koşuda ilk yanıt 7507 ms, model yüklemesi 5719,9 ms sürdü; sıcak tabloya katılmadı.

Yeni adapter `think:false`, 8192 bağlam, 768 çıktı üst sınırı ve 15 dakika sıcak tutma kullanır. Akış içeride ölçülür; kullanıcıya yalnız tamamlanmış ve doğrulanmış yanıt teslim edilir. Önceki üst sınır 900 ve sıcak tutma 5 dakikaydı; ölçümlerde çıktı sınırına ulaşılmadı. [Ollama Chat API](https://docs.ollama.com/api/chat), akış, JSON Schema, düşünme seçeneği ve model sürelerinin anlamlarını tanımlar.

## Gerçek yerel HTTP zinciri

İzole demo ortamında `../scripts/nova-bridge/benchmark-chat.ts` (dönem kaynağı; güncel depoda yok), geçici demo kimliğiyle gerçek kuyruk → Bridge → Ollama → doğrulama → teslim akışını çalıştırdı. İki kullanıcı mesajına **birer farklı yanıt** teslim edildi; iki iş tamamlandı.

| Aşama | İlk mesaj | İkinci mesaj |
|---|---:|---:|
| Kuyrukta bekleme | 10024 ms | 23 ms |
| Üretim, onarım dahil | 1502 ms | 5040 ms |
| Model denemesi | 1 | 2 |
| Onarım süresi | — | 2575 ms |
| Teslim isteği | 54 ms | 23 ms |

İlk mesaj özellikle boş kuyruk kontrolünün hemen ardından gönderildi; bu yüzden 10 saniyelik boşta kontrol aralığını bekledi. İkinci mesaj önceki teslimin hemen ardından gönderildi. Hız yalnız model üretiminden oluşmuyor.

Önceki yerel HTTP koşusu `MODEL_OUTPUT_REJECTED` ile başarısızdı. O koşuda ham üretim/reddetme ayrıntısı kaydedilmedi; kesin nedeni bilinmiyor ve “düzeltildi” iddiası yok. Sonraki başarılı koşuda ikinci yanıtın ilk üretimi `unsupported_event` nedeniyle reddedildi ve tek onarımla geçti.

## Sınırlar ve kanıt

Dokuz vaka ve iki HTTP mesajı küçük örneklemlerdir; hız, doğal dil veya kesintisiz başarı garantisi değildir. Birebir olay cümlesi koruması hâlâ katıdır: doğru olayları tek cümlede birleştirmek bile onarım gerektirebilir. Genel veya gereksiz tekrar içeren ifadeler tamamen bitmedi. Hatalı ikinci üretim için uydurma yedek cevap yoktur.

Son kaynakta tüm birim/veritabanı testleri **605/605**, Nova tarayıcı testleri **2/2**, depo geneli ESLint, typecheck ve production build geçti. Tarayıcı testleri 320×568, 390×844, 768×817 ve 1440×817 görünümlerinde taşmayı/yazma alanını; test adapter etiketini; kendiliğinden yanıt görünmesini ve özel erişimi kontrol eder. Regresyonlar geçmiş aktarımı, unutulan kaynaklar, tekrar, düello izni, bekleyen teklif, sayısal önerinin dar sınırı ve telemetriyi kapsar.

Yerel kanıt adları: `conversation-before-warm.json`, `conversation-after-final.json`, `http-benchmark-debug.json`; başarısız kayıtlar `conversation-after.json`, `conversation-after-relevance.json`, `http-benchmark.json` olarak korundu. Ham raporlar repoya eklenmez. `../evals/nova/conversation-run.ts` (dönem kaynağı; güncel depoda yok) aynı vakaları yeniden çalıştırabilir; kullanılmamış rapor yolu ve açık model adı alır.

## Yetkili yayında uygulanacak sıra

1. İlgili kontrolleri tamamlayıp hedef ortamı doğrulayın. Önce [sohbet durumu migration'ını](../../supabase/migrations/20261013200008_nova_chat_state.sql) uygulayın; RPC yetkilerini ve kullanıcı izolasyonunu doğrulayın. Üretimde bu sürüm uygulanmıştır; dosya adı uzaktaki migration sürümüyle eşleştirilmiştir.
2. Migration ile uyumlu web sürümünü yayınlayıp sohbet, kuyruk durumu ve tek yanıt davranışını kontrol edin.
3. Aynı kaynak sürümünden Bridge paketini güncelleyin; DPAPI cihaz kimliğini koruyun. Kurulu modelle **açıkça eşleşen** model adı seçin. `doctor` eşleşmeyi doğrulamadan çalıştırmayın; başka modele sessiz geçiş yapmayın.
4. Yerel Ollama ve bulutu kapatma ayarını koruyarak Bridge'i başlatın. Kısa bir mesaj, sayfa yenileme, tekrar oluşmaması ve aşama sürelerini doğrulayın. [Windows paket rehberi](../features/NOVA.md).

# Kayıt ve analiz gecikmesi

4 Ekim 2026 incelemesi. Aşağıdaki üretim ölçümleri anlık durum ve birikmiş sorgu istatistikleridir; canlı kullanıcı işleminin uçtan uca süresi değildir.

## Üretimde bulunan nedenler

- Supabase `ACTIVE_HEALTHY`, yazma açık. Uygulama veritabanı 27 MB; kümedeki veritabanları toplam 42 MB. Free plan veritabanı sınırı 500 MB. Kontrol anında 60 bağlantı sınırına karşı 25 bağlantı, engellenmiş sorgu yok. Son 24 saat PostgreSQL loglarında statement timeout, deadlock ve disk doluluğu hatası yok.
- Birikmiş `yks_command` istatistiği: 566 çağrı, ortalama 61 ms, en yüksek 990 ms. Başlıca `yks_state` sorgusu: 4.125 çağrı, ortalama 126 ms, en yüksek 6.406 ms. Bunlar ağ, Auth ve tarayıcı beklemelerini içermez.
- Önceki üretim sürümü `a19269e` Vercel `iad1` bölgesinde, Supabase Frankfurt `eu-central-1` bölgesinde çalışıyordu. Dinamik cevaplarda `fra1::iad1` ve deployment metadata `regions: ["iad1"]` görüldü. `vercel.json` artık aynı veri bölgesine yakın tek bölge `fra1` seçiyor.
- Minimal kayıt yanıtından sonra arayüz tam `/api/state` isteği bitene kadar ortak yazma kilidini tutuyordu. Onaylanan ve desteklenen iyimser işlemler artık bu okuma tamamlanmadan sonraki işleme izin verir. Geçici kayıt kimliği sunucunun döndürdüğü kimlikle değiştirilir; eski okuma yanıtları mutation epoch ve okuma sırası ile elenir. Başarılı kayıttan sonra okuma hatası kaydı geri almaz.
- Analiz durumu altı bağımsız veritabanı okumasını ardışık turlarda bekliyordu. Artık aynı doğrulanmış kullanıcıyla paralel başlatılır. Öğrenci/onay ve yönetici/sahip yetki kontrolleri korunur; ekranı açmak model çağrısı yapmaz.

## Yeniden üretilebilir ölçüm

- `pnpm exec tsx --test tests/analysis-status-performance.test.ts`: aynı 100 ms uzak çağrı gecikmesiyle önceki iş yükü yaklaşık 540–549 ms, yeni akış yaklaşık 111–112 ms. Bu sentetik servis ölçümüdür.
- `pnpm exec playwright test tests/e2e/save-latency.spec.ts`: aynı 2.500 ms gecikmeli `/api/state` iş yükünde kayıt onayından sonraki işlemin açılması 2.891 ms'den 19–21 ms'ye indi. Eski yanıtın yeni kaydı ezmemesi, eski hata yanıtının sonraki yazmayı etkilememesi, günlük kimliği ve başarılı kayıt sonrası okuma hatası da sınandı. Mevcut 16 istemci sözleşmesi testi ve yeni yedi tarayıcı testi geçti.
- Görev silme bağlı sayaçların sürümünü değiştirdiği için tam sunucu durumunu bekler. Yanıtı kaybolmuş bir isteğin yeniden denenmesi de aynı istek kimliğiyle tam durumu bekler. Görev sıralamadaki boşluklar ve mevcut gün işaretinin tekrar seçilmesi için sürüm eşleşmesi ayrıca sınandı.
- Canlı hesaptaki görev/günlük kaydı uçtan uca ölçülmedi. Bölge değişimi deployment metadata ve canlı cevap başlığı ile ayrıca doğrulanmalıdır.
- Tam birim test başlangıç koşusu 239/240 geçti. Önceden mevcut `mcp-analysis-tool.test.ts` içindeki `priority_summary.high` beklentisi hatalı; bu değişiklik kapsamına alınmadı.
- Son tam birim koşusu 248/249 geçti; tek hata aynı önceden mevcut test. Lint, tip denetimi ve üretim derlemesi başarılı.

Veritabanı boyutu için [Supabase belgeleri](https://supabase.com/docs/guides/platform/database-size), sunucu/veri bölgesi eşleştirmesi için [Vercel belgeleri](https://vercel.com/docs/functions/configuring-functions/region) kullanıldı. Genel indeks veya RLS değişikliği bu incelemenin kanıtlanan gecikmelerine gerekli değildi.

## Upstash Redis — 5 Ekim 2026

- İsteğe bağlı sunucu önbelleği `UPSTASH_REDIS_REST_URL` ve `UPSTASH_REDIS_REST_TOKEN` ile açılır. Redis, Supabase ve Vercel ile aynı Frankfurt bölgesindedir. Anahtarlar tarayıcıya gönderilmez; yerel demo önbelleği kullanmaz.
- `/api/state` ve analiz durumu, mevcut kimlik doğrulamasının kullanıcı kimliğini kullanır. Redis'teki kayıt en fazla 60 saniye tutulur. Kullanıcı, Supabase projesi ve çalışma ortamı anahtarda ayrılır.
- Önbellek okunduktan sonra tek `yks_state_cache_snapshot(p_known_version)` çağrısı canlı yetkiyi denetler, bugünün planını başlatır ve süresi dolan sayaçları kesinleştirir. Sürüm aynıysa yalnız güncel sunucu zamanı döner; değişmişse tam durum aynı veritabanı isteğinde hazırlanır. Veritabanının kabul etmediği bir önbellek kaydı döndürülemez.
- Veritabanı tetikleyicileri, çalışma/eğitim kayıtları ve hesap erişimi değişince kullanıcı sürümünü artırır. Ortak sınav biçimi değişikliği tüm sürümleri geçersiz kılar. Profilin yerel günü, İstanbul günü ve saat dilimi de sürüme dahildir. MCP, ders işlemleri, AI görevleri, silmeler ve bakım yazmaları aynı mekanizmayı kullanır.
- Doğrudan komut yanıtları mevcut tek `yks_state` çağrısını korur. Önbellek doldurma cevap sonrasında çalışır. Redis isteği 250 ms ile sınırlıdır ve yeniden denenmez; Redis hatasında 30 saniye önbellek atlanarak normal veritabanı akışına dönülür. Bağlantı bilgileri veya migration yoksa mevcut akış kullanılabilir.
- Supabase kalıcı kayıt kaynağıdır. Önbellek sıcak okumaların tam veri üretme maliyetini azaltır; gerçek hesaptaki toplam kayıt süresinin ölçümü ayrıca gerekir. Geç gelen eski bir Redis yazması, canlı veritabanı sürüm kontrolünü geçemez.

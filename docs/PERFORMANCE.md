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

## Canlı kayıt ölçümü — 5 Ekim 2026

- `ad7e4bd` üretim sürümünde giriş yapılmış Chrome oturumuyla aynı görevin tamamlanma işareti üç kez değiştirilip geri alındı. Başlangıç ve sonuç aynı: 2/9 görev tamamlandı. Altı kayıt başarılı. Ayrı bir form ölçümünde mevcut görev alanları değiştirilmeden kaydedildi.
- Ölçüm komut işlevinin girişinde başlar. `visible_ms`, React DOM güncellemesine kadar geçen süredir; fiziksel ekran boyaması veya açık pencerenin kapanması değildir. `confirmed_ms`, başarılı kalıcı kayıt yanıtının JSON olarak okunmasına kadar ağ ve sunucuyu kapsar. `refresh_ms`, onaydan sonra bağımsız başlayan tam görünüm okumasıdır. Bu süreler birbirine eklenerek arayüz beklemesi diye yorumlanmamalıdır.
- Görev işareti: DOM güncellemesi 7,8–10,1 ms. İlk kayıt onayı 1.129,9 ms; sonraki beş kayıt 490,3 / 309,6 / 331,9 / 313,7 / 349,4 ms, ortanca 331,9 ms. İlk örnek ayrı raporlanır; soğuk başlangıç kaynağı bu ölçümle doğrulanmadı. Form kaydı tek örnekte 480 ms; karşılaştırmalı dağılım olarak kullanılmaz.
- `Server-Timing` başlığında yetki kontrolü 105,5–239 ms, komut 64,5–217 ms. Formda sırasıyla 112,5 ve 258 ms. Minimal kayıt yolunda ayrı `classroom_identity` ağ turu bu nedenle ölçülen iyileştirme hedefidir.
- Minimal öğrenci kayıtları `yks_student_command` ile canlı öğrenci/onay kontrolünü ve mevcut `yks_command` işlemini tek veritabanı isteğinde çalıştırır. Yetki kontrolü kaldırılmaz; öğretmen/yönetici, onaysız hesap, OAuth istemcisi ve anonim erişim engelleri korunur. Bu yolda `auth_db=0` ayrı ağ turu olmadığı anlamına gelir; yetki süresi `command` içine dahildir. Tam durum isteyen mevcut çağrılar aynı sözleşmeyi kullanır.
- Son onay sonrası tam görünüm okuması 1,8–4,0 saniye sürdü. Yeni yazma başlarsa eski okuma uygulanmaz. Bu arka plan süresi kalıcı kayıt onayı veya sonraki işlemin açılması değildir; Redis'e veya SQL'e tek başına atfedilemez.
- Tarayıcıda `.app-shell[data-save-metrics]` son on kaydın yalnız işlem türü ve sayısal sürelerini geçici bellekte tutar. Kayıt içeriği, kullanıcı/istek/kayıt kimliği, e-posta, hata mesajı, disk yazımı veya ek ağ isteği içermez. Hata ve onay ayrı izlenir. Canlı karşılaştırmanın son sonuçları kullanıcıya verilen ölçüm raporunda bulunur.

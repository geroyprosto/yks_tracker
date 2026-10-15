# Nova simülasyon motoru ve puanlama

Bu belge güncel Nova'nın saf motorunu, gerçek veriden kalibrasyonunu ve yarış kurallarını açıklar. Ürün/API akışı için önce [Nova belgesini](../features/NOVA.md) okuyun. Kaynağın merkezi [`src/lib/nova/core.ts`](../../src/lib/nova/core.ts), tipler [`types.ts`](../../src/lib/nova/types.ts) dosyasıdır.

Nova bir simülasyondur. Durumlar, ağırlıklar ve simüle deneme sonuçları ürün parametreleridir; psikolojik ölçüm veya sınav başarısı tahmini değildir. Motor gerçek kullanıcı kayıtlarını değiştirmez ve gerçek liderlik tablosuna puan yazmaz.

## Saf motor ve gün kimliği

Motor React, Next, veritabanı veya modele çağrı yapmaz; `Math.random()` ve `Date.now()` kullanmaz. Saat çağırandan ISO timestamp olarak gelir. IANA saat dilimi `Intl.DateTimeFormat` ile çözülür; olay timestamp'leri UTC'dir. Yerel gün sınırları DST nedeniyle 23 veya 25 saat olan günler için de ayrı hesaplanır. Tekrar üretimde aynı saat dilimi veritabanı sürümü önerilir; kalıcı UTC olayları tarihsel kaynağı oluşturur.

| Fonksiyon | Sorumluluk |
| --- | --- |
| `localDateAt`, `dayBounds` | Verilen anın yerel tarihini ve günün UTC sınırlarını hesaplar. |
| `buildBaseline(state, beforeLocalDate, timezone)` | Belirtilen yerel tarihten önceki 14 günü ölçer. |
| `createDay(input)` | Girdiyi derin kopyalar; seed, tarih, saat dilimi ve sürümden deterministik günlük snapshot üretir. |
| `projectDay(day, nowIso)` | Saklanan günü verilen anda gösterir; bitmemiş etkinliklerin sonuçlarını gizler. |
| `userMetrics(state, localDate, timezone, nowIso)` | Gerçek kayıtlardan o günün ölçümlerini çıkarır. |
| `scoreDay(metrics)` | Eksik bileşenleri belirterek 0–100/null puan döndürür. |
| `boundedCalibrationStudyMinutes(...)` | İlk haftadaki simülasyon çalışma bütçesini sınırlı adımlarla günceller. |
| `adaptWeekly(...)` | Yedi tamamlanmış, karşılaştırılabilir güne göre tempo çarpanını sınırlar. |

Resmî gün kimliği veritabanında `nova_id + local_date` çiftidir. `day.identity` yalnız yerel tarihtir; seed ve sürüm kimliğe katılmaz. Mevcut snapshot üzerine yeniden `createDay` sonucu yazılmaz ve eski günler yeni motor sürümüyle üretilmez. Bu kalıcılığı çağıran sunucu ve SQL benzersizliği sağlar; saf motor veritabanına yazmaz.

Ham `day.events` gelecekteki sonuçları da içerir. Tarayıcıya `projectDay` sonucu verilmelidir. Bitmemiş etkinliklerin `result`, `stateDelta` ve `reasonCodes` alanları gizlenir; etkileri henüz duruma katılmaz. Olay kimlikleri `yerel tarih:sıra` biçimindedir ve tekrarlanan olaylar bir kez toplanır. Planlanan süre tamamlanmış süre sayılmaz.

## Gerçek ölçümden başlangıç

Çalışma süresi kapanmış sayaç aralıkları ve elle bildirilen sürelerden gelir. Hedef/countdown süresi gerçekleşmiş süre yerine kullanılmaz. Aralıklar yerel gece yarısında bölünür; aynı kimlikli veya çakışan aralıklar bir kez sayılır. Aralık içermeyen eski, bitmiş oturumun `accumulated_seconds` değeri bitiş gününe atanır; bilinmeyen saat dağılımı çıkarılmaz. Açık timer yalnız güncel günün görünümüne katılır. Günlük süre geçen gerçek zamanla sınırlıdır.

Kalibrasyon penceresinde ölçüm veya açık dinlenme/sıfır işareti olmayan gün bilinmiyor sayılır. Süre ortalaması yalnız gerçek süre kaydı veya açık gün işareti bulunan günlerden hesaplanır. Yalnız görev, soru veya konu kaydı olan güne sıfır dakika atanmaz. `observedDays` bütün ölçüm türlerini kapsar; eksikler `missingData` içinde açıklanır.

Hiç süre verisi yoksa `baseline.averageStudyMinutes=null` kalır; yalnız simülasyon için 45 dakikalık temkinli bütçe kullanılır. Kullanıcı hedef ayarı yoksa simülasyon hedefi 60 dakikadır. Ölçülmüş ortalama sıfırsa çalışma uydurulmaz. `userMetrics` günlük gerçekleşen süreyi hesaplarken kayıt yoksa sıfır döndürebilir; bu günlük görünüm, başlangıç ortalamasındaki eksik veri kuralıyla karıştırılmamalıdır.

Görev `progress` değerleri 0–1'dir ve kısmi tamamlanma ortalamaya katılır. Son güncellemesi kesim zamanından sonraki geçmiş kayıt, o zamanki değeri bilinmediğinden ölçüme alınmaz. Konu ilerlemesi yalnız `topic_history` içindeki pozitif mastery farklarıdır; güncel mastery geçmiş kazanım yerine geçmez. Deneme ortalaması kayıtlı netlerden gelir. Soru şemasında doğru/yanlış bulunmadığından soru doğruluğu `null` kalır; deneme doğruluğu soru çalışmasına aktarılmaz.

Ders dağılımı gerçek süre paylarını gösterir. Nova'daki küçük ders farklılıkları merkezlenmiş yaklaşık ±%5 katsayılardır; toplam günlük bütçeyi artırmaz. Bu dağılım bilimsel güçlü/zayıf alan ölçümü değildir.

## İlk hafta ve tempo adaptasyonu

Etkinleştirmeden sonraki ilk yedi takvim gününde yeni tamamlanan gerçek günler başlangıç verisini iyileştirir. `baseline.averageStudyMinutes` ölçüm olarak korunur; `inputSnapshot.calibrationStudyMinutes` ayrı bir simülasyon parametresidir. Sunucu bu bütçeyi her yeni gün için bir kez, yeni ortalamaya doğru en fazla `max(5 dakika, önceki bütçe × %5)` değiştirir. Eksik ortalamada bütçe korunur. Örneğin sıfır bütçe ve yeni 60 dakikalık ölçüm, sonraki gün için beş dakikalık bütçe üretir; bu beş dakika ölçülmüş başarı değildir.

Sunucu yedinci günden sonra son kalibrasyon bütçesini dondurur; sonraki değişim haftalık kuvvet çarpanından gelir. Gün içi seeded varyans, başlangıç kalibrasyon verisi azken yaklaşık ±%6 ile ±%10, veri yeterliyken ±%12'dir. Bu varyans haftalık güç değişimi değildir. Güncel kullanıcının çalışması aynı günün saklanmış Nova snapshot'ını değiştirmez.

`adaptWeekly`, kesimden önceki yedi farklı tarihin tamamlanmış ve iki taraf için puanlı olmasını ister. Eksik, devam eden veya tekrarlanan gün bu eşiğe sayılmaz. Ortalama kullanıcı/Nova farkına göre kuvvet çarpanı bir haftada en fazla ±%5 değişir; tercih daha düşük veya sıfır olabilir. Sunucu bunu etkinleştirme başlangıcına göre yedi günlük sınırda uygular ve yeni gün snapshot'ında saklar.

## Yarış formülü

| Bileşen | Temel ağırlık | 0–100 normalizasyonu |
| --- | ---: | --- |
| Görev | %30 | 100 × tamamlanma toplamı / görev sayısı. |
| Süre | %25 | 100 × gerçekleşen dakika / hedef dakika. |
| Soru | %20 | Doğruluk varsa hacim ve doğruluğun eşit ortalaması; yoksa yalnız hacim. |
| Konu | %15 | 100 × pozitif ilerleme / ilerleme hedefi. |
| İstikrar | %10 | 100 × aktif gün / gözlenen gün. |

Oranlar 0–100'e sıkıştırılır. Pay/payda eksikse veya hedef sıfırsa bileşen `null` olur. Kalan ağırlıklar kendi toplamına bölünür; yalnız görev ve süre varsa ağırlıklar 30/55 ile 25/55'tir. `weights` 0–1 kesirlerdir. Hiç bileşen yoksa toplam `null` olur; bu sıfır başarı anlamına gelmez.

Gerçek günlük hedef önce gün planından, sonra Pazartesi başlangıçlı `weekday_targets` dizisinden ve `daily_target_minutes` değerinden okunur. Nova'nın gün başı hedefleri başlangıç snapshot'ına yazılır. Sunucu yarış hesabında iki tarafın süre/soru/konu hedeflerini bu saklanan değerlerle eşitler; gün içinde hedef düzenlemek mevcut yarışın paydasını değiştirmez.

[`comparisonScores`](../../src/lib/nova/presentation.ts), ölçümlerden biri bir tarafta eksikse iki tarafta da o ölçümü çıkarır. Gün içi istikrar tek günün aktiflik göstergesidir. Kullanıcı veya Nova için kazanma garantisi yoktur.

[`weeklyRaceSummary`](../../src/lib/nova/race-summary.ts), sunucunun verdiği son yedi kayıtlı tarih arasından yalnız kesinleşmiş ve iki puanı da 0–100 aralığında bulunan günleri toplar. Ortak gün yoksa iki toplam da `null` olur. Devam eden ve eksik günler sıfıra çevrilmez; haftalık toplama katılan gün sayısı ayrıca döner. Bu gösterge, tempo adaptasyonunun yedi tamamlanmış gün şartından bağımsızdır.

## Gün akışı ve durum sınırları

Uyku, uyanma, kahvaltı, yürüyüş/ulaşım, günlük rutin, öğünler, çalışma, mola, serbest zaman ve değerlendirme birbirini izler ve çakışmaz. Motor okul takvimini bilmediği için okulda bulunulduğunu iddia etmez. Günlük çalışma planı en fazla 300 dakikadır. Seeded dikkat dağılması bazı çalışma bloklarını aksatır. Uyku sırasında çalışma olmaz.

Tüm durumlar 0–100 aralığındadır. Önceki güne göre toplam günlük sapma sınırları enerji ±25, stres ±20, odak ±20, özgüven ±12, sosyal enerji ±20 ve rekabet isteği ±15'tir. Uykunun başlangıç etkisi de bu bütçeye dahildir; biten her etkinlikten sonra sınır uygulanır. Neden metinleri sabit `REASON_LABELS` kaynağından gelir.

## Doğrulama ve tarihsel kapsam

```powershell
pnpm exec tsx --test tests/nova-core.test.ts tests/nova-presentation.test.ts
```

Testler deterministikliği, snapshot bağımsızlığını, IANA/DST sınırlarını, farklı seed'lerde durum/takvim sınırlarını, gelecek sonuçlarının gizlenmesini, tekrar puanlamamayı, süre kalibrasyonunu, eksik veriyi, hedefleri ve haftalık sınırları kapsar. Daha geniş Nova/veritabanı/tarayıcı kontrolleri [özellik belgesindedir](../features/NOVA.md).

`core.ts` içinde eski sohbet sürümünün `getProactiveOpportunity` ve `applyRelationshipEvent` saf yardımcıları ve testleri hâlâ bulunur; güncel uygulama akışı bunları çağırmaz. Mesaj, model veya cihaz davranışı aktif motor sözleşmesine dahil değildir. Tam eski kurallar [NOVA_CORE_HISTORY.md](../archive/NOVA_CORE_HISTORY.md) içinde korunur.

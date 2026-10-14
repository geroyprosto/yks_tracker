# Nova simülasyon motoru ve puanlama

Nova bir dijital çalışma arkadaşının **simülasyonudur**. Bu belgede geçen ağırlıklar, durumlar ve deneme netleri ürün parametreleridir; psikolojik ölçüm veya sınav başarısı tahmini değildir. Motor gerçek kullanıcı kayıtlarını değiştirmez; Nova puanı gerçek kullanıcı liderlik tablosuna yazılmaz.

## Saf sınır ve saklama

`src/lib/nova/core.ts` yalnızca verilen girdilerle çalışır. React, Next, veritabanı veya modele çağrı yapmaz; `Math.random()` ve `Date.now()` kullanmaz. Saat ISO timestamp olarak verilir. `Intl.DateTimeFormat` IANA takvimini çözer; olay timestamp'leri UTC'dir. Yerel gece yarısı, DST nedeniyle 23 veya 25 saat süren günlerde de ayrı hesaplanır. Tekrar üretimin farklı makinelerde aynı timezone veritabanı sürümünü kullanması önerilir; saklanan UTC olayları tarihsel gerçeğin kaynağıdır.

- `buildBaseline(state, beforeLocalDate, timezone)`: yalnızca bu yerel tarihten önceki 14 gün.
- `createDay(input)`: günlük başlangıç snapshot'ını derin kopyalar; seed+tarih+timezone+sürüm aynıysa sonuç aynıdır.
- `projectDay(day, nowIso)`: saklanan günü verilen anda görüntüler. Bitmemiş olayların sonuçları ve neden kodları gizlenir; durum etkileri uygulanmaz.
- `userMetrics(state, localDate, timezone, nowIso)`: gerçek kayıtlardan ölçümler. Gelecek gün için başarı üretmez.
- `scoreDay(metrics)`: eksik bileşenleri açıkça bildirerek 0–100 puan.
- `adaptWeekly(...)`: tamamlanmış geçmiş yedi günlük karşılaştırma.
- `boundedCalibrationStudyMinutes(previousBudget, observedAverage, maxDailyChange = .05)`: ilk haftanın yalnızca simülasyon çalışma bütçesini, bir yeni gün için `max(5 dakika, önceki bütçenin %5'i)` sınırında günceller.
- `getProactiveOpportunity(...)`, `applyRelationshipEvent(...)`: sınırlandırılmış mesaj fırsatları ve üslup parametreleri.

Resmî gün kimliği `nova_id + local_date` olmalıdır. `day.identity` sadece yerel tarihtir; sürüm/seed bu kimliğe katılmaz. Veritabanı benzersizliği ikinci bir sürümün aynı günü tekrar puanlamasını engeller. Gün mevcutsa yeniden `createDay` çağırarak üzerine yazılmaz. Geçmiş günler yeni sürümle yeniden üretilmez. Arayüz/model bağlamı `projectDay` kullanır; ham `day.events` gelecekteki simülasyon sonuçlarını da içerdiği için istemciye verilmemelidir.

## Gerçek veriden başlangıç

Çalışma süresi, kapanmış çalışma aralıklarından ve kullanıcının elle bildirdiği sürelerden gelir. Hedef/countdown süresi tamamlanmış süre yerine kullanılmaz. Aralıklar yerel gece yarısında bölünür; aynı kimlikli veya çakışan aralıklar bir kez sayılır. Aralık içermeyen eski, bitmiş oturumlarda kayıtlı `accumulated_seconds` bitiş gününe atanır; böyle bir eski kaydın saat aralıkları bilinmediğinden kesin gece yarısı dağılımı çıkarılamaz. Açık timer sadece güncel günün görüntüsünde hesaba katılır, geçmiş kalibrasyonu şişirmez. Günlük toplam geçen gerçek süreyle sınırlıdır.

Ölçüm veya açık dinlenme/sıfır işareti olmayan günler bilinmiyor sayılır; otomatik sıfır üretilmez. Süre ortalaması yalnızca gerçek süre kaydı veya açık dinlenme/sıfır işareti olan günler üzerindedir; yalnızca soru/görev/konu kaydı olan güne sıfır dakika atanmaz. `observedDays` tüm ölçüm türlerini kapsar; `activeDays` ve `missingData` açıklaması her zaman taşınır. Hiç süre verisi yoksa gerçek süre `null` kalır; yalnızca Nova simülasyonunda 45 dakika temkinli çalışma planı, ayar yoksa 60 dakika hedef kullanılır. Bilinen ortalama sıfırsa çalışma uydurulmaz. İlk yedi bilinen günde varyans kontrollüdür (±%6 ile yaklaşık ±%10); sonraki günlerde ±%12'dir. Güncel kullanıcı çalışması aynı günün Nova snapshot'ını değiştirmez.

İlk hafta yeni tamamlanan gerçek günler başlangıç verisini iyileştirirken `baseline.averageStudyMinutes` olduğu gibi ölçüm olarak saklanır. `inputSnapshot.calibrationStudyMinutes` ayrı bir simülasyon parametresidir: önceki bütçe, yeni gözlenen ortalamaya doğru günde en fazla `max(5 dakika, önceki bütçe × .05)` yaklaşır; eksik ortalamada korunur. Örneğin 0 dakikalık bütçe daha sonra ölçülmüş 60 dakika görünce 5 dakikaya çıkar; ölçüm hâlâ sıfır veya eksikse sıfırda kalır. Bu 5 dakikalık adım bir ürün kalibrasyon parametresidir (`CALIBRATION_MIN_STEP_MINUTES`), ölçülmüş kullanıcı başarısı değildir. Çağıran katman her yeni gün için bir defa uygular, yedinci günden sonra son bütçeyi dondurur ve sonraki değişiklikleri haftalık en fazla ±%5 kuvvet çarpanıyla yönetir. Gün içi seeded varyans çalışma planını etkiler; bir temel güç adaptasyonu değildir. Ölçülmüş süreyi bu simülasyon parametresiyle değiştirmek veya arayüzde gerçek ortalama gibi göstermek yanlıştır.

Hedef mevcut kullanıcı ayarındaki Pazartesi başlangıçlı `weekday_targets` dizisinden, ardından `daily_target_minutes` değerinden alınır; sabit 8 saat hedef yoktur. Kullanıcının günlük plan hedefi `userMetrics` tarafından okunur. Karşılaştırma katmanı iki taraf için aynı, gün başında saklanmış hedefleri kullanmalıdır. Görev `progress` değerleri 0–1'dir; kısmi tamamlanma ortalamaya katılır. Geçmiş bir görevin kayıtlı son güncellemesi kesim zamanından sonraysa, eski değeri bilinmediğinden kalibrasyona katılmaz. Güncel tablolardan kusursuz bir geçmiş revizyonu çıkarılamaz; ilk snapshot sonrası resmî gün değişmez.

Mevcut soru şemasında doğru/yanlış yoktur. Bu yüzden soru doğruluğu `null` kalır; deneme doğruluğu soru çalışmasının doğruluğuymuş gibi gösterilmez. Konu ilerlemesi yalnızca `topic_history` içindeki pozitif mastery farklarından gelir; güncel mastery geçmiş kazanım yerine kullanılmaz. Deneme ortalaması kayıtlı netlerden gelir. Ders dağılımı gerçek sürelerin payıdır; bilimsel güçlü/zayıf alan ölçümü değildir. Nova'daki küçük ders farklılıkları merkezlenmiş yaklaşık ±%5 katsayılardır; toplam günlük çalışma bütçesini artırmaz.

## Yarış formülü

| Bileşen | Ağırlık | 0–100 normalizasyonu |
|---|---:|---|
| Görev | %30 | 100 × tamamlanma toplamı / görev sayısı |
| Süre | %25 | 100 × gerçekleşen dakika / hedef dakika |
| Soru | %20 | Hedefe ulaşma ve doğruluk varsa eşit ortalama; doğruluk yoksa yalnızca hacim |
| Konu | %15 | 100 × pozitif ilerleme / ilerleme hedefi |
| İstikrar | %10 | 100 × aktif gün / gözlenen gün |

Oranlar 0–100'e sıkıştırılır. Pay/payda eksikse veya hedef sıfırsa bileşen `null` olur. Mevcut ağırlıklar toplamlarına bölünerek yeniden dağıtılır; örneğin yalnızca görev ve süre varsa ağırlıklar 30/55 ve 25/55 olur. Hiç bileşen yoksa toplam `null`dır, sıfır başarı iddiası yapılmaz. `weights` 0–1 kesirlerdir. Gün içi görünümde istikrar tek günün aktiflik göstergesidir; haftalık istikrar birleştiren katman tamamlanmış gün adetlerini vermelidir. Eşit karşılaştırma için bir tarafta bulunmayan bileşen diğer tarafta da kaldırılır.

Olay kimlikleri tekildir (`yerel tarih:sıra`), `projectDay` tekrar eden olayları bir kez toplar ve veritabanına puan ekleyen yan etkisi yoktur. Gelecekteki veya devam eden olaydan puan verilmez. Planlanan dakikalar tamamlanan dakikalar olarak gösterilmez. Kullanıcı veya Nova için kazanma garantisi yoktur.

Haftalık adaptasyon yalnızca kesimden önceki yedi **tamamlanmış, puanlı, farklı** gün mevcutsa uygulanır. Ortalama kullanıcı/Nova farkına göre kuvvet çarpanı bir haftada en fazla ±%5 değişir; ürün parametresi daha düşük seçilebilir. Çağıran katman adaptasyonu hafta başına bir kez kaydeder. Tamamlanmamış gün, güncel gün, tekrarlanan tarih veya eksik puan bu eşik için sayılmaz.

## Günlük yaşam ve durum sınırları

Uyku, uyanma, kahvaltı, yürüyüş/ulaşım, günlük rutin, öğünler, konu/soru/yanlış analizi/kısa deneme, molalar, serbest zaman ve değerlendirme birbirini izler; çakışmaz. İlk sürüm okul takvimi bilmediği için okulda bulunduğunu iddia etmez; genel günlük rutin kullanır. Günlük çalışma planı güvenli bir simülasyon sınırı olarak en fazla 300 dakikadır; yüksek geçmiş ortalamalarında bu sınır kullanıcıya yetişme garantisi vermez. Bazı bloklar seeded dikkat dağılmasıyla aksar. Uyku sırasında çalışma yoktur.

Tüm durumlar 0–100'dür. Önceki günün durumuna göre bir gün boyunca toplam sapma: enerji ±25, stres ±20, odak ±20, özgüven ±12, sosyal enerji ±20, rekabet isteği ±15. Uykunun başlangıç etkisi de bu bütçenin içindedir; her bitmiş olay sonrasında tekrar sınır uygulanır. Neden metinleri sabit `REASON_LABELS` kaynağından gelir. Model neden, çalışma sonucu veya ruh hâli sayısını belirleyemez.

## Eski sohbet sürümünün saf yardımcıları

Yerel modelle sohbet 14 Ekim 2026'da kaldırıldı. Aşağıdaki ilişki ve fırsat kuralları saf motor yardımcıları olarak kalır; güncel uygulama bunları çağırmaz, mesaj veya model işi oluşturmaz.

Yakınlık, sıcaklık ve rekabet üslup ayarlarıdır. Dostça konuşma ve kabul edilen düello sınırlı artış yaratır. Yokluk, cevapsız mesaj veya düelloyu reddetmek **ceza vermez**.

Varsayılan: günde en fazla iki fırsat, yerel 23.00–08.00 sessizlik, tetikleyici başına günde bir kez, cevaplanmamış mesaj varken yeni fırsat yok, son yedi günde en fazla üç düello teklifi. Sabah fırsatı saat 10.00'da, çalışmaya başlama fırsatı 15 dakikada, diğer kısa fırsatlar 30 dakikada eskir. Uygulama içi proaktif mesaj açma ve push izni ayrıdır. Motor sadece doğrulanmış fırsatı önerir; kuyruk katmanı aynı `key` için tek iş ve teslim anında süre denetimi uygulamalıdır. Kullanıcı kabulü olmadan düello başlamaz.

Düşük simüle deneme sonucu tetikleyicisi, tamamlanmış kısa denemede doğruluk %60'ın altındaysa ilk 30 dakika içinde destekleyici yoklama fırsatı üretir (`POOR_EXAM_ACCURACY_PERCENT`). Örneğin %58 tetikler, %80 tetiklemez. Eşik yalnızca simülasyon/üslup parametresidir; gerçek sınav yeterliliği veya kullanıcının başarı standardı değildir.

## Doğrulama

Odaklı komut: `node --import tsx --test tests/nova-core.test.ts`. Mevcut proje komutları: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Testler deterministikliği, snapshot bağımsızlığını, IANA/DST gün sınırlarını, 80 seed üzerinde durum/delta/takvim sınırlarını, gelecek sonuçlarının gizlenmesini, tekrar puanlamamayı, gerçek süre kalibrasyonunu, eksik veriyi, hedefleri, haftalık sınırı ve proaktif/ilişki kısıtlarını doğrular. Gerçek model veya ağ gerekmez.

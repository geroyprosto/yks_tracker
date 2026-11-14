# YKSim renk sistemi

## Temalar ve nötr yüzeyler

Seçilebilir 6 tema: Mercan / Gül, Okyanus, Mürdüm / Krem, Pastel, Beyaz ve Siyah. Varsayılan Okyanus. Beyaz ve Siyah sabit zeminli; diğerleri açık/koyu/sistem görünümünü destekler. Sabit zeminli temaya geçiş, diğer temalar için saklanan renk modu tercihini korur.

Ana sayfa zemini, yan menü, üst çubuk ve nötr kartlar aynı düşük doygunluklu renk ailesinin kademelerini kullanır. Okyanus gri-mavi; Gül, Mürdüm ve Pastel mor-gri yüzey ailesindedir. Beyaz ve Siyah nötr yüzeyler kullanır.

| Rol | Okyanus koyu | Okyanus açık |
| --- | --- | --- |
| Yan menü | #1b2028 | #eef0f3 |
| Ana zemin | #20252d | #f4f5f7 |
| Kart | #292f38 | #ffffff |
| Yükseltilmiş yüzey | #323a45 | #e9ecf0 |
| Kenarlık | #414a57 | #d8dce3 |

## Renk geçişli kartlar

Kullanıcının kart referanslarına göre Bugünün görevleri, Çalışma ritmin ve mevcut sayaç kartı renk geçişlidir. Her tema parlak üst kenardan aynı rengin daha koyu gövdesine geçer. Gül pembe; Okyanus turkuaz; Mürdüm mor; Pastel leylak; Beyaz mavi; Siyah altın geçiş kullanır.

Parlak üst alan dekoratiftir; başlık, işlem düğmeleri ve metinler koyu gövdede kalır. Geçişli kartların yerel metin, düğme, kenarlık ve grafik renkleri açık/koyu sayfa görünümünden bağımsız okunabilirlik sağlar. Grafik çubukları, koyu gövdeden ayrılan daha parlak tonlarda geçiş kullanır. Boş hesapta örnek çalışma veya dolu çubuk gösterilmez.

Günlük ilerleme ve ders dağılımı kartlarının zemini nötr kalır. Kalın halkalar, sayısal açıklamalar ve seçili menü tamamlayıcı vurgu renklerini kullanır. Sade görünüm geçişli kartları düz koyu tona indirir, dekoratif üst geçişi kapatır.

## Ajan Evi raporları

Ajan Evi tek bir pixel art sahnesidir. Oda isimleri resmin içindeki küçük ahşap tabelalarda görünür; ayrı oda menüsü, rapor sütunu veya evin altında ikinci bir panel yoktur. Odaya ya da maskota dokunmak, ev arkada görünürken ahşap çerçeveli kâğıt bir not defteri açar. Karakter portresi, kısa başlık ve bir seferde tek öneri gösterilir. Uzun değerlendirme metni yalnız önerisi olmayan raporlar için kullanılır. Notlar oklarla dolaşılır; özgün öneriler kesilmez veya yeniden yazılmaz. Veri tabloları, kaynak listeleri, teknik durum bilgileri ve rapor metaverileri ana deneyimde gösterilmez.

Günlük rehber doğrudan programa açılır. Gün seçimi ve çalışma başlığı/süresi öndedir; bir çalışma seçilince uygulama ayrıntısı açılır. Program, saatli `schedule` kayıtlarından veya tam olarak `Gün / Sıra / Çalışma / Süre / Nasıl yapacaksın?` sütunlarına sahip rapor tablosundan okunur. Tahmini saat, süre veya başarı puanı üretilmez. Rapor geçmişi, örnek akış, içe aktarma ve önceki analizler üç nokta menüsündedir; örnek içerik her zaman kişisel kayıttan ayrılır.

Ev ve altı ayrı karakterin görselleri `public/agent-house/` altında saklanır. Maskotlar odalarında dolaşır, çalışma köşelerinde durur ve komşu odaları ziyaret edip geri döner. Hareket yalnız dekoratif canlandırmadır. Ziyaretteki maskota tıklamak bulunduğu odanın değil, karakterin kendi notunu açar. Küçük durdur/başlat kontrolü hareketi bulunduğu yerde duraklatır. Ev görünmediğinde, sekme gizlendiğinde ve not defteri açıldığında zamanlayıcı durur. İşletim sistemi ve uygulamanın azaltılmış hareket tercihleri desteklenir.

Not defteri yerel `dialog` kullanır; klavye odağı içeride kalır, Escape ve kapatma düğmesi açan karaktere veya odaya döner. Dar ekranlarda not defteri ekrana sığar, uzun içerik içinde kayar. Oda, not ve gün seçimi yalnız görüntüyü değiştirir; raporlara veya çalışma görevlerine yazma yapmaz.
## Eski tercihler

Kaldırılan temalar güvenli biçimde eşlenir: Çelik Mavisi → Okyanus, Grafit / Orman → Siyah, Aurora → Beyaz, Bordo → Gül. Sunucu eski tema kimliklerini kayıt uyumluluğu için kabul etmeye devam eder. Sayfa açılırken otomatik API yazma isteği gönderilmez.

## İncelenen kaynaklar

24 Eylül 2026 tarihinde incelenen yüzey ve renk sistemi kaynakları:

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh): düşük doygunluklu nötr yüzeyler, geri planda kalan gezinme ve yumuşak ayırıcılar.
- [Linear: Custom Themes](https://linear.app/changelog/2020-12-04-themes): zemin, metin ve vurgu renginden ilişkili yüzey tonları üretme yaklaşımı.
- [Radix Colors: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale): zemin, bileşen, etkileşim, kenarlık ve metin için renk kademeleri.
- [Atlassian: Color](https://atlassian.design/foundations/color) ve [Elevation](https://atlassian.design/foundations/elevation): geniş alanlarda nötr renkler ve koyu modda yükseldikçe açılan yüzeyler.

Geçişli kart uygulaması kullanıcının paylaştığı görsel referanslardan uyarlanmıştır. Hex değerleri YKSim için seçildi.

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

Ajan Evi ilk açılışta altı odalı pixel art evi gösterir. Her odada ayrı bir sevimli asistan maskotu bulunur; odanın zemini ve isim plakası aynı erişilebilir düğmenin tıklama alanıdır. Odadan seçim yapmak evi daraltıp ilgili raporun başlığına odaklanır. Raporun “Eve dön” düğmesi evi açar ve seçili odanın düğmesine döner. Ev başlığından elle açılıp kapatılabilir. Rapor yanında hızlı oda menüsü bulunur; mobilde bu menü üç sütunlu düğmelere, raporlar tek sütuna geçer. Değerlendirme ve öneri metinleri 16 piksel taban boyutu ve rahat satır aralığıyla gösterilir; uzun değerlendirme tek düğmeyle genişletilir.

Ev ve maskot görselleri `public/agent-house/` altında saklanır. Sıcak ahşap, oda renkleri, belirgin pikseller ve küçük dekoratif hareketler sakin bir oyun evi hissi verir. Hareket, ajanın gerçekten çalıştığı anlamına gelmez; yalnız mevcut raporun hazır olup olmadığı belirtilir. İşletim sisteminin veya uygulamanın azaltılmış hareket tercihi maskot ve dekor animasyonlarını kapatır.

Özet, Program, Veriler ve Kaynaklar sekmeleri yalnız ilgili içerik varsa görünür. İlk öneri öne çıkar; diğer adımlar açılabilir. Tablo seçimi ve on satırlık sayfalama, uzun raporun bütün satırlarına erişimi korur. Haftalık program açık saatli `schedule` kayıtlarından veya tam olarak `Gün / Sıra / Çalışma / Süre / Nasıl yapacaksın?` sütunlarına sahip rapor tablosundan oluşturulur. Diğer tablolar genel veri görünümünde kalır; metinden tahmini süre veya başarı puanı üretilmez.

Oda, sekme ve gün seçimi yalnız görüntüyü değiştirir; çalışma görevlerini veya raporu güncellemez. Örnek ve kişisel raporlar ayrı kalır. Veri bekleyen bir odanın açıklaması ve önerileri okunabilir. Klavye odakları görünürdür, bölüm sekmeleri ok/Home/End tuşlarını destekler ve azaltılmış hareket tercihinde giriş animasyonları kapatılır.

## Eski tercihler

Kaldırılan temalar güvenli biçimde eşlenir: Çelik Mavisi → Okyanus, Grafit / Orman → Siyah, Aurora → Beyaz, Bordo → Gül. Sunucu eski tema kimliklerini kayıt uyumluluğu için kabul etmeye devam eder. Sayfa açılırken otomatik API yazma isteği gönderilmez.

## İncelenen kaynaklar

24 Eylül 2026 tarihinde incelenen yüzey ve renk sistemi kaynakları:

- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh): düşük doygunluklu nötr yüzeyler, geri planda kalan gezinme ve yumuşak ayırıcılar.
- [Linear: Custom Themes](https://linear.app/changelog/2020-12-04-themes): zemin, metin ve vurgu renginden ilişkili yüzey tonları üretme yaklaşımı.
- [Radix Colors: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale): zemin, bileşen, etkileşim, kenarlık ve metin için renk kademeleri.
- [Atlassian: Color](https://atlassian.design/foundations/color) ve [Elevation](https://atlassian.design/foundations/elevation): geniş alanlarda nötr renkler ve koyu modda yükseldikçe açılan yüzeyler.

Geçişli kart uygulaması kullanıcının paylaştığı görsel referanslardan uyarlanmıştır. Hex değerleri YKSim için seçildi.

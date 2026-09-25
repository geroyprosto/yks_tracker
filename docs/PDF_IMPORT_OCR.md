# PDF görsel okuma

24 Eylül 2026 durumu: özel PDF bucket ve sahip RLS/policy bulutta doğrulandı. Görsel okuma kodlandı ve birim testleri geçti; yerel PDF_VISION_MODEL ayarlı, OPENAI_API_KEY henüz yok. Gerçek OpenAI çağrısı ve canlı özel dosya yükleme/indirme kabul testi yapılmadı.

Taranmış YKS deneme sonucunda okunabilir bir metin katmanı yoksa yükleme ekranındaki **görsel okuma** seçeneğini işaretleyebilirsin. Seçim her yükleme için ayrıdır; varsayılan olarak kapalıdır. Seçildiğinde uygulama yalnız sonuç çıkarılamayan ilgili PDF sayfalarını sunucuda JPEG görüntüsüne çevirir ve OpenAI Responses API'ye gönderir. İsteklerde `store: false` kullanılır; bu, sağlayıcının tüm veri saklama politikalarının sıfırlandığı anlamına gelmez. İşlem OpenAI API kullanım maliyeti doğurabilir. PDF'nin tamamı OpenAI Files deposuna yüklenmez.

Sunucudaki git tarafından yok sayılan .env.local dosyasında PDF_VISION_MODEL zaten ayarlı; canlı kullanım için OPENAI_API_KEY'i yalnız sunucu ortamına ekle. Anahtarı tarayıcıya, sohbet çıktısına veya kaynak kod deposuna koyma. .env.example içindeki örnek model gpt-4o-mini'dir. Yapılandırma değişikliğinden sonra uygulamayı yeniden başlat. Model görsel girdi ve Responses yapılandırılmış JSON çıktısını desteklemelidir. Anahtar veya model yoksa PDF, elle inceleme adayı olarak kalır.

Yükleme en fazla 10 MiB ve 10 sayfadır. İlgili sayfalar en fazla 1400 × 2000 piksel JPEG olarak, tek tek ve 25 saniyelik istek sınırıyla işlenir. Sonuçlar kaynak sayfası ve belirsizlik etiketiyle önerilir. Yanlış veya boş alanları PDF'yi açarak düzelt; uygulama görsel okuma sonucunu otomatik deneme kaydına dönüştürmez. Kaydetme işlemi mevcut deneme doğrulamasından ve aynı kayıt kontrolünden geçer.

Aynı dosya SHA-256 özetiyle tek taslak olarak tutulur. Daha önce görsel okuma seçmeden yüklediğin aynı PDF'yi tekrar göndermek mevcut taslağı açar; yeniden OCR çalıştırmaz.
## Çok öğrencili TYT sonuç tabloları

Metin katmanı bulunan ÖZDEBİR benzeri sınıf genel sonuç raporları ücretsiz yerel ayrıştırıcıyla okunur. Her öğrencinin satırı ayrı adaydır; ad aramasıyla yalnız kendi sonucunu seçip PDF'deki doğru/yanlış/net, TYT puanı ve genel sıralamayı kontrol ederek kaydedersin. Belgedeki basım tarihi sınav tarihi olarak varsayılmaz; rapor sınav gününü belirtmiyorsa tarih zorunlu olarak senin tarafından seçilir. Seçmeli Felsefe kullanılmışsa standart TYT şablonuyla uyuşmama uyarısı gösterilir. Bu yol OpenAI API anahtarı veya görsel okuma gerektirmez.

## Tek öğrencilik TYT sonuç belgeleri

Ders özet tablosu ve metin katmanı bulunan TYT sonuç belgeleri de ücretsiz yerel ayrıştırıcıyla okunur. Desteklenen karne düzeninde dokuz dersin doğru/yanlış/neti, toplam net, TYT puanı ve genel sıralama önerilir. Kazanım analizi ve cevap anahtarındaki sayılar ders toplamlarına karıştırılmaz. Sınav tarihi belgede açık değilse kullanıcı tarafından seçilir. Seçmeli Felsefe kullanılmışsa sonuç elle doğrulanmalıdır. Yeni yayın ve belge düzenlerinde çıkarılan değerleri kaydetmeden önce PDF ile karşılaştır.

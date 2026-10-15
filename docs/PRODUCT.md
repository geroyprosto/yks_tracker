# Ürün ve güncel sınırlar

YKSim günlük çalışma planı ve gerçek çalışma kayıtlarını izler. YKS hazırlığı yanında lise ve üniversite profilleri, okul sonuçları ve isteğe bağlı Kırklareli Tıp çalışma alanı bulunur. Kullanıcıya ait kayıtlarla örnek/demo verileri ayrı tutulur.

## Hesaplar ve ana akış

Hesap rolü `student`, `teacher` veya `admin`; erişim durumu ayrıca saklanır. Eğitim profili rol değildir. Onaylı öğrenci `/` içindeki çalışma panelini kullanır. Onay bekleyen öğrenci `/personalize` üzerinden yalnız izinli kurulum taslağıyla çalışır. Diğer hesaplar `/classroom` alanına yönlendirilir.

Öğretmen alanı mevcut kaynakta geçici olarak duraklatılmıştır: öğrenci ilerlemesi, sınıf bildirimleri ve ilgili sınıf işlemleri paylaşılmaz. Yönetici için başvuru değerlendirme, askıya alma, hesap silme ve öğrenci çıkarma; öğrenci için sınıftan ayrılma istisnaları korunur. Ayrıntı: [mimari](ARCHITECTURE.md).

Öğrenci panelindeki Bugün, Görevlerim, Konularım, Sınav Sonuçları, Çalışma İstatistikleri, Arkadaşlar, Nova, Günlüğüm, Analiz ve Ayarlar çoğunlukla aynı `/` sayfasındaki görünümlerdir. Her menü öğesi ayrı bir URL değildir.

## Temel çalışma kuralları

- Görev, çalışma oturumu ve konu öğrenme düzeyi farklı kayıtlardır. Sayaç bitmesi görevi veya konuyu kendiliğinden tamamlamaz.
- Görev ilerlemesi varsayılan olarak planlanan dakika × zorluk ağırlığı kullanır; kolay/orta/zor katsayıları 1 / 1,25 / 1,5'tir. Alt adımlar varsa tamamlanma oranı adımlardan hesaplanır.
- Günlük birleşik ilerlemede varsayılan pay %70 görev ve %30 süredir. Mevcut bileşenlerin ağırlıkları normalize edilir; eksik veri sıfır kabul edilmez. Süre hedefini aşmak tamamlanmayan görevlerin payını kapatmaz.
- Süre saniye, zaman damgası UTC olarak tutulur; gün sınırı ilgili saat dilimiyle hesaplanır. Yalnız tarih olan sınav günleri timestamp gibi kaydırılmaz.
- Sonlandırılmış sayaç oturumları, aralıkları ve kesinleşmiş manuel süreler değişmezdir. Eski belgelerdeki bitmiş süreyi azaltma talimatı güncel sözleşme değildir.
- YKS neti, okul puanı, yüzde ve tıp notu farklı ölçümlerdir. Okul puanı YKS netine dönüştürülmez. Boş alan eksik veridir; kaydedilmiş sıfır gerçek sonuçtur.
- Tekrarlanan ağ isteği aynı işlem kimliğiyle gönderilir. Çakışan sürüm kullanıcıya bildirilir; eski veriyle sessizce üzerine yazılmaz.

Hesaplamalar [progress.ts](../src/lib/progress.ts), [timing.ts](../src/lib/timing.ts), ilgili sonuç modülleri ve SQL sözleşmelerinde uygulanır; AI bu sayıların doğruluk kaynağı değildir.

## Modüller ve sınırları

| Modül | Kapsam ve sınır |
| --- | --- |
| Eğitim profili | YKS hedefi, eğitim düzeyi, dönem ve ders kimliklerini ayırır; tam resmî müfredat ürettiği iddia edilmez. [Ayrıntı](features/STUDENT_PERSONALIZATION.md). |
| Kırklareli Tıp | Sürümlü katalog, Dönem I–IV, KEG ve ayrı not kuralları. [Ayrıntı](features/KIRKLARELI_MEDICINE.md). |
| Arkadaşlar | Onaylı hesaplar arasında grup, yarış ve izinli profil fotoğrafı erişimi; sınıf yetkilerinden ayrı kurallar içerir. |
| Google Takvim | Seçilen takvimlerden bugünün etkinliklerini salt okunur getirir; çalışma süresine eklemez. [Kurulum](integrations/GOOGLE_CALENDAR.md). |
| Günlük ve AI | Günlük paylaşım tercihi ve manuel istekle analiz; sunucu anahtarı, hesap kotası ve uygulama bütçesi gerekir. Otomatik ücretli rapor üretimi kapalıdır. [Ayrıntı](integrations/AI_MCP.md). |
| MCP | OAuth ve sahip hesabıyla sınırlandırılmış okuma/yazma araçları; genel veritabanı erişimi değildir. [Ayrıntı](integrations/AI_MCP.md). |
| Nova | Kullanıcının gerçek çalışmalarına eklenmeyen simülasyon ve ayrı yarış puanı. Yerel modelle sohbet ve Windows Bridge kaldırılmıştır. [Ayrıntı](features/NOVA.md). |

## Kalıcılık ve kullanılabilirlik

Supabase gerçek hesaplar için kalıcı kaynaktır; Redis isteğe bağlı önbellek/değişiklik sinyalidir. Yerel PGlite demo bulut hesaplarına bağlanmaz. Tarayıcıda görünen iyimser değişiklik ile sunucunun onayladığı kayıt aynı durum değildir; kalıcı çevrimdışı yazma kuyruğu bulunmaz.

Arka planda veya telefon kilitliyken alarmın tam zamanında çalışması garanti edilmez. Tema tercihi altı tema üzerinden yönetilir; renk kuralları [tasarım belgesindedir](reference/DESIGN.md).

İlk kapsam [orijinal talimatta](archive/USER_REQUIREMENTS.md) korunur. Eski aşama planları ve kabul kayıtları güncel özellik durumu olarak kullanılmaz. Güncel geliştirme veya canlı kabul açığını ilgili kod, test ve ortam üzerinde yeniden doğrula.

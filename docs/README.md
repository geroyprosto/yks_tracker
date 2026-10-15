# Geliştirici dokümantasyonu

Buradan başla. Belgeler 15 Ekim 2026 tarihinde depodaki kaynaklarla karşılaştırılarak düzenlendi. Bu tarih canlı servislerin yeniden kabul edildiği anlamına gelmez; güncel çalışma ortamı ayrıca doğrulanır.

## İlk okuma sırası

| Sıra | Belge | Okuma sonunda bilmen gereken |
| --- | --- | --- |
| 1 | [Ürün](PRODUCT.md) | Uygulama ne yapar, roller ve ürün kuralları nelerdir? |
| 2 | [Geliştirme](DEVELOPMENT.md) | Demoyu nasıl açarım, hangi komutu çalıştırırım? |
| 3 | [Mimari](ARCHITECTURE.md) | Ekran, komut, sunucu, RPC ve veri katmanı nasıl bağlanır? |
| 4 | [Testler](TESTING.md) | Değişikliğimi hangi katmanda doğrularım? |
| 5 | [İlgili modül](#konuya-göre-başvuru) | Değiştireceğim özelliğin özel sözleşmesi nedir? |

Gerçek hesap veya harici servis bağlayacaksan ikinci adımdan sonra [Kurulum](SETUP.md) rehberine geç. İlk keşif için yerel demo yeterlidir.

## Konuya göre başvuru

| Konu | Belge |
| --- | --- |
| Supabase, hesaplar, ortam değişkenleri ve migration | [SETUP.md](SETUP.md) |
| Eğitim profili, ders/dönem ve okul sonuçları | [Öğrenci çalışma alanı](features/STUDENT_PERSONALIZATION.md) |
| Kırklareli Tıp kataloğu ve not kuralları | [Kırklareli Tıp](features/KIRKLARELI_MEDICINE.md) |
| Nova günlük simülasyonu ve yarış | [Nova](features/NOVA.md), [motor ve puan sözleşmesi](reference/NOVA_CORE.md) |
| Cihazlar arası değişiklik algılama | [Yenileme ve polling](features/REALTIME.md) |
| Google Takvim OAuth bağlantısı | [Google Takvim](integrations/GOOGLE_CALENDAR.md) |
| Manuel AI raporları, bütçe, OAuth ve MCP | [AI ve MCP](integrations/AI_MCP.md) |
| Temalar, yüzeyler ve kart renkleri | [Tasarım](reference/DESIGN.md) |
| Kayıt kuyruğu, önbellek ve gecikme ölçümü | [Performans](reference/PERFORMANCE.md) |
| Önceki gereksinimler, kurulum ve test kanıtları | [Tarihsel arşiv](archive/README.md) |

Öğretmen ve yönetici erişim sınırları [mimarinin rol bölümünde](ARCHITECTURE.md) açıklanır. Sınıf özelliklerinin kodda bulunması kullanılabilir oldukları anlamına gelmez; öğretmen alanı şu anda duraklatılmıştır.

## Hangi bilgiye güvenmeliyim?

- **Çalışan sözleşme:** uygulama kodu, `package.json`, test yapılandırmaları, `.env.example` ve sıralı SQL migration dosyaları. Çelişki varsa belgeyi düzelt; yanlış belgeye uymak için kodu değiştirme.
- **Güncel açıklama:** bu dizindeki ana rehberler, `features/`, `integrations/` ve `reference/`. Özellikte kod bulunması canlı ortamda yapılandırıldığı veya kabul edildiği iddiasını taşımaz.
- **Tarihsel bağlam:** `archive/`, kökteki [PRD](../PRD.md), [ilk uygulama planı](../IMPLEMENTATION_PLAN.md) ve [aşama kontrol listesi](../FEATURE_CHECKLIST.md). Bunlar güncel sürüm durumu veya yapılacaklar kaynağı değildir.

## Belge bakım kuralı

Bir bilginin bir ana kaynağı olsun: komutlar geliştirme/test rehberinde, hesap ve ortam ayarları kurulumda, özellik kuralları ilgili modülde. Diğer belgeler aynı listeyi çoğaltmak yerine bağlantı versin.

Davranış değişince ilgili güncel rehberi aynı değişiklikte düzelt. Canlı doğrulama kaydına tarih, commit/deployment, ortam, çalıştırılan kontrol ve kalan sınırları ekle; eski test sayılarını güncel başarı diye taşımadan arşivde tut. Migration dosyalarını sonradan yeniden yazma; yeni değişiklik için yeni migration ekle.

`archive/` içindeki eski başlatma komutları ve servis ayarları uygulanacak talimat değildir. Yeni belge eklerken bu indekse bağlantı ekle; dosya taşırken hem Markdown bağlantılarını hem CI gibi kaynaklardaki yol referanslarını kontrol et.

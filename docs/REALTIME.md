# Çalışma alanının canlı güncellenmesi

Supabase çalışma kayıtlarının kalıcı kaynağıdır. Upstash Redis hem mevcut sürüm
kontrollü önbelleği hem de diğer açık oturumlara gönderilen değişiklik bildirimlerini
sağlar. Redis bildirimi bir kaydın yerine geçmez.

## Bağlantı

Sunucuda `UPSTASH_REDIS_REST_URL` ve `UPSTASH_REDIS_REST_TOKEN` gerekir. Mevcut
YKSimCache kullanılabilir; yeni veritabanı veya tarayıcıya Redis tokenı gerekmez.
`@upstash/realtime` sürümü paket ve kilit dosyasında sabitlenmiştir.

`GET /api/realtime?session=1` canlı hesap yetkisini kontrol eder ve bu kullanıcıya
ait kanal adını verir. SSE bağlantısı yalnız o kanalı kabul eder. Kanal kapsamı
Supabase projesini, çalışma ortamını ve kullanıcıyı içerir; aynı veritabanını
kullanan iki production adresi aynı kapsamı paylaşır. Demo canlı Redis kullanmaz.

## Bildirimler

Web çalışma/eğitim komutları ve MCP sahip komutları, başarılı veritabanı işleminin
ardından `study.dirty` bildirimi planlar. Bildirim içeriği yalnız `{}` değeridir;
çalışma kayıtları, kullanıcı bilgileri, komut girdileri ve Redis erişim tokenı taşınmaz.
Kimlik doğrulama ve yayınlama kayıt cevabından sonra çalışır. Redis başarısızlığı
başarılı Supabase kaydını geri almaz veya kullanıcıya başarısız kayıt diye göstermez.

Bağlantının ömrü sınırlıdır ve yeniden bağlanırken yetki tekrar denetlenir. Her
bağlantıda güncel durum okunarak bağlantı aralığındaki bildirim boşluğu kapatılır;
bildirim geçmişi, uygulama için kalıcı bir iş kuyruğu değildir. Doğrudan SQL veya
bu sunucu yardımcılarını kullanmayan yazmalar için mevcut periyodik kontrol sürer.

İstemci bildirimi veriyi doğrudan değiştirmez. Dashboard, bekleyen yazma işleri ve
eski okuma yanıtları için mevcut korumalardan geçen bir Supabase durum okumasını
planlar. Bu, diğer ekranların 30 saniyelik kontrolü beklemeden güncellemeye
başlamasını sağlar; durum okumasının ağ ve veritabanı süresini ortadan kaldırmaz.

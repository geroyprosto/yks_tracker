# Nova Bridge kullanım dışı

Nova'nın yerel modelle sohbet özelliği kaldırıldı. Nova Bridge, cihaz eşleştirme ve mesaj işleme artık desteklenmiyor; önceki kurulum ve başlatma adımları kullanılmamalıdır. Bridge uygulaması ve model değerlendirme araçları aktif kaynaklardan çıkarılmıştır.

`POST /api/nova/bridge`, HTTP **410** ve `NOVA_CHAT_REMOVED` koduyla yanıt verir. Daha önce eşleştirilmiş bir cihaz da yeni iş alamaz veya yanıt kaydedemez. `GET /api/nova/chat` ve eski tarayıcı sohbet komutları kullanım dışıdır. Eski mesajlar, cihaz kayıtları ve eşleştirme verileri arşiv olarak tutulur; güncel simülasyon bunları işlemez.

Nova'nın Bugün, Yarış ve Lab bölümleri web uygulamasında çalışır. Bilgisayarda model veya Nova Başlat yardımcısını çalıştırmak gerekmez. Güncel davranış ve doğrulama: [Nova belgesi](NOVA.md). Önceki Bridge/model sonuçları yalnız [tarihsel doğrulama kaydıdır](NOVA_VERIFICATION.md).

# Nova Windows paketi kullanım dışı

Yerel modelle sohbet kaldırıldığı için Nova Bridge Windows paketi artık derlenmez, kurulmaz veya dağıtılmaz. Eski **Nova Başlat**, **Nova Durdur** ve **Nova Model Kontrolü** yardımcıları güncel Nova'nın kullanım akışına ait değildir.

Güncel Nova web uygulamasındaki günlük simülasyon, puan karşılaştırması ve Lab tanılama ekranlarından oluşur; ayrı Windows yardımcı süreci gerekmez. Eski Bridge istekleri HTTP **410** ve `NOVA_CHAT_REMOVED` koduyla reddedilir. Önceki sohbet/cihaz kayıtları arşiv olarak korunur ve işlenmez.

Güncel kapsam: [Nova belgesi](NOVA.md). Önceki paket ve model doğrulama sonuçları: [tarihsel doğrulama kaydı](NOVA_VERIFICATION.md).

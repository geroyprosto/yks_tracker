# Nova Bridge — Windows inceleme paketi

Bu ZIP program dosyalarını içerir; açılması Bridge'i kurmaz veya başlatmaz. Node.js 24+, Windows ve yerelde çalışan Ollama gerekir. Kimlik, cihaz sırrı, kullanıcı mesajı, log ve kişisel ayar pakete eklenmez.

## Açık model seçimi

`bridge-config.example.json` örneğini `bridge-config.json` olarak kopyalayın. Kurulum bu dosyayı yalnızca yoksa oluşturur; mevcut seçimi korur. Model varsayılanı geriye uyumluluk için `qwen3:8b` olur. İndirilmiş başka model kendiliğinden seçilmez. `model` değerini yalnızca istediğiniz yerel model adına açıkça değiştirin. Buraya parola, token veya kullanıcı mesajı yazmayın.

- `ollamaUrl`: yalnızca `http://127.0.0.1:11434` veya `http://[::1]:11434`.
- `keepAlive`: varsayılan `15m`; modelin boşta yerel bellekte tutulma süresi. `0` hemen boşaltır; üst sınır `2h`.
- `pollMs`: boşta kuyruk kontrolü, varsayılan `10000`; izin verilen aralık 5000–60000 ms.
- `timeoutMs`: model isteği üst sınırı, varsayılan 90000; en fazla 120000 ms.
- `appUrl`: eşleştirme için HTTPS uygulama kökü. Eşleşmiş cihazın sunucu adresi DPAPI kimliğinden okunur; bu ayar mevcut eşleştirmeyi başka sunucuya taşımaz.

`Doctor-NovaBridge.ps1` seçili model ile kurulu yerel model adlarını ve erişim durumunu gösterir. Çıkarım veya kuyruk işi çalıştırmaz. Eski PID kaydı varsa bunu bildirir; yalnızca bu kayıttan çıkış nedeni çıkarılamaz.

## Kontrollü kurulum ve kullanım

İnceleme tamamlandıktan sonra kullanıcı açıkça kurmak isterse ZIP'i yeni bir klasöre çıkarıp oradan çalıştırır:

```powershell
& .\Install-NovaBridge.ps1 -CreateStartMenuShortcuts
```

Kurulum hedefi `%LOCALAPPDATA%\YKSim\NovaBridge` olur. Çalışan eski Bridge varsa kurulum reddedilir. Mevcut `device.dpapi`, `bridge-config.json` ve kullanıcı durdurma tercihi korunur. Kurulum Bridge'i başlatmaz. Otomatik Windows başlangıcı ayrıca `-EnableStartup` ile seçilir; varsayılan kapalıdır. Önceden etkinleştirilmiş Nova başlangıç kısayolu, kullanıcı durdurma tercihini koruyan yeni biçime güncellenir. Kurulu klasörden:

```powershell
& .\Doctor-NovaBridge.ps1
& .\Pair-NovaBridge.ps1   # yalnızca henüz eşleştirilmemiş cihaz
& .\Start-NovaBridge.ps1
& .\Stop-NovaBridge.ps1
```

Başlatıcı aynı Windows kullanıcı klasörü için işletim sistemi tarafından korunan tek örnek kilidi alır. Eski PID dosyası tek başına çalışan süreç sayılmaz. Durdurma PID, tam host yolu ve başlangıç zamanını doğrulayıp aynı örnek kimliğine bir iptal isteği iletir; başka süreci zorla öldürmez. Durdurulan Bridge otomatik yeniden başlatılmaz. Windows başlangıcı da bu tercihi korur; açık `Start-NovaBridge.ps1` devam ettirir. Otomatik çökme döngüsü veya model değiştirme yoktur.

`bridge-status.log` ve `bridge-error.log` başlatmada yenilenir. `manifest.json` kaynak commit'i, çalışma ağacının değişmiş olup olmadığını, kullanılan kaynakların özetini ve paket dosyalarının SHA-256 değerlerini içerir. Bunlar bütünlük/izlenebilirlik bilgisidir; imzalı yayın garantisi değildir. İnceleme paketi üretim kurulumu veya gerçek model kalite doğrulaması sayılmaz.

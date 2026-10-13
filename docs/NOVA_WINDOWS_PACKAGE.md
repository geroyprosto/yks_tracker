# Tekrarlanabilir Windows Bridge paketi

Paket kaynakları `scripts/nova-bridge/windows/` altında, derleme girişi `scripts/nova-bridge/build-package.mjs` dosyasındadır. Derleme mevcut kilitli `tsx` bağımlılığının esbuild sürümünü kullanır; yeni bağımlılık eklemez. Node.js 24+, yüklenmiş depo bağımlılıkları ve Windows PowerShell/.NET ZIP desteği gerekir.

Depo kökünden, henüz bulunmayan bir çıktı dosyası seçin:

```powershell
node scripts/nova-bridge/build-package.mjs --output artifacts/Nova-Bridge-Inceleme.zip
pnpm exec tsx --test tests/nova-windows-package.test.ts
```

Derleyici var olan ZIP'in üzerine yazmaz, kurulum yapmaz, Bridge başlatmaz, Ollama'ya veya üretim API'sine bağlanmaz. Yalnızca CLI'nin bağımlılık ağacını paketler ve açık listedeki 10 Windows kaynak dosyasını ekler. Windows PowerShell 5.1 için `.ps1` dosyalarına UTF-8 BOM eklenir. Arşiv toplam 12 dosyadır: bundle, 10 kaynak dosyası ve manifest. `.env`, DPAPI, log, işlem kaydı, eşleştirme verisi ve kişisel `bridge-config.json` listeye alınmaz.

`manifest.json`, kaynak commit'ini, değişmiş çalışma ağacı bilgisini, kaynak girdi özetini, esbuild sürümünü ve her paket dosyasının SHA-256 değerini kaydeder. `sourceDirty: true` olan dosya inceleme adayıdır; son değişikliklerden ve commit'ten sonra yeni bir dosya adına tekrar derlenmelidir. ZIP içeriğini otomatik olarak kurulu dosyalarla değiştirmeyin. Dosya özetleri yayın imzası değildir.

Örnek ayar `qwen3:8b`, yerel Ollama, `keepAlive: 15m`, `pollMs: 10000` içerir. Başka model otomatik seçilmez. Kurulum mevcut ayarı, DPAPI kimliğini ve açık durdurma tercihini korur. Ayrıntılı kullanım paketteki `README.md` dosyasındadır.

Başlatıcı aynı Windows kullanıcı klasörü için adlandırılmış pipe ile tek örnek sağlar. İşletim sistemi kilidi anormal çıkışta da bırakır; PID JSON dosyası tanı içindir. Durdurma tam host yolu/PID/başlangıç zamanını doğrular ve yalnızca aynı örnek UUID'sine iptal isteği gönderir. Otomatik yeniden başlatma yoktur. `Stop-NovaBridge.ps1` tercihi sonraki Windows başlangıcında da korunur; kullanıcı açıkça `Start-NovaBridge.ps1` ile devam eder.

Yerel testler gerçek Windows üzerinde geçici klasörde sahte worker kullanır: açık ayar doğrulaması, çift örnek engeli, eski PID, yanlış PID/örnek durdurma reddi, güvenli durdurma, anormal test süreci çıkışından sonra kilit bırakılması ve kullanıcı durdurma tercihinin korunması. Testler kurulu Bridge'i, cihaz kimliğini, gerçek modeli veya üretim kuyruğunu kullanmaz. Bu testler gerçek Ollama kalitesi ya da üretim kurulum doğrulaması sayılmaz.

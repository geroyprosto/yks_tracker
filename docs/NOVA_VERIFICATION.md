# Nova doğrulama kaydı

> Tarihsel kayıt: Yerel modelle sohbet ve Bridge 14 Ekim 2026'da kaldırıldı. Aşağıdaki sonuçlar eski sürümü belgeler; güncel özellik ve doğrulama akışı [NOVA.md](NOVA.md) içinde açıklanır.

Tarih: 13 Ekim 2026. Yerel testler, GitHub Actions, üretim altyapısı ve gerçek model yanıt kalitesi ayrı doğrulama katmanlarıdır. Sayılar aşağıda belirtilen koşulara aittir; sonraki kaynak değişiklikleri için yeniden çalıştırılmaları gerekir. İlk başlangıç `9638346`, yeniden tabanlama noktası `c934f4a`, ilk üretim birleşimi `7d324406`, gelecekteki dikkat dağılması bilgisini gizleyen takip birleşimi `ea1b15d`.

## Başlangıç durumu

Nova değişikliklerinden önceki ilk tam test koşusunda **499 testin 498'i geçti**. `tests/mcp-analysis-tool.test.ts:50` içindeki `priority_summary.high` okuması `undefined` olduğu için bir test başarısızdı. Ana dala gelen `ffccdcb` bu testi düzeltti; `c934f4a` mevcut gerçek zamanlı bağlantı davranışını güncelledi. Temiz `c934f4a` başlangıcında **509/509** test geçti. Nova'nın ilk teslim kaynaklarında **567/567**, gelecekteki olay türü gizleme düzeltmesinde **568/568**, gerçek model prompt/şema düzeltmesi sonrasında **576/576** birim/veritabanı testi geçti.

Yerel çalışma Node 24 kullandı. `package.json` pnpm **11.19.0** sürümünü bildiriyor; bu oturumdaki mevcut yerel pnpm **11.25** idi. CI depo sözleşmesini izleyerek 11.19.0 sürümünü kurar. Dolayısıyla yereldeki sonuç, GitHub runner üzerinde aynı araç zinciriyle tamamlanmış bir CI koşusu yerine geçmez.

## Kaydedilen Nova doğrulamaları

| Kapsam | Sonuç | Kanıtın sınırı |
| --- | --- | --- |
| Nova birim/veritabanı testleri | **67/67 geçti** | Son prompt/şema düzeltmesinin tam depo koşusuna dahil. İlk teslim 58/58, olay türü düzeltmesi 59/59 idi; Agent/Bridge grubu ayrıca 24/24 geçti. |
| Tam depo birim/veritabanı | **576/576 geçti** | Gerçek model prompt/şema düzeltmesi sonrasında. Önceki 567/567 ve 568/568 farklı kaynak aşamalarının kayıtlarıdır. |
| Gerçek Windows DPAPI denemesi | Şifreleme → dosya → yükleme → çözme başarılı | Sentetik cihaz verisi kullanıldı; canlı token kullanılmadı; diskte açık token bulunmadığı kontrol edildi; sentetik dosya kaldırıldı. |
| Türkçe eval yürütücüsü | **17/17 fake vaka kabul edildi** | Yürütücü ve koruyucu sözleşmesini sınar; gerçek model performansı değildir. |
| Nova tarayıcı testleri | **2/2 geçti** | Yerel demo/PGlite ve FakeModelAdapter; gerçek Supabase/Ollama veya üretim hesabı değil. |
| Tam ESLint, TypeScript, Next build | İlk teslimde **üçü de geçti**; son düzeltmede lint/typecheck tekrar geçti | Son düzeltmenin build/uzak CI sonucu ayrıca kaydedilmelidir; önceki build sonucu yeni commit için sonuç sayılmaz. |
| Mevcut genel tarayıcı paketi, ilk taban | **149 geçti, 18 başarısız** | `9638346` tabanlı Nova dalındaki aynı 18 hata, temiz başlangıç commit'inde aynı hata imzalarıyla tekrarlandı. |
| Mevcut genel tarayıcı paketi, güncel taban | **147 geçti, 26 başarısız** | `c934f4a` üzerine entegre Nova koşusu; aşağıdaki temiz başlangıç karşılaştırması 26 kimlik ve 26 hata imzasını doğrular. |

Agent testleri şema/JSON hataları, bilinmeyen fact, kaynaksız sayı ve olay, prompt injection, unutulmuş kaynak, hassas/izinsiz hafıza, manipülatif Türkçe ifadeler, uykusuzluk övgüsü, bariz İngilizce çıktı ve tek onarım sınırını kapsar. Bridge testleri model yokken claim yapılmaması, lease kaybında iptal, iptal edilmiş cihaz, güvenli URL/kimlik taşıma, model timeout'u ve yanıt boyutu sınırlarını kapsar.

Tarayıcı koşusu giriş, Nova ekranı, model çevrimdışıyken dayanıklı mesaj, cihaz eşleştirme, gerçek HTTP kullanan fake Bridge cevabı, tekrar completion için başarılı idempotent yanıt, yenilemeden sonra tek kalıcı mesaj, hafıza onayı/kaynak/sabitleme/unutma, mobil taşma kontrolü, cihaz iptali ve yetkisiz hesap/istek reddini kapsar.

Eski tarayıcı hatalarının ayrımı için Nova içermeyen iki temiz başlangıç ayrı incelendi. `9638346` üzerinde dokuz spec **37 geçti, 18 başarısız** verdi; 18 ad ve hata imzası aynıydı. Güncel `c934f4a` üzerinde aynı dokuz spec **36 geçti, 19 başarısız**, ek `state-refresh-recovery.spec.ts` dosyası **3 geçti, 7 başarısız** verdi. Bu iki güncel baseline koşusunun birleşimi **65 testte 39 geçti, 26 başarısız** oldu. Entegre Nova'nın tam **173 testlik** koşusundaki 26 başarısızlığın tamamı temiz güncel başlangıçta **aynı kimlik ve aynı Error/Expected/Received/Locator/Timeout imzasıyla** tekrarlandı; yalnız genel timeout verilen durumda timeout satırı kullanıldı.

Temiz başlangıçta tam süit yerine başarısızlık içeren 10 dosya çalıştırıldı. Bu, bildirilen 26 hatanın Nova olmadan da oluştuğunu doğrular; genel E2E süitinin geçtiği anlamına gelmez. İlgisiz testler gevşetilmedi. Teslim kanıtları `current-existing-e2e.log`, `baseline-current-e2e.log`, `baseline-current-state-refresh-e2e.log` ve 26 tam kimliği karşılaştıran `nova-integrated-e2e-comparison.json` dosyalarıdır.

## GitHub Actions

`.github/workflows/nova.yml`, ilgili kaynak, test, migration, bağımlılık veya yapılandırma değişen pull request'lerde ve elle tetiklendiğinde çalışır. Token yetkisi yalnızca `contents: read`; checkout kimlik bilgisini saklamaz. Action sürümleri resmî depoların etiketlerinden doğrulanan commit SHA'larına sabitlendi.

İş akışı Node 24, pnpm 11.19.0 ve `pnpm install --frozen-lockfile` kullanır. Sırasıyla şu depo komutlarını çalıştırır:

```text
pnpm lint
pnpm typecheck
pnpm test:nova
pnpm exec playwright install --with-deps chromium
pnpm test:nova:e2e
pnpm build
```

Gerçek Ollama/model kurulmaz ve çıkarım yapılmaz. E2E yapılandırması yerel demo veritabanını başlatır ve canlı servis anahtarlarını boş bırakır. Workflow üretim migration, deploy, merge veya paket yayımlama işlemi içermez. GitHub koşusunun sonucu ilgili commit'in Checks kaydından alınmalıdır; workflow dosyasının varlığı tek başına başarılı koşu veya branch protection kanıtı değildir.

Kurulum kararları [GitHub Node.js CI belgesi](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), [pnpm action belgesi](https://github.com/pnpm/action-setup) ve [Playwright CI belgesi](https://playwright.dev/docs/ci-intro) üzerinden doğrulandı. Chromium için resmî `install --with-deps` akışı kullanılır.

## Üretim ve Windows doğrulaması

Kullanıcının üretim ve yerel kurulum onayından sonra şu somut kontroller tamamlandı:

- Nova'nın eklemeli üretim migration'ları uygulandı; 11 Nova tablosunda RLS etkinliği doğrulandı. Erişim yalnız doğrulanmış hesaba ayrı grant ile verildi. Bu gözlem tüm olası JWT/yük senaryolarını kapsayan üretim güvenlik testi değildir.
- Vercel `geroy/yks-tracker` projesinde (`prj_7OiJ4nVuDsrD8hG36SHITbK8CkTn`) yalnız üretim `NOVA_ENABLED=true` ayarı eklendi; kapsamı ve tam değeri kontrol edildi. Ana dalın Git dağıtımı kanonik `https://yks-tracker-puce.vercel.app` alan adına bağlandı.
- İlk birleşim `7d32440692b7840acaef36caad603e16b57385e8`, `dpl_5ufbZAcxPxDZYctC2KY2N3rLricb` ile READY olarak doğrulandı. Sonraki `ea1b15dd55d14978f647bad4dae1b5ced301ff2b` birleşimi `dpl_GxaF83LoGNSQqum3b2QHEpm6L1dc` ile aynı kanonik alanda READY oldu. Kanıt, Vercel CLI'nin deployment/project/target/Git SHA/alias metadatasıdır.
- Ollama **0.40.3** kuruldu. İndirilen yükleyicinin SHA-256 özeti beklenenle eşleşti ve Authenticode imzası geçerli **Ollama Inc.** olarak doğrulandı. `qwen3:8b` indirildi; `OLLAMA_NO_CLOUD=1` ve loopback adresi kullanıldı.
- Gerçek çıkarım sırasında `ollama ps`, `qwen3:8b` için **100% GPU**, **8192** context ve **6.3 GB** yüklü model boyutu bildirdi. Bu boyut ayrıntılı VRAM ölçümü değildir; GPU yerleşimi Türkçe kalite veya sürekli hız garantisi değildir.
- Windows Bridge `%LOCALAPPDATA%\YKSim\NovaBridge` altına kuruldu. Kullanıcı kendi web oturumundan cihaz eşleştirmesini onayladı. Başlat menüsü kısayolları ve Ollama/Bridge başlangıç kısayolları doğrulandı; cihaz kimliği DPAPI ile korundu.
- Gerçek Bridge durdurma/başlatma kontrolünde eski işlem kapandı, yeni işlem başladı ve `device.dpapi` SHA-256 özeti değişmedi. Son görülme zamanı **13:45:46.627329Z → 13:46:47.50529Z** ilerledi; model hazır, cihaz iptal edilmemiş durumdaydı. Mesaj veya cihaz sırrı çıktılanmadı.

Teslim kanıtları arasında yükleyici `verification.json`, `ollama-ps.txt`, `nova-bridge-real-cycle.json` ve `nova-vercel-rollout-verification.md` bulunur. Bu kontroller kurulum ve bağlantıyı gösterir; başarılı bir kullanıcı sohbeti veya Türkçe kalite kabulüyle aynı şey değildir.

## Gerçek model kabulü ve açık sınırlar

İlk gerçek `qwen3:8b` koşusunda **17/17 JSON geçerli**, fakat **0/17 yanıt koruyuculardan geçti**. `memory_without_consent` dahil hafıza/kaynak/sayı kuralları yanıtları reddetti. Kanıt `ollama-install/real-eval.json` dosyasıdır. Prompt ve bağlama göre sınırlandırılmış çıktı şeması düzeltildi; doğrulayıcılar gevşetilmedi.

Son gerçek koşu (`ollama-install/real-eval-final.json`) **17/17 JSON**, ilk denemede **13/17 kabul**, üretimdeki tek onarım hakkıyla **15/17 kabul** verdi. Dört onarımın ikisi başarılıydı. Kalan iki adversarial prompt injection / sahte fact vakası güvenli hatayla reddedildi; kullanıcıya doğrulanmamış yanıt gönderilmedi. İlk denemedeki safety/style/source koruyucu oranları **1.0**; bu oranlar dar otomatik kontrollerdir, bütün anlam ve üslup sorunlarını ölçmez. Onarım dahil son p50/p95 süreleri **1014/2849 ms** idi; bu küçük yerel sentetik kümenin gecikmesidir, üretim SLA'sı değildir.

Ek sentetik sıradan konuşma denemeleri **3/3 kabul edildi** (`ollama-install/synthetic-probe-final.json`). Açık hatırlama isteği yalnız bir **aday** üretti; kalıcı hafıza için kullanıcı arayüzünde ayrı onay hâlâ zorunludur. Gecikmiş sabah mesajında saat bağlamını kullanma kısmen düzeldi; bu gözlem bütün gecikmiş mesajların anlamsal olarak doğru yanıtlanacağını kanıtlamaz. Yerel üretim ölçümlerindeki **83.34–84.54 token/sn** aralığı bu kısa sentetik örneklere aittir. Ollama'nın `cloud.disabled=true` durumu ayrıca doğrulandı.

Bu sonuç **17/17 başarılı sohbet** veya halüsinasyonsuzluk garantisi değildir. Hâlâ ayrı doğrulama gerektirenler: daha geniş Türkçe anlam/üslup incelemesi, uçtan uca gerçek kullanıcı sohbeti, uzun süreli VRAM/güç/gecikme ölçümü ve çok bağlantılı veritabanı yük yarışları.

GitHub runner sonucu için PR'ın güncel Checks sekmesine bakılmalıdır; yerel testler uzaktaki CI koşusunun yerine geçmez.

Regex ve JSON Schema koruyucuları tüm Türkçe anlam çelişkilerini kanıtlayamaz. Sayısal yarış sonuçları Core/veritabanı gerçeklerinden gösterilir; modelin serbest anlatımı daha dar kabul kurallarıyla sınırlandırılır. Gerçek model kurulumu ve değerlendirmesi için `docs/NOVA_BRIDGE.md` izlenmelidir.

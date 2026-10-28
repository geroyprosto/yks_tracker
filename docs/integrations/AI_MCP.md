# AI raporları ve özel MCP bağlantısı

AI ve MCP ayrı, isteğe bağlı entegrasyonlardır. Temel çalışma kaydı bunlar olmadan çalışır. Bu rehber depodaki güncel davranışı açıklar; eski yayın/hesap ayarlarının hâlâ geçerli olduğuna dair canlı durum iddiası içermez. Önce [Supabase kurulumunu](../SETUP.md) tamamla.

## Manuel AI raporu

AI yalnız kullanıcının isteğiyle çalışır. [analysis-provider.ts](../../src/lib/server/analysis-provider.ts) içindeki `schedulerReady()` her zaman `false` döner; [analysis.ts](../../src/lib/server/analysis.ts) zamanlamayı açmayı ve `generateScheduledAnalysis` çağrısını `AUTOMATIC_AI_DISABLED` ile reddeder. `AI_SCHEDULER_ENABLED=true` ayarı bu davranışı açmaz.

[vercel.json](../../vercel.json) içindeki `/api/cron/analysis` günlük işi, [route.ts](../../src/app/api/cron/analysis/route.ts) üzerinden yalnız `topic_review_retry_pending` çağırır. `CRON_SECRET` ile korunur; başarısız tekrar görevi yazmalarını ücretli model çağrısı yapmadan yeniden dener. Eski “14 günde otomatik AI raporu” kurulum notları güncel talimat değildir.

Sunucu ortamında aşağıdakiler gerekir:

| Ayar | İşlev |
| --- | --- |
| `AI_ENABLED=true` | Sunucu tarafındaki açık etkinleştirme anahtarı |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Sağlayıcı erişimi ve açıkça seçilmiş model; otomatik model fallback'i yok |
| `AI_INPUT_PRICE_PER_1M_USD`, `AI_OUTPUT_PRICE_PER_1M_USD` | Seçilen modelin maliyet tahminleri; pozitif sayı olmalı |
| `AI_MONTHLY_BUDGET_USD` | Uygulamanın aylık tahmini USD bütçesi |
| `SUPABASE_SECRET_KEY` | Kullanıcıya bağlı rezervasyon ve rapor RPC işlemleri |

`.env.example` örnek model/fiyat değerleri güncel fiyat doğrulaması yerine geçmez. Modeli ve fiyat değişkenlerini birlikte değerlendir. Uygulama tahmini maliyet kaydeder; bu kayıt sağlayıcının nihai faturası değildir.

Env tek başına AI'yi açmaz. [ai_student_reports migration'ındaki](../../supabase/migrations/20260927152814_ai_student_reports.sql) `private.ai_budget_policy` kaydı varsayılan kapalıdır. Yetkili DB yöneticisi, seçilen aylık uygulama bütçesini bu kayıtta ayrıca tanımlamalı ve sunucu bütçesiyle eşleştirmelidir. SQL policy, toplam uygulama harcamasını hesaplar; hesap silmek geçmiş uygulama maliyetini silmez.

Hesap başına İstanbul ayı için **4 kullanım** sınırı sunucu ve SQL'de sabittir; env ile artırılmaz. Dönem raporları ve günlük AI önerileri ortak kullanım/bütçe mekanizmasını paylaşır. Sağlayıcıya gönderilmeden önceki hata rezervasyonu bırakabilir; gönderimden sonraki belirsiz sonuç kota ve maliyeti korur. Yeni `request_id` ile körlemesine ücretli tekrar yapma. `AI_ENABLED=false` sunucu kapatma anahtarıdır; DB politikası da ayrıca kapatılabilir.

`ai_usage_status()` yalnız uygun tarayıcı oturumlarının kendi kullanım bilgisini okumasına izin verir. Her iki JWT claim biçimindeki OAuth `client_id` kontrol edilir; bir OAuth tokenına sahip olmak Data API üzerinden AI kullanımını okuma izni vermez.

Rapor API'si onaylı öğrenciye veya allowlist sahibi yöneticiye açıktır; `/api/journal/suggest` günlük önerisi yalnız ilk sahip hesabını kabul eder. İlk kabulü izole geliştirme ortamında gerçek bir dönem için yap; `/api/analysis` yalnız 7, 14 veya 30 günlük aralık kabul eder. Kaynak günler, eksik günlerin sıfır sayılmaması, günlük paylaşım tercihi, token/maliyet, aynı `request_id` davranışı ve raporun ekranda görünmesi birlikte kontrol edilir. Ücretli model çağrısını yalnız bu işlem için yetki varsa başlat.

Kaynaklar: [AI snapshot](../../src/lib/analysis-snapshot.ts), [koçluk şeması](../../src/lib/coaching-analysis.ts), [rapor şemaları](../../src/lib/ai-report.ts), [journal-ai.ts](../../src/lib/server/journal-ai.ts). Şema sürümleri farklı rapor nesnelerine aittir; tek bir sürüm numarasıyla hepsini eşitleme.

## Özel MCP kurulumu

Bu MCP bağlantısı allowlist'teki sahip içindir; her öğrenci hesabına açık genel bir API değildir. `MCP_ENABLED=false` varsayılanını, OAuth ve DB sınırları hazırlanırken koru.

1. Uygulamanın HTTPS adresini belirle. `APP_ORIGIN` ve Supabase Auth Site URL aynı origin'i, `MCP_PUBLIC_URL` tam `https://alan-adi/api/mcp` kaynağını göstermeli. `SUPABASE_SECRET_KEY` yalnız sunucuda kalır.
2. Güncel migration zincirindeki [audience hook](../../supabase/migrations/20260925165024_mcp_oauth_audience_hook.sql) ve [owner gateway](../../supabase/migrations/20260925182000_mcp_owner_gateway.sql) dahil şema/yetkileri uygula. Yalnız bu iki dosyayı seçip önceki bağımlılıkları atlama.
3. Supabase OAuth Server'ı etkinleştir; Authorization Path `/oauth/consent` olmalı. Uygulamadaki [izin sayfası](../../src/app/oauth/consent/page.tsx) ve onay/ret yolları bu akışa aittir. [Supabase OAuth kurulumu](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
4. Bağlantı istemcisini sağlayıcının o bağlantı için verdiği gerçek callback ile kaydet. Eski ChatGPT callback veya istemci kimliğini kopyalama. Dinamik istemci kaydı kullanıldıysa açık bırakma ihtiyacını ayrıca değerlendir.
5. Yetkili DB erişimiyle `private.mcp_oauth_audience_config` içinde gerçek `client_id` ile tam `MCP_PUBLIC_URL` eşlemesini kur. Ardından `private.mcp_oauth_access_token_hook` işlevini Supabase Custom Access Token hook olarak etkinleştir. Varsayılan `aud=authenticated` MCP için yeterli değildir; normal tarayıcı oturumlarının audience'ı korunmalıdır.
6. `MCP_ENABLED=true` ile entegrasyonu açıp aşağıdaki kabulü tamamla. Bayrağın açık olması OAuth kurulumu veya güvenlik kabulü anlamına gelmez.

[mcp-auth.ts](../../src/lib/server/mcp-auth.ts) imza/süre, issuer, tam kaynak audience, `authenticated` rolü, `client_id`, kullanıcı/e-posta ve sahip allowlist'ini doğrular. OAuth bearer'ı PostgREST'e geçirmez; sunucu anahtarı dar [gateway](../../src/lib/server/mcp-gateway.ts) RPC'lerini çağırır. [Supabase token güvenliği](https://supabase.com/docs/guides/auth/oauth-server/token-security).

## MCP araçları ve kabul sınırı

Araç sözleşmesinin kaynağı [mcp-tools.ts](../../src/lib/server/mcp-tools.ts), [konu aracı](../../src/lib/server/mcp-topic-tool.ts) ve [analiz kaynak aracı](../../src/lib/server/mcp-analysis-tool.ts) dosyalarıdır. Okumalar çalışma/görev/konu/deneme özetleri ve paylaşım tercihine uygun analiz kaynakları sunar. Analiz kaynak aracı varsayılan 14, en çok 31 günlük kayıt döndürür; ücretli AI çağrısı yapmaz.

Yazmalar görev, tarihli elle çalışma, yapılandırılmış deneme ve konu durumu ile sınırlıdır. Çalışma, deneme ve konu güncellemeleri `confirmed_by_user:true` ister; tüm yazmalarda tekrar için aynı `request_id` kullanılır. Tarihli çalışma sahte sayaç başlangıcı/sonu üretmez; deneme aracı PDF yolu kabul etmez.

Kabulde OAuth onay/ret, araç listeleme, izinli okuma, onaylı yazma, tekrar anahtarı, token yenileme/iptal ve yetkisiz kullanıcı reddini dene. Gerçek OAuth tokenıyla doğrudan Data API ve özel Storage erişiminin reddedildiğini ayrıca doğrula; keşif yanıtı veya `tools/list` başarısı bu sınırı kanıtlamaz. Güvenlik kabulü başarısızsa `MCP_ENABLED=false` ile bağlantıyı kapat.

## Okuma maliyeti ve geçici veritabanı hataları

`mcp_owner_state`, paneldeki `yks_dashboard_state` gibi her tarihin son planını getirir. Eski `yks_state` geçmiş plan sürümlerini isteyen denetim çağrıları için korunur; MCP okuması bu geçmişi tekrar tekrar birleştirmez. Görev, konu, çalışma kaydı ve deneme listeleri `mcp_owner_read` üzerinden yalnız istenen filtre ve sınırdaki alanları okur. Bu liste sorguları sayaç durumunu değiştirmez ve kullanıcı yazma kilidini almaz. Her iki MCP RPC'si de yalnız sunucu `service_role` çağrılarına açıktır ve sahip allowlist'ini denetler.

Gateway aynı istemci ve kullanıcı için eşzamanlı tam durum okumalarının yalnız sürmekte olan isteğini paylaşır; tamamlanan sonuç saklanmaz. Başarılı yazmadan sonraki okuma eski isteğe katılmaz. Liste araçları görev/konu/deneme notlarını veya günlük metnini döndürmez; analiz kaynağının mevcut günlük paylaşım tercihi korunur.

`DATABASE_TIMEOUT` sorgu süresi aşıldığını, `DATABASE_BUSY` kilit beklemesi veya deadlock'u, `DATABASE_CONNECTION_FAILED` geçici bağlantı sorununu, `DATABASE_SETUP_REQUIRED` eksik veritabanı kurulumunu ayırır. Sunucu kaydı yalnız hata kategorisi, sınırlı SQL/PostgREST kodu ve bilinen RPC adını içerir; SQL metni, mesaj ayrıntısı ve kişisel değerler loglanmaz. Yazma zaman aşımında otomatik yeni işlem başlatılmaz; yeniden denemede mevcut `request_id` korunur.

Eski model, ücretli çağrı, deployment ve OAuth deneme kayıtları [Aşama 3 geçmişinde](../archive/PHASE3_SETUP_HISTORY.md) saklanır. Yeniden kontrol edilmeden yeni ortamın veya güncel üretimin durumu olarak kullanılamaz.

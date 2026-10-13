# Nova veritabanı ve yetki sözleşmesi

Migration: `supabase/migrations/20261013123222_nova_local_companion.sql`.

Bu migration yalnızca dosya olarak hazırlanmıştır. Üretime uygulanması ve gerçek bir kullanıcıya Nova izni verilmesi ayrı onay gerektirir. Migration mevcut kullanıcılara otomatik izin vermez; var olan çalışma, sınav veya liderlik tablosu kayıtlarını değiştirmez.

## Yetki sınırı

Her açık `nova_*` tablosunda RLS vardır. Okuma için aynı anda `auth.uid() = owner_id`, tarayıcı oturumu, onaylı `classroom_accounts` kaydı ve iptal edilmemiş `nova_access_grants` kaydı gerekir. Kullanıcının değiştirebildiği metadata kullanılmaz. OAuth/MCP kullanıcı bearer'ı tarayıcı erişimi kazanmaz.

Tarayıcıya doğrudan INSERT/UPDATE/DELETE izni verilmez. Puan, günlük snapshot, olay sonucu ve iş durumu yalnızca dar RPC'lerle yazılır. `owner_id`/`nova_id` güncelleme tetikleyicileri sahip değiştirmeyi; `(id, owner_id)` bileşik foreign key'leri başka kullanıcının Nova'sına bağlanmayı engeller. Eşleştirme kaydına ilk tarayıcı onayında boş sahibin atanması tek kontrollü istisnadır; sonrasında sahip değişmez.

PUBLIC ve anon rollerinden bütün Nova fonksiyonlarının EXECUTE izinleri kaldırılır. Açık şemadaki RPC'ler SECURITY INVOKER sarmalayıcılardır; ayrıcalıklı kod sabit boş `search_path` ile `private` şemasında çalışır. Her kullanıcı RPC'si içeride kimliği ve izni tekrar kontrol eder. Sunucu RPC'lerine yalnızca `service_role` erişir; bu anahtar web sunucusunda kalır, Bridge'e gönderilmez. Sunucu service rolünün tüm sisteme geniş erişimi olduğu unutulmamalıdır: RPC kontrolleri sunucunun veya service anahtarının ele geçirilmesine karşı izolasyon sağlamaz.

Tarayıcı doğrudan günlük/olay snapshot'ını veya claim token'ını seçemez. `nova_state()` gelecekteki olayların `result`, `stateDelta`, `reasonCodes` alanlarını ve günlük giriş snapshot'ını kaldırır. Sunucuya açık `nova_engine_state` ve cihaz gateway'inin iç `context` işlemi tam snapshot'ı verir; HTTP cihaz endpoint'i bunu doğrulanmış, sınırlı AgentContext'e dönüştürmeden dışarı göndermez.

## İlk erişimi açma

Geliştirme/test veritabanında onaylı test hesabı oluşturun. Doğrulanmış gerçek UUID'yi yetkili yönetici oturumunda kullanarak yalnızca o hesaba `nova_access_grants` ekleyin. Üretimde bu işlem kullanıcı onayı alındıktan sonra yapılır. Aşağıdaki yer tutucu UUID çalıştırılabilir bir kullanıcı kimliği değildir:

```sql
insert into public.nova_access_grants(owner_id)
select id from public.classroom_accounts
where id = '<doğrulanmış-kullanıcı-uuid>'::uuid and status = 'approved'
on conflict(owner_id) do nothing;
```

İzin kaldırma: aynı yönetici `revoked_at = now()` yazar. Bu kontrol her okuma ve cihaz işleminde canlı veritabanından yapılır; eski oturum ya da geçerli cihaz token'ı izni geri kazanamaz. Hesabı askıya almak da aynı şekilde erişimi kapatır. Uygulamadaki ilk yetkili açılış başlangıç profilini oluşturur. Profil/day oluşturma RPC'si hiçbir erişim izni oluşturmaz.

## Tarayıcı RPC'leri

| RPC | Girdi | Sonuç |
| --- | --- | --- |
| `nova_access` | yok | boolean |
| `nova_state` | yok | profile, settings, relationship, son 14 days, son 200 events, son 100 messages/jobs/memories, devices, forgotten_source_ids |
| `nova_enqueue` | `p_request_id uuid, p_content text` | message_id, job_id, replayed |
| `nova_messages_page` | `p_before_seq bigint = null` | eski→yeni sıralı en fazla 50 mesaj |
| `nova_message_source` | `p_message_id uuid` | sahibi olunan mesaj veya null |
| `nova_job_retry` | `p_job_id uuid` | status |
| `nova_pair_approve` | `p_code text` | pairing_id, approved, name |
| `nova_device_revoke` | `p_device_id uuid` | revoked |
| `nova_settings_update` | `p_settings jsonb` | güncellenmiş ayarlar |
| `nova_memory_update` | `p_memory_id uuid, p_action text, p_content text = null` | hafıza kaydı |
| `nova_duel_decide` | `p_message_id uuid, p_accept boolean` | status, replayed |

Ayar anahtarları: `timezone`, `quiet_start`, `quiet_end`, `proactive_enabled`, `proactive_daily_limit`, `duel_weekly_limit`, `memory_enabled`, `notifications_enabled`, `weekly_adaptation_limit`. Proaktif mesaj varsayılan kapalıdır. Açıldığında günlük sınır 2 (en fazla 4), sessiz saat 23–08 ve haftalık proaktif düello sınırı 3 (en fazla 5) olur. `quiet_start == quiet_end` sessiz saatleri kaldırır. Bildirim tercihi ile uygulama içi proaktif mesaj tercihi ayrı sütunlardır; bu migration push servisi kurmaz.

Başlangıç saat dilimi uygulamanın mevcut kullanıcı ayarından `nova_engine_initialize` aracılığıyla alınır ve IANA adı doğrulanır. İlk resmî gün oluştuktan sonra farklı saat dilimine geçiş `NOVA_TIMEZONE_LOCKED` ile reddedilir; böylece gün kimliği/seed sınırları değişmez. Aynı dilimin tekrar kaydı serbesttir.

## Sunucu RPC'leri

| RPC | Girdi | Sonuç |
| --- | --- | --- |
| `nova_engine_initialize` | `p_owner_id uuid, p_profile jsonb` | ilk oluşturulan veya mevcut profil |
| `nova_engine_state` | `p_owner_id uuid` | güvenilir sunucu için tam snapshot'lı durum |
| `nova_engine_day` | `p_owner_id uuid, p_day jsonb` | ilk oluşturulan veya mevcut günlük kayıt |
| `nova_engine_race` | `p_owner_id uuid, p_local_date date, p_user_score numeric, p_nova_score numeric` | previousLeader, race |
| `nova_pair_begin` | `p_challenge_hash text, p_name text` | pairing_id, code, expires_at |
| `nova_pair_exchange` | `p_pairing_id uuid, p_challenge_hash text, p_secret_hash text` | device_id, owner_id |
| `nova_device_call` | `p_device_id uuid, p_secret_hash text, p_operation text, p_payload jsonb = '{}'` | işleme göre sonuç |
| `nova_proactive_enqueue` | `p_owner_id uuid, p_key text, p_trigger text, p_expires_at timestamptz, p_context jsonb = '{}'` | job_id/replayed veya skipped |

`p_profile`: `baseline`, `personality`, `engine_version`. `p_day` saf motorun `NovaDay` nesnesidir; `computedState`, `userScore`, `novaScore`, `finalized` ekleri desteklenir. `day_snapshot` ilk üretilen saf motor nesnesini saklar. `(nova_id, local_date)` benzersizliği engine sürümünden bağımsızdır. Aynı gün farklı snapshot gönderilirse mevcut kayıt döner; yeni sonuç üretilmez. Finalizasyon yalnızca kayıtlı snapshot birebir aynıysa ve kayıtlı `endsAt` sunucu saatine göre geçtiyse yapılır. Finalize edilmiş kayıt güncellenmez. Sürümler arası geçmiş günleri yeniden hesaplamayın; catch-up sunucuda sınırlı sayıda ve tarih sırasıyla yapılır.

`nova_engine_race` güvenilir sunucunun son yarış gözlemini profilin ayrı `race_snapshot` alanına yazar; resmî günü değiştirmez. Var olan yerel tarih ve 0–100/null puanlar gerekir. Gözlem `{localDate,user,nova,observedAt,leader}` içerir. `previousLeader` yalnızca aynı yerel günün önceki gözleminden döner; model bu alanı belirleyemez.

Proaktif tetikleyiciler: `morning_checkin`, `study_start`, `user_ahead`, `nova_ahead`, `poor_exam`, `focus_duel`, `day_end`. Aynı anahtar ikinci iş oluşturmaz. Opt-in, sessiz saat, günlük kota, yanıtsız eski teklif ve haftalık düello kotası profil kilidi altında kontrol edilir. Süre sonu en fazla 6 saat ileride olabilir. Proaktif iş eskirse claim/complete kabul edilmez; sıradaki claim işlemi onu CANCELLED yapar. Kullanıcı mesajlarının süre sonu yoktur.

Sessiz saat ve etkinlik tercihi yalnızca kuyruk oluştururken değil claim/bağlam/lease yenileme/tamamlama sırasında da kontrol edilir. Sessiz saat başlamadan alınan iş, sonradan sessiz saate sarkarak gönderilemez. Sonraki claim artık uygun olmayan proaktif işi CANCELLED yapar; kullanıcı işi korunur.

## Eşleştirme ve cihaz

Bridge kriptografik rastgele challenge üretir. Tarayıcı onayından sonraki exchange sırasında gateway 32 baytlık cihaz sırrı üretir ve Bridge'e bir kez döndürür. SHA-256 yalnızca 32 bayt veya daha güçlü rastgele sırlar üzerinde kullanılır; kullanıcı parolası hash'i yerine geçmez. Gateway ham değerleri loglamadan hash'ler. Veritabanı yalnızca hash saklar. Bridge aldığı ham cihaz sırrını Windows credential store/DPAPI gibi işletim sistemi korumasında tutar.

`pair_begin` 10 dakikalık, 12 hex karakterli kod üretir. Giriş yapmış ve Nova izni olan tarayıcı kodu onaylar. Challenge kanıtı olmadan exchange yapılamaz; onay beklerken `NOVA_PAIR_PENDING`, süresi geçen/yanlış/ikinci exchange için `NOVA_PAIRING_INVALID` döner. Exchange cihaz kimliğiyle sır hash'ini bağlar. En fazla 5 etkin cihaz vardır. Eşleştirme açılışları veritabanında 10 dakikada toplam 100 ile sınırlıdır. Global kota tek başına kötü niyetli kota tüketimini çözmez; herkese açık yayında istemci/IP seviyesinde ek kötüye kullanım kontrolü değerlendirilmelidir.

Her heartbeat, claim, renew, context, fail ve complete cihaz + hash + iptal + hesap onayı + Nova iznini kontrol eder. Device ID tek başına yetki değildir. İptal işlemi cihaz satırı kilidiyle sıralanır; iptal commit edildikten sonra eski bearer ile hiçbir cihaz işlemi kabul edilmez. Genel tarayıcı oturumu cihaz RPC'sini çağıramaz. Cihaz iptali etkin işleri yeni token ile yeniden alınabilecek duruma getirir.

## Kuyruk ve bağlam

- Mesaj ve işi tek transaction içinde oluşur. Aynı request UUID + aynı içerik aynı kaydı döndürür; değişmiş içerik `NOVA_IDEMPOTENCY_CONFLICT` verir. Aynı konuşmada en fazla 100 tamamlanmamış iş bulunur.
- Claim, konuşma profilinde ve kuyruk başındaki işte `FOR UPDATE SKIP LOCKED` kullanır. Önceki cevap tamamlanmadan sonraki mesaj claim edilmez. FAILED bir kullanıcı işi açık retry yapılana kadar kuyruğu durdurur.
- Claim süresi 180 saniyedir. Worker 45 saniye gibi daha kısa aralıkla yenilemelidir. Claim token her yeniden sahiplenmede değişir; eski/bitmiş lease sonucu yazamaz.
- `heartbeat` payload: version, model, model_available. Model çalışmıyorsa Bridge claim etmez.
- `claim` sonucu `{job: row | null}`. `renew` girdi `{job_id,claim_token}`, çıktı `{lease_expires_at}`.
- `context` aynı claim ile mevcut veriyi döndürür: profile, settings, days, events, messages, memories, relationship, job, source_message, bound_context, context_version, generated_at, forgotten_source_ids. Sonraki kullanıcı mesajları bağlama karışmaz; önceki yanıtlar dahil edilir. Son 30 mesaj ve 40 aktif hafıza üst sınırdır; Agent katmanı daha da küçültür.
- Yalnızca gateway'in iç `bind_context` işlemi `{job_id,claim_token,context,context_version}` alır. Aynı claim içinde farklı bağlam reddedilir. Bu işlem doğrudan HTTP cihaz operasyonu olarak sunulmamalıdır. Claim yenilendiğinde bağlam değişmez; yeniden claim edildiğinde temizlenir.
- `complete`: `{job_id,claim_token,context_version,result,metrics?}`. Donmuş bağlam zorunludur; fact ID'ler bağlı facts dizisinin alt kümesi olmalıdır. Mesaj, iş sonucu, bekleyen hafıza adayları atomik yazılır. Kaynak mesaja tek cevap ve job'a tek mesaj benzersiz kısıtlarla korunur. Tekrar hesaplama mümkün olsa da tek kalıcı yanıt hedeflenir.
- Tamamlanmış işte aynı cihaz/token `context` ve aynı içerikle `complete` tekrarını yapabilir; kayıp HTTP cevabı ikinci mesaj üretmez. İptal edilmiş cihaz bu tekrar hakkını kullanamaz.
- `fail`: `{job_id,claim_token,error,retryable}`. Geçici hata, ilk iki başarısız denemede 30 ve 60 saniyelik kalıcı bekleme ile QUEUED olur; üçüncüde FAILED. Kalıcı hata hemen FAILED olur. `next_attempt_at` gelmeden sonraki iş atlanmaz. Elle retry yalnızca çevrim sayacını sıfırlar; `attempt_count` toplam deneme sayısı korunur.

## Hafıza ve düello

Model çıktısı tek başına kalıcı aktif hafıza değildir. Sıradan çalışma bilgileri için kullanıcının kaynak mesajda açık hatırlama isteği, birebir kaynak alıntısı ve aynı kaynak kimliği aranır. Hassas aday ve sırlar reddedilir; adaylar `candidate` durumunda kullanıcı onayını bekler. Model confidence değeri kanıt değildir.

Eylemler `approve`, `edit`, `pin`, `unpin`, `forget`, `reject` olur. Unut/reddet tüm aynı kaynaktan türeyen hafızaları boş tombstone'a dönüştürür ve kalıcı kaynak engeli ekler. Eski kaynak ve ilişkili yanıt sonraki model bağlamından çıkarılır. Tüm sahibin kaydedilmiş bağlamları temizlenir; çalışan claim'ler iptal edilip ilgisiz işler yeniden kuyruğa alınır. Böylece unutma sırasında üretimde olan eski model sonucu geri yazılamaz. Asıl sohbet mesajı kullanıcı geçmişinde durur; unutma sohbet silme değildir. Kullanıcının bilgiyi yeni mesajda tekrar açıkça sunması farklı kaynaktır.

Unutulan bilgi daha sonraki eski yanıtlar içinde yeniden anlatılmış olabilir. Bunu otomatik hafızaya geri taşımamak için unut/reddet sonrasında modelin sohbet geçmişi konservatif olarak o andan başlatılır. Görünür sohbet silinmez; ilgisiz onaylı hafızalar kalır. Hâlen sırada bekleyen kullanıcı mesajı kendi açık isteği olarak işlenir, ancak eski sohbet geçmişi ona tekrar eklenmez.

Odak düellosu yalnızca `OFFER_FOCUS_DUEL` ve 5–60 dakika aralığı ile önerilir. Kullanıcı kabulünden önce `PENDING` kalır. Tekrarlanan kabul yalnızca bir ilişki sayacı değişimi oluşturur. Nova gerçek kullanıcı çalışma kaydı/timer'ı/puanını yazmaz. İlişki sayıları ürün içi üslup parametreleridir, psikolojik ölçüm değildir.

Her başarıyla tamamlanan kullanıcı yanıtı familiarity/warmth değerlerini bir artırır; kabul edilen düello familiarity/rivalry değerlerini bir artırır. Değerler 100'de sınırlanır. Completion/kabul tekrarları ikinci artış yapmaz. Yanıtsız bırakma, uygulamayı kapatma veya düelloyu reddetme değer düşürmez.

## Doğrulama ve sınırlar

```powershell
pnpm exec tsx --test supabase/tests/nova-security-queue.test.ts
pnpm test:db
```

Testler bütün migration'ları gerçek gömülü PostgreSQL (PGlite) üzerinde yükler; farklı DB rolleri, RLS, izinler, foreign key, değişmez snapshot, kuyruk, lease, bağlam, unutma ve eşleştirme davranışlarını çalıştırır. İki cihazın yarışması aynı gömülü bağlantıda test edilir; ayrı bağlantılı gerçek PostgreSQL kilit zamanlaması testi değildir. Üretim öncesinde yerel Supabase üzerinde iki bağımsız bağlantıyla SKIP LOCKED/lease/revoke yarışlarını da doğrulayın.

Migration adı Supabase CLI 2.120.0 ile önce `--help`, `migration --help`, `migration new --help` okunup `migration new nova_local_companion` çalıştırılarak üretildi. Docker bu çalışma ortamında bulunamadığı için yerel Supabase stack, yerel advisors ve PostgREST HTTP kontrolleri çalıştırılmadı. Üretim advisors/migration çağrısı yapılmadı. Saf SQL testinin geçmesi gerçek Ollama, Windows GPU veya gerçek production kurulumu doğrulaması değildir.

İlgili resmi kaynaklar: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database functions](https://supabase.com/docs/guides/database/functions), [Supabase değişiklik günlüğü](https://supabase.com/changelog). Yetki davranışı migration'daki açık grants/policies ile sabitlenir; yeni tabloların varsayılan Data API yetkilerine güvenilmez.

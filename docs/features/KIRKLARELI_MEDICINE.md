# Kırklareli Tıp çalışma alanı

Üniversite öğrencileri **Konularım** veya **Ayarlar → Öğrenci alanım** üzerinden Kırklareli Üniversitesi Tıp Fakültesi 2026–2027 müfredatını seçebilir. Akademik yıl ve Dönem 1–4 seçilir. Genel üniversite sonuçları ve YKS konuları bağımsız olarak erişilebilir kalır. Mevcut hesaplarda bu alan kendiliğinden etkinleştirilmez.

İlk kurulumda ve **Ayarlar → Öğrenci alanım → Profilimi düzenle** içinde de **Üniversite programı → Kırklareli Üniversitesi Tıp** ve Dönem 1–4 seçimi bulunur. Kaydetme önce üniversite eğitim profilini kaydeder, ardından seçilen akademik yıl ve dönem için tıp profilini etkinleştirir. Etkinleştirme başarısızsa düzenleyici açık kalır; değişmemiş eğitim profilini yeniden göndermeden aynı tıp isteğini tekrar dener. Program seçimi kaydedilmiş kurulum taslağında da korunur.

## Müfredat ve kaynaklar

Sabitlenmiş katalog Dönem I'de beş kurul, Dönem II'de altı kurul, Dönem III'te yedi kurul, Dönem IV'te sekiz staj ve üç Kliniğe Erken Giriş (KEG) dersi içerir. Konu satırlarında fakültenin kaynak URL'si ve sayfa numaraları korunur. Aynı birim/ders içindeki tekrarlanan ders başlıkları birleştirilir; teorik ve uygulamalı içerik ayrı tutulur. Dönem IV, adı belirtilen hastalık/ders tablolarını ve haftalık programlardaki ek dersler ile hasta başı oturumlarını içerir.

Kaynaklara fakültenin [web sitesinden](https://tip.klu.edu.tr/) ulaşılır:

- [2026–2027 onaylı eğitim planı](https://tip.klu.edu.tr/dosyalar/birimler/tip/dosyalar/dosya_ve_belgeler/ders_programi_egitim_planlari/2026-2027_egitim__plan_ve_ders_programi/tip_fakultesi_egitim_plani.pdf)
- Dönem 1–4'e ait dört PDF; tam URL'leri her katalog biriminde yer alır.
- [Eğitim ve öğretim yönetmeliği, madde 21](https://oidb.klu.edu.tr/dosyalar/birimler/oidb/dosyalar/dosya_ve_belgeler/tip_fakultesi_egitim_ve_ogretim_yonetmeligi.docx)
- [Sınav uygulama, ölçme ve değerlendirme esasları](https://tip.klu.edu.tr/dosyalar/birimler/tip/dosyalar/dosya_ve_belgeler/mevzuat/usul_ve_esaslar/9-_tip_fakultesi_sinav__uygulama_ve_olcme_degerlendirme_esaslari.pdf)

Katalog sürümü `klu-2026-2027` olarak tutulur; öğrenci kişisel kayıtlarının akademik yılını değiştirse de bu sürüm görünür kalır. Dönem V–VI için başka fakültelerin programlarından başlangıç verisi üretilmez. Yeni sürüm eklemeden önce yeni resmî program incelenmelidir.

Konu JSON'unu yeniden üretmek için kaynak PDF'leri `klu-d1.pdf`–`klu-d4.pdf` adlarıyla kaydet, `pdfplumber` kur ve şu komutu çalıştır:

```powershell
python scripts/build-klu-medicine.py --source-dir <source-folder>
```

Yayınlamadan önce çıkarılan veriyi kaynak sayfalarla karşılaştır. Konu kimlikleri birim, normalize edilmiş ad, ders ve teorik/uygulamalı içerik türünden türetilir. Özel veritabanı kataloğunun anahtarları istemci JSON'uyla eşleşmelidir; `tests/medicine-catalog.test.ts` bu yayın sözleşmesini kontrol eder.

## Not kuralları

- Dönem I–III: ağırlıklı kurul ortalaması × %50 + final/bütünleme × %50. Ağırlıklar yayımlanan teorik + uygulamalı ders saatlerine (ders yüküne) dayanır.
- Fakültenin ders bazındaki baraj kesintilerini uyguladıktan sonra açıkladığı kurul puanı girilir. YKS net hesabı uygulanmaz ve baraj kesintisi yeniden düşülmez.
- Dönem puanı/final hedefi hesaplanmadan önce bütün kurul puanları bulunmalıdır. Kısmi ortalama açıkça geçici olarak işaretlenir. Boş alan eksik kayıttır; kaydedilmiş sıfır gerçek puandır.
- Dönem başarısı için puan ≥60 ve kaydedilmiş KEG ders sonucunun yeterli olması gerekir. Başka fakültelere ait final ≥50 eşiği veya final muafiyeti kuralı aktarılmaz.
- Dönem IV staj bileşenleri: teorik × %40 + uygulama × %60. Teorik puan ≥60 ve birleşik puan ≥60 olmalıdır. Yüksek uygulama puanı teorik başarısızlığı; yüksek yıllık ortalama başarısız stajı kapatmaz. Öğrenci bunun yerine fakültenin açıkladığı son staj puanını da kaydedebilir. Bileşenlerin bir kısmı girilmişse sonuç eksik kalır.
- Bütünleme puanı daha düşük olsa bile normal sınav sonucunun yerini alır; iki sınav kaydı da saklanır. Bütünleme kaydı silinirse hesaplamada normal sonuç yeniden kullanılır. Geçme/kalma kararı verilmeden önce değerler yuvarlanmaz.
- KEG becerileri için kişisel çalışma ilerlemesi tutulur. Bu ilerleme ders yeterliliği sağlamaz; öğrenci açıklanan KEG sonucunu ve tarihini ayrıca girer.

## Kalıcılık ve veri ayrımı

`/api/medicine`, doğrulanmış öğrenci oturumunu, POST isteklerinde aynı origin denetimini, sınırlandırılmış girdiyi ve `medicine_state` / `medicine_command` RPC'lerini kullanır. Kişisel ilerleme, notlar, KEG ve ayarlar RLS korumalı dört tabloda tutulur. Tarayıcı rollerinin tablolarda yalnız SELECT yetkisi vardır; yazmalar dar yetkili public invoker sarmalayıcıdan ve private definer uygulamasından geçer. Bu katman doğrulanmış, onaylı öğrenci ve tarayıcı oturumunu açıkça denetler. Müfredat anahtarları ve işlem makbuzları private alandadır; tarayıcı istemcileri bunları doğrudan sorgulayamaz.

Her yazma güncel satır revizyonunu kontrol eder ve işlemi yapan hesaba bağlı istek makbuzu tutar. Belirsiz ağ hatalarında aynı kimlikle yeniden denenir; değişmiş payload eski makbuzu kullanamaz. Akademik yıllar birbirinden ayrıdır; durum yanıtı yalnız seçili yıl/dönemi döndürür. Hesap silindiğinde üst hesap yabancı anahtarı kişisel kayıt ve makbuzlara ait beş tabloda zincirleme silme uygular; hesap silme testi bu ilişki ağını örnek verilerle kontrol eder. Sınıf istatistiklerine, YKS MCP araçlarına ve Nova'ya tıp notları veya puanları aktarılmaz.

## Yayın ve geri dönüş

Arayüzü yayınlamadan önce `20261013220338_kirklareli_medicine.sql` uygulanmalıdır. Migration ek yapılar oluşturur; YKS satırlarını değiştirmez veya öğrencilerin tıp profilini etkinleştirmez. Gerekirse uygulama commit'lerini geri al; öğrenci kayıtlarını korumak için eklenen tabloları tut. Öğrenci, verisini silmeden tıp çalışma alanını gizleyebilir.

## Doğrulama

Not eşikleri, katalog/kaynak anahtarları, PGlite kalıcılık/RLS/yeniden deneme ve hesap silme testleri bu özelliği kapsar. Tarayıcı senaryoları konu ilerlemesi/notlar, KEG, bütünleme hesapları, staj başarı koşulları, dönem değiştirme, yanıt kaybından sonra yeniden deneme ve 320 px düzeni kontrol eder.

Önceki okul testi ve yayın notları [tarihsel kayıtta](../archive/KIRKLARELI_MEDICINE_HISTORY.md) korunur. Güncel test komutları ve kabul sınırları [TESTING.md](../TESTING.md) içindedir.

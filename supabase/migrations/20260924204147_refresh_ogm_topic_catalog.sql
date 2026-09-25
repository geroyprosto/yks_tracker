-- MEB OGM study headings; this editable catalogue is not an announced 2027 exam scope.
-- The generated source is supabase/catalog/ogm-topic-headings.json.
create or replace function private.starter_topics()
returns table(exam text, subject text, name text, source text)
language sql stable set search_path = '' as $$
  select c.exam, c.subject, c.name, c.source
  from (values
    ('TYT', 'Türkçe', 'Sözcükte Anlam', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Cümlede Anlam', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Paragrafta Anlam', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Ses Bilgisi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Sözcükte Yapı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Yazım Kuralları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Noktalama İşaretleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'İsim Soylu Sözcükler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Fiiller', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Tamlamalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Cümlenin Ögeleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Cümle Türleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Türkçe', 'Anlatım Bozuklukları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/tde/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Önermeler ve Bileşik Önermeler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Kümelerde Temel Kavramlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Kümelerde İşlemler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Sayı Kümeleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Bölünebilme Kuralları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Birinci Dereceden Denklemler ve Eşitsizlikler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Üslü İfadeler ve Denklemler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Denklemler ve Eşitsizliklerle İlgili Uygulamalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Üçgenlerde Temel Kavramlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Üçgenlerde Eşlik ve Benzerlik', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Üçgenlerin Yardımcı Elemanları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Dik Üçgen ve Trigonometri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Üçgenin Alanı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Merkezi Eğilim ve Yayılım Ölçüleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Verilerin Grafik ile Gösterilmesi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Sıralama ve Seçme', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Basit Olayların Olasılıkları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Fonksiyon Kavramı ve Gösterimi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'İki Fonksiyonun Bileşkesi ve Ters Fonksiyon', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Polinom Kavramı ve Polinomlarda İşlemler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Polinomların Çarpanlara Ayrılması', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'İkinci Dereceden Bir Bilinmeyenli Denklemler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Çokgenler - Dörtgenler ve Özellikleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Özel Dörtgenler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Matematik', 'Katı Cisimler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Fizik Bilimine Giriş', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Madde ve Özellikleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Kuvvet', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'İş, Güç ve Enerji', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Isı ve Sıcaklık', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Elektrostatik', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Elektrik ve Manyetizma', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Basınç', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Kaldırma Kuvveti', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Dalgalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Fizik', 'Optik', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/fizik/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Simyadan Kimyaya - Kimya Disiplinleri ve Kimyacıların Çalışma Alanları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Kimyanın Sembolik Dili - Kimya Uygulamalarında İş Sağlığı ve Güvenliği', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Atom Modelleri ve Atomun Yapısı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Periyodik Sistem', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Kimyasal Türler ve Kimyasal Türler Arasındaki Etkileşimlerin Sınıflandırılması', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Maddenin Hâlleri (Katılar, Sıvılar, Gazlar, Plazma)', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Su, Hayat ve Çevre Kimyası', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Kimyanın Temel Kanunları ve Mol Kavramı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Kimyasal Tepkimeler - Kimyasal Tepkimelerde Hesaplamalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Karışımlar - Karışımları Ayırma Teknikleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Asitler, Bazlar ve Tuzlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Kimya', 'Yaygın Günlük Hayat Kimyasalları ve Gıdalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/kimya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Biyoloji ve Canlıların Ortak Özellikleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'İnorganik Bileşikler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Karbonhidratlar - Lipitler - Proteinler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Enzimler - Vitaminler - Hormonlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Nükleik Asitler - ATP', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Hücrenin Yapısı ve Kısımları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Hücre Zarından Madde Geçişleri - Bilimsel Yöntem', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Canlıların Çeşitliliği ve Sınıflandırılması', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Canlı Âlemleri ve Özellikleri - Virüsler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Mitoz ve Eşeysiz Üreme', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Mayoz ve Eşeyli Üreme', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Kalıtımın Genel Esasları - Mendel İlkeleri ve Çaprazlamalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Eş Baskınlık - Çok Alellilik - Kan Grupları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Eşeye Bağlı Kalıtım - Genetik Varyasyonlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Soyağaçları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Ekosistem Ekolojisi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Güncel Çevre Sorunları ve İnsan', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Biyoloji', 'Doğal Kaynaklar ve Biyolojik Çeşitliliğin Korunması', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Coğrafya Bilimi, Doğa ve İnsan', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Dünya’nın Şekli ve Hareketleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Yer ve Zaman, Koordinat Sistemi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Harita Bilimi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Atmosfer, Hava Durumu, Sıcaklık', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Basınç ve Rüzgâr, Nem ve Yağış', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'İklim Tipleri ve Türkiye İklimi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Yerleşmeler ve Bölgeler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Doğal Çevreyi Kullanma Biçimleri ve İnsan Etkileri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Dünya’nın Tektonik Oluşumu ve İç Kuvvetler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Dış Kuvvetler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Türkiye’nin Yüzey Şekilleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Su Kaynakları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Topraklar ve Bitkiler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Nüfus', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Göçler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Ekonomik Faaliyetler ve Ulaşım Hatları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('TYT', 'Coğrafya', 'Afetler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/tyt/cografya/files/basic-html/page8.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Polinomlar ve Çarpanlara Ayırma', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/3adim/ayt/matematik/matematik.pdf · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Yönlü Açılar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Trigonometrik Fonksiyonlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Doğrunun Analitik İncelenmesi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Fonksiyonlar ile İlgili Uygulamalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'İkinci Dereceden Fonksiyonlar ve Grafikleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Fonksiyonların Dönüşümleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'İkinci Dereceden İki Bilinmeyenli Denklem Sistemleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'İkinci Dereceden Bir Bilinmeyenli Eşitsizlik Sistemleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Çemberin Temel Elemanları - Çemberde Açılar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Çemberde Teğet - Dairenin Çevresi ve Alanı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Katı Cisimler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Koşullu Olasılık, Deneysel ve Teorik Olasılık', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Üstel Fonksiyon', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Logaritma Fonksiyonu', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Üstel, Logaritmik Denklemler ve Eşitsizlikler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Gerçek Sayı Dizileri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Toplam - Fark ve İki Kat Açı Formülleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Trigonometrik Denklemler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Analitik Düzlemde Temel Dönüşümler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Limit ve Süreklilik', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Anlık Değişim Oranı ve Türev', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Türevin Uygulamaları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Belirsiz İntegral', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Belirli İntegral ve Uygulamaları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Matematik', 'Çemberin Analitik İncelenmesi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/matematik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Vektörler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Bağıl Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Newton’ın Hareket Yasaları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Bir Boyutta Sabit İvmeli Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'İki Boyutta Sabit İvmeli Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Enerji ve Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'İtme ve Çizgisel Momentum', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Tork ve Denge', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Basit Makineler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Elektriksel Kuvvet - Elektrik Alan', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Elektriksel Potansiyel', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Düzgün Elektrik Alan ve Sığa', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Manyetizma ve Elektromanyetik İndüklenme', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Alternatif Akım ve Transformatörler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Çembersel Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Açısal Momentum-Kütle Çekim Kuvveti ve Kepler Kanunları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Basit Harmonik Hareket', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Dalgalarda Kırınım, Girişim, Doppler Olayı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Elektromanyetik Dalgalar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Atom Kavramının Tarihsel Gelişimi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Büyük Patlama ve Evrenin Oluşumu', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Radyoaktivite', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Özel Görelilik ve Kuantum Fiziğine Giriş', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Fotoelektrik Olay', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Compton Saçılması ve de Broglie Dalga Boyu', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Fizik', 'Modern Fiziğin Teknolojideki Uygulamaları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/fizik/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Modern Atom Teorisi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Gazlar', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Sıvı Çözeltiler ve Çözünürlük', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Kimyasal Tepkimelerde Enerji', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Kimyasal Tepkimelerde Hız', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Kimyasal Tepkimelerde Denge', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Kimya ve Elektrik', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Karbon Kimyasına Giriş', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Organik Bileşikler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Kimya', 'Enerji Kaynakları ve Bilimsel Gelişmeler', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/kimya/files/basic-html/page10.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Sinir Sistemi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Endokrin Sistem', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Duyu Organları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Destek ve Hareket Sistemi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Sindirim Sistemi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Dolaşım Sistemleri', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Bağışıklık Çeşitleri ve Savunma Mekanizmaları', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Solunum Sistemi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Üriner Sistem', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Üreme Sistemi ve Embriyonik Gelişim', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Komünite Ekolojisi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Popülasyon Ekolojisi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Nükleik Asitlerin Keşfi ve Önemi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Genetik Şifre ve Protein Sentezi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Genetik Mühendisliği ve Biyoteknoloji', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Canlılık ve Enerji - Fotosentez - Kemosentez', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Hücresel Solunum - Fermantasyon - Fotosentez ve Solunum İlişkisi', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Bitkilerin Yapısı', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Bitkilerde Madde Taşınması', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Bitkilerde Eşeyli Üreme', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.'),
    ('AYT', 'Biyoloji', 'Canlılar ve Çevre', 'MEB OGM: https://ogmmateryal.eba.gov.tr/panel/upload/etkilesimli/kitap/konu-pekistirme/ayt/biyoloji/files/basic-html/page6.html · 2027 kapsamı kesinleşmiş sayılmaz.')
  ) as c(exam, subject, name, source);
$$;
revoke all on function private.starter_topics() from public, anon, authenticated;

create or replace function private.initialize_owner(owner_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare is_new boolean; profile public.profiles; local_day date;
begin
  insert into public.profiles(user_id) values(owner_id) on conflict do nothing;
  is_new := found;
  if is_new then
    insert into public.topics(user_id, exam, subject, name, source)
    select owner_id, c.exam, c.subject, c.name, c.source from private.starter_topics() c
    on conflict (user_id, exam, subject, name) do nothing;
  end if;
  select * into profile from public.profiles where user_id = owner_id;
  local_day := (clock_timestamp() at time zone profile.timezone)::date;
  if not exists(select 1 from public.daily_plan_versions where user_id = owner_id and plan_date = local_day) then
    perform private.snapshot_day(owner_id, local_day);
  end if;
end $$;

-- Remove only untouched starter entries with no dependent record. Personal notes,
-- mastery, tasks, sessions, history and child topics retain their original IDs.
delete from public.topics t
where t.source = 'Düzenlenebilir başlangıç listesi; 2027 kapsamı olarak doğrulanmadı.'
  and t.mastery = 0 and t.notes = '' and t.next_step = ''
  and t.review_requested = false and t.parent_id is null
  and not exists(select 1 from public.tasks x where x.topic_id = t.id)
  and not exists(select 1 from public.study_sessions x where x.topic_id = t.id)
  and not exists(select 1 from public.topic_history x where x.topic_id = t.id)
  and not exists(select 1 from public.topics x where x.parent_id = t.id)
  and (
    (t.exam = 'TYT' and t.subject in ('Tarih', 'Felsefe', 'Din Kültürü'))
    or (
      exists(select 1 from private.starter_topics() c where c.exam = t.exam and c.subject = t.subject)
      and not exists(select 1 from private.starter_topics() c
        where c.exam = t.exam and c.subject = t.subject and c.name = t.name)
    )
  );

insert into public.topics(user_id, exam, subject, name, source)
select p.user_id, c.exam, c.subject, c.name, c.source
from public.profiles p cross join private.starter_topics() c
on conflict (user_id, exam, subject, name) do nothing;

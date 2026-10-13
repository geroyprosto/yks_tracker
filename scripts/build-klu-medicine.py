from pathlib import Path
import json, re, hashlib, unicodedata, sys
import pdfplumber
sys.stdout.reconfigure(encoding='utf-8')
ROOT = Path(__file__).parent
REPO = Path(__file__).resolve().parents[1]
def clean(value):
    return re.sub(r'\s+', ' ', value or '').strip()
def normalized(value):
    return clean(unicodedata.normalize('NFC', value)).casefold()
def topic_id(unit, subject, kind, name):
    return unit + '-' + hashlib.sha256((normalized(subject)+'|'+kind+'|'+normalized(name)).encode()).hexdigest()[:16]
def tables_report():
    with pdfplumber.open(ROOT/'klu-d4.pdf') as pdf:
        for page_no, page in enumerate(pdf.pages,1):
            for table in page.extract_tables():
                for row in table[:3]:
                    line=clean(' '.join(cell or '' for cell in row))
                    if re.search(r'KONU|Konu|DERS ADI|Ders Adı',line):
                        print(page_no, row)
BASE='https://tip.klu.edu.tr/dosyalar/birimler/tip/dosyalar/dosya_ve_belgeler/ders_programi_egitim_planlari/2026-2027_egitim__plan_ve_ders_programi/'
FILES={1:'2026-2027_do%CC%88nem_1_web_formati_11.09.2026.pdf',2:'do%CC%88nem_ii_ders_programi_09.09.26.pdf',3:'2026-2027_donem_3_ders_programi_10.09.2026.pdf',4:'donem_iv_egitim_plani15.09.2026.pdf'}
META={
1:[('Yaşamın Moleküler Temelleri',140),('Hücre',124),('Kalıtım ve Üreme',94),('Doku',94),('Hareket Sistemi',107)],
2:[('Kas ve Periferik Sinir Sistemi',75),('Dolaşım ve Solunum Sistemleri',194),('Sindirim Sistemi ve Metabolizma',90),('Endokrin ve Ürogenital Sistem',138),('Sinir Sistemi',139),('Hastalıkların Biyolojik Temelleri',70)],
3:[('Hemato-Onkoloji ve Enfeksiyon Hastalıkları',140),('Gastrointestinal ve Duyu Sistemleri',102),('Dolaşım ve Solunum Sistemleri',121),('Endokrin Sistem',114),('Ürogenital Sistem',89),('Nörolojik Bilimler, Psikiyatri, Kas ve İskelet Sistemi',142),('Halk Sağlığı ve Acil',76)],
4:[('İç Hastalıkları',243),('Genel Cerrahi',228),('Kadın Hastalıkları ve Doğum',214),('Kardiyoloji',112),('Göğüs Hastalıkları',128),('Nöroloji',144),('Nöroşirürji',64),('Radyoloji',64)]}
STARTS={1:[5,19,29,37,49],2:[5,13,24,35,46,55],3:[7,15,22,30,37,44,52],4:[5,38,61,81,92,106,123,133]}
def add_topic(unit,name,subject,kind,page):
    name=clean(name);subject=clean(subject)
    name=re.sub(r'\bLAB\s*[A-D]\s*[:\-]?', 'Laboratuvar:',name,flags=re.I)
    name=re.sub(r'\bGRUP\s*[A-D]\s*[:\-]?', '',name,flags=re.I)
    if len(name)<3 or not subject or len(name)>500:return
    if re.search(r'SERBEST|ÖĞLE|SINAV|MAZERET|TATİL|Ortak zorunlu|Kurul.*(?:amaç|hedef|Tanıt)|ORYANTASYON|Dönem.*Tanıt|KEYPS|Yönetmelik|DANIŞMAN|Açılış|Laboratuvarların Tanıt',name,re.I):return
    if subject in ['İNGİLİZCE I','İNGİLİZCE II','TÜRK DİLİ I','TÜRK DİLİ II','Tıbbi İngilizce I','Tıbbi İngilizce II','Atatürk İlkeleri ve İnkılâp I','Atatürk İlkeleri ve İnkılâp II']:return
    if re.search(r'Kliniğe\s*(?:Erken|erken)\s*[Gg]iriş|^KEG$',subject):
        unit=UNITS[f'd{unit["year"]}-keg'];subject='Kliniğe Erken Giriş'
    key=topic_id(unit['id'],subject,kind,name)
    prior=next((t for t in unit['topics'] if t['id']==key),None)
    if prior:
        if page not in prior['pages']:prior['pages'].append(page)
    else:unit['topics'].append({'id':key,'name':name,'subject':subject,'kind':kind,'pages':[page]})
UNITS={}
def schedule(year):
    with pdfplumber.open(ROOT/f'klu-d{year}.pdf') as pdf:
        for page_no,page in enumerate(pdf.pages,1):
            index=max((i for i,start in enumerate(STARTS[year]) if page_no>=start),default=-1)
            if index<0:continue
            unit=UNITS[f'd{year}-k{index+1}']
            for found in page.find_tables():
                table=found.extract()
                header_idx=next((i for i,row in enumerate(table[:4]) if any(clean(c)=='KONU' for c in row) and any('SAAT' in clean(c) for c in row)),None)
                if header_idx is None:continue
                headers=table[header_idx]
                topic_col=next(i for i,c in enumerate(headers) if clean(c)=='KONU')
                subj_col=next((i for i,c in enumerate(headers) if 'ANABİLİM' in clean(c)),None)
                teach_col=next((i for i,c in enumerate(headers) if 'ÖĞRETİM' in clean(c)),len(headers))
                time_col=next(i for i,c in enumerate(headers) if 'SAAT' in clean(c))
                if subj_col is None:continue
                cells=found.rows[header_idx].cells
                timebox=cells[time_col];topic_left=cells[topic_col][0];subj_left=cells[subj_col][0]
                teacher_left=cells[teach_col][0] if teach_col<len(cells) else cells[subj_col][2]
                if timebox is None:continue
                time_words=[w for w in page.extract_words() if re.fullmatch(r'\d{2}:\d{2}-\d{2}:\d{2}',w['text']) and timebox[0]<=w['x0']<timebox[2] and w['top']>timebox[3] and w['bottom']<=found.bbox[3]+1]
                lines=sorted(set(round(e['top'],2) for e in page.edges if e['orientation']=='h' and e['x0']<=timebox[0]+.6 and e['x1']>=timebox[2]-.6))
                for word in time_words:
                    top=max((y for y in lines if y<word['top']),default=word['top']-3)
                    bottom=min((y for y in lines if y>word['bottom']),default=word['bottom']+3)
                    def text(left,right):return clean(page.crop((left+.5,top+.2,right-.5,bottom-.2)).extract_text(x_tolerance=1,y_tolerance=2))
                    name=text(topic_left,subj_left);subject=text(subj_left,teacher_left)
                    marker=text(timebox[2],topic_left)
                    kind='practice' if re.search(r'\b[PUL]\b',marker) else 'theory'
                    add_topic(unit,name,subject,kind,page_no)
def clerkships():
    # These source pages contain the named course/condition/skill tables;
    # weekly rotations repeat the same content for different student groups.
    sections={1:[8,9,19,20,21,22,23,24,25,26,27],2:[41,42,43],3:[64,65,68,69,70],4:[84,85],5:[95,96,103,104,105],6:[110,111,112,113,114,115,122],7:[125,126,127,128],8:[138,139,140]}
    with pdfplumber.open(ROOT/'klu-d4.pdf') as pdf:
        for number,pages in sections.items():
            unit=UNITS[f'd4-s{number}'];previous=None
            for page_no in pages:
                for table in pdf.pages[page_no-1].extract_tables():
                    if len(table)<2:continue
                    header=table[0];header_text=clean(' '.join(c or '' for c in header))
                    matched=bool(re.search(r'DERS ADI|Ders Adı|KONU \(UÇEP\)|^Konu |Teorik Ders- Konu Adı|Pratik Uygulama Konuları|DERSİN KONUSU',header_text))
                    if matched:
                        previous=header;rows=table[1:]
                    elif previous and len(header)==len(previous):header=previous;rows=table
                    else:continue
                    col=next((i for i,c in enumerate(header) if re.search(r'KONU \(UÇEP\)|^Konu$|DERS ADI|Ders Adı|Teorik Ders- Konu Adı|Pratik Uygulama Konuları|DERSİN KONUSU',clean(c))),0)
                    for row in rows:
                        name=clean(row[col])
                        if re.search(r'TEORİK|PRATİK|DERSİN KONUSU|ÖĞRETİM|HAFTA|SAAT|TOPLAM|PROGRAM|BECERİLER|ÖĞRENME',name) or not name:continue
                        kind='practice' if 'Pratik Uygulama' in clean(' '.join(c or '' for c in header)) else 'theory'
                        # Numeric T/P hours distinguish practical skills in course tables.
                        p_col=next((i for i,c in enumerate(header) if clean(c) in ['P','Uygulama Saati']),None)
                        t_col=next((i for i,c in enumerate(header) if clean(c) in ['T','Teorik Saati']),None)
                        if p_col is not None and t_col is not None and clean(row[p_col]).isdigit() and clean(row[t_col]) in ['0','-',''] and int(clean(row[p_col]))>0:kind='practice'
                        if 'Tür' in header:
                            kind='practice' if clean(row[header.index('Tür')]).upper() in ['P','U','PRATİK'] else 'theory'
                        add_topic(unit,name,unit['name'],kind,page_no)
        # Weekly course tables contain additional lectures and patient-side
        # sessions that do not all appear in the UCEP condition lists.
        for page_no,page in enumerate(pdf.pages,1):
            section=max((i for i,start in enumerate(STARTS[4]) if page_no>=start),default=-1)
            if section<0:continue
            unit=UNITS[f'd4-s{section+1}']
            for table in page.extract_tables():
                header_index=next((i for i,row in enumerate(table[:3]) if 'PAZARTESİ' in clean(' '.join(c or '' for c in row))),None)
                if header_index is None:continue
                header=table[header_index]
                days=[i for i,c in enumerate(header) if re.search(r'PAZARTESİ|SALI|SA LI|ÇARŞAMBA|PERŞEMBE|CUMA',clean(c))]
                for row in table[header_index+1:]:
                    for i,start in enumerate(days):
                        end=days[i+1] if i+1<len(days) else len(row)
                        name=clean(' '.join(c or '' for c in row[start:end]))
                        name=re.split(r'\b(?:Prof\.|Doç\.|Uzm\.|Dr\.|Öğr\.)',name)[0].strip()
                        name=re.sub(r'\b\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}\b','',name).strip()
                        if re.search(r'HAFTA|STAJ BLOĞU|STAJ TANITIM|TANITIMI|ÖĞLE|\bYAZILI\b|^TEORİK$',name,re.I):continue
                        kind='practice' if re.search(r'vizit|hasta\s*başı|hastabaşı|uygulama|pratik|ameliyathane|klinik beceri',name,re.I) else 'theory'
                        add_topic(unit,name,unit['name'],kind,page_no)
def build():
    for year,items in META.items():
        for index,(name,weight) in enumerate(items,1):
            key=f'd{year}-'+('s' if year==4 else 'k')+str(index)
            UNITS[key]={'id':key,'year':year,'name':name,'kind':'staj' if year==4 else 'kurul','weight':weight,'sourceUrl':BASE+FILES[year],'topics':[]}
        if year<4:UNITS[f'd{year}-keg']={'id':f'd{year}-keg','year':year,'name':'Kliniğe Erken Giriş','kind':'keg','weight':0,'sourceUrl':BASE+FILES[year],'topics':[]}
    for year in [1,2,3]:schedule(year)
    clerkships()
    data={'version':'klu-2026-2027','units':list(UNITS.values())}
    dest=REPO/'src/lib/catalogs/klu-medicine-2026.json';dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for unit in UNITS.values():print(unit['id'],unit['name'],len(unit['topics']))
    print('Total',sum(len(u['topics']) for u in UNITS.values()))
if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description='Rebuild the KLU 2026-2027 topic catalog from the four official PDFs.')
    parser.add_argument('--source-dir',type=Path,required=True,help='Folder containing klu-d1.pdf through klu-d4.pdf')
    ROOT=parser.parse_args().source_dir
    build()

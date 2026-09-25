export const masteryLabels=['Başlanmadı','Öğreniliyor','Konu anlatımı tamamlandı','Bağımsız soru çözülebiliyor','Konuya hâkimim'];
export const studyTypes=['Konu anlatımı','Soru çözümü','Tekrar','Hızlı gözden geçirme','Yanlış analizi','Hâkimiyet kontrolü'];
export const themes=[
 {id:'rose',accents:["#ff6c99","#63dfaa"],pair:'Pembe + adaçayı yeşili',name:'Mercan / Gül',colors:['#590D22','#800F2F','#A4133C','#C9184A','#FF4D6D','#FF758F','#FF8FA3','#FFB3C1','#FFCCD5','#FFF0F3']},
 {id:'ocean',accents:["#40d7f6","#ff967d"],pair:'Turkuaz + mercan',name:'Okyanus',colors:['#03045E','#023E8A','#0077B6','#0096C7','#00B4D8','#48CAE4','#90E0EF','#ADE8F4','#CAF0F8']},
 {id:'plum',accents:["#d6a0f0","#e6cf8e"],pair:'Leylak + yumuşak altın',name:'Mürdüm / Krem',colors:['#190019','#2B124C','#522B5B','#854F6C','#DFB6B2','#FBE4D8']},
 {id:'pastel',accents:["#bd86f2","#82d5b3"],pair:'Lavanta + nane yeşili',name:'Pastel',colors:['#F4E7FB','#F2D0DC','#F6BCBA','#E3AADD','#C8A8E9','#C3C7F4']},
 {id:'white',name:'Beyaz',colors:['#FFFFFF','#F4F5F7','#E4E7EC','#C6CBD3','#657184','#202733'],accents:['#66b9ef','#f5b58c'],pair:'Beyaz zemin · mavi + kayısı'},
 {id:'black',name:'Siyah',colors:['#101214','#191C20','#272B31','#454C56','#A8B0BC','#F3F5F8'],accents:['#87cdeb','#ecb991'],pair:'Siyah zemin · turkuaz + kayısı'},
];
// Keep previously saved palettes readable after their removal from the picker.
export function normalizeTheme(value:string){
 const legacyThemes:Record<string,string>={steel:'ocean',graphite:'black',forest:'black',aurora:'white',burgundy:'rose'};
 const theme=legacyThemes[value]??value;
 return themes.some(t=>t.id===theme)?theme:undefined;
}
export function localDate(value:Date|number=new Date(),timezone='Europe/Istanbul'){
 return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
}
export function formatDay(date:string,options:Intl.DateTimeFormatOptions={day:'numeric',month:'long',weekday:'long'}){
 return new Intl.DateTimeFormat('tr-TR',{...options,timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
}
export function duration(seconds:number){
 const m=Math.floor(Math.max(0,seconds)/60);return m>=60?Math.floor(m/60)+' sa '+m%60+' dk':m+' dk';
}
export function clockText(seconds:number){
 const s=Math.max(0,Math.floor(seconds));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');
}
export type CommandFn=(type:string,payload:Record<string,unknown>)=>Promise<boolean>;




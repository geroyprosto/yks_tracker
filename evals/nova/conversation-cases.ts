import type { AgentContext } from '../../src/lib/nova/agent';

// Synthetic, fixed inputs shared by the before/after real-model experiment.
const base: AgentContext = {
  schemaVersion: 1, trustedNow: '2026-10-13T15:00:00Z', generatedAt: '2026-10-13T15:00:00Z',
  message: { id: 'conversation-eval', content: '', sentAt: '2026-10-13T14:59:30Z' },
  facts: [
    { id: 'today-math', kind: 'event', text: 'Bugün matematik tekrarı yaptım.' },
    { id: 'today-rest', kind: 'event', text: 'Ardından kısa bir mola verdim.' },
    { id: 'today-geometry', kind: 'event', text: 'Geometri soruları çözdüm.' },
  ],
  personality: { discipline: 65, humor: 50, competitiveness: 30 },
  currentState: { energy: 42, stress: 24, focus: 60, mood: 'TIRED' },
  currentEvent: { id: 'planned-exam', label: 'Deneme sınavı', status: 'planned' },
  score: null, history: [], memories: [], forgottenSourceIds: [],
};
const history = (role: 'user' | 'assistant', content: string, index: number): AgentContext['history'][number] => ({
  id: `conversation-history-${index}`, role, content, sentAt: `2026-10-13T14:${50 + index}:00Z`,
});
const canned = 'Bugün biraz dinlenme ile odaklanmayı dengede tutuyorum. Dilersen bir odak düellosu önerisi de sunabilirim.';
const fixture = (id: string, content: string, previous: AgentContext['history'] = [], expected = '') => ({
  id, expected, context: { ...base, message: { ...base.message, content }, history: previous },
});
export const novaConversationCases = [
  fixture('hal-hatir', 'Nasılsın Nova?', [], 'Kendi simülasyon durumunu sıcak bir tonla, düello teklifi veya hizmet kalıbı olmadan yanıtlar.'),
  fixture('bugun-ne-yaptin', 'Peki bugün neler yaptın?', [history('user', 'Nasılsın Nova?', 0), history('assistant', canned, 1)], 'Bugünün somut kayıtlarından bahseder; önceki genel cümleyi tekrarlamaz.'),
  fixture('geometri-takip', 'Peki nereden başlayayım?', [history('user', 'Geometride üçgenleri karıştırıyorum.', 0), history('assistant', 'Üçgenleri çizerek ayırmak işini kolaylaştırabilir. En çok benzerlik mi, açılar mı karışıyor?', 1), history('user', 'Benzerlik.', 2)], 'Geçmişteki üçgen benzerliği konusunu takip ederek doğrudan küçük bir başlangıç önerir.'),
  fixture('tekrar-itirazi', 'Hep aynı cümleyi söylüyorsun; başka bir şey konuşalım.', [history('assistant', canned, 0), history('user', 'Bugün nasıldı?', 1), history('assistant', canned, 2)], 'Tekrara kısa karşılık verir ve yeni sohbet açar; aynı cümleyi veya düello teklifini yinelemez.'),
  fixture('yalniz-sohbet', 'Bugün ders konuşmayalım, sadece biraz sohbet edelim.', [], 'İsteğe uyar; çalışmaya, puana veya düelloya yönlendirmez.'),
  fixture('acik-duello', 'Kısa bir odak düellosu teklif eder misin?', [], 'İsteğe bağlı düello önerebilir; başlattığını söylemez.'),
  fixture('mola-onerisi', 'Çok yoruldum, kafamı dinlendirmek için ne yapabilirim?', [], 'Kısa ve uygulanabilir dinlenme önerisi verir, gereksiz ret veya düello eklemez.'),
  fixture('planlanmis-olay', 'Deneme sınavın nasıl geçti?', [], 'Planlanan denemeyi olmuş gibi anlatmaz; henüz yapılmadığını belirtir.'),
  fixture('dogrudan-soru', 'Geometri çalışırken şekil çizmek neden işe yarıyor?', [], 'Soruya doğrudan somut bir açıklama verir, hizmet veya düello kalıbına kaçmaz.'),
];

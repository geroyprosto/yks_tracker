import {Compass, HeartHandshake, ListChecks, NotebookPen, Orbit, Route, type LucideIcon} from 'lucide-react';
import type {AgentHouseAgentId} from '@/lib/agent-house';

export const agentRooms: Record<AgentHouseAgentId, {name: string; title: string; description: string; short: string; icon: LucideIcon}> = {
  leader: {name: 'Lider', title: 'Büyük resim', short: 'Öncelikler & ilk adım', description: 'Ekibin ortak değerlendirmesi, önceliklerin ve atacağın ilk adım.', icon: Orbit},
  strategy: {name: 'YKS Stratejisti', title: 'Çalışmanın yönü', short: 'Hedefler & yöntem', description: 'Hangi konuyu, neden ve nasıl çalışacağın; haftanın hedefleri ve dayanakları.', icon: Route},
  tracking: {name: 'YKSİM Takipçisi', title: 'İlerlemenin kaydı', short: 'Kayıtlar & sonuçlar', description: 'Çalışma sürelerin, konu ilerlemen ve denemelerin. Eksik kayıtlar ayrıca belirtilir.', icon: ListChecks},
  awareness: {name: 'Öz Farkındalık', title: 'Kendi ritmini keşfet', short: 'Odak & günlük düzen', description: 'Odak, dinlenme ve günlük düzen için gözlemler ve deneyebileceğin küçük adımlar.', icon: HeartHandshake},
  daily: {name: 'Günlük Rehber', title: 'Günün akışı', short: 'Plan & çalışma blokları', description: 'Gün gün çalışma sırası, süreler ve planın aksadığında başvurabileceğin seçenekler.', icon: NotebookPen},
  discovery: {name: 'Keşif', title: 'Yeni bir pencere', short: 'Fikirler & kaynaklar', description: 'Sana uygun fikirler, kaynaklar ve fırsatlar; neden seçildikleriyle birlikte.', icon: Compass},
};

export function reportDate(value: string, time = false) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium', ...(time ? {timeStyle: 'short' as const} : {}), timeZone: 'Europe/Istanbul',
  }).format(parsed) : value;
}

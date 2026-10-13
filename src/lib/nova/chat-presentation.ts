import type {NovaWebState} from './web-types';

const pendingStates = new Set(['QUEUED', 'CLAIMED', 'GENERATING', 'RETRY_WAIT']);
export const jobStatusLabels: Record<string, string> = {
  QUEUED: 'Sırada', CLAIMED: 'Hazırlanıyor', GENERATING: 'Yanıt yazılıyor',
  COMPLETED: 'Yanıtlandı', FAILED: 'Yanıt oluşturulamadı', CANCELLED: 'İptal edildi',
  RETRY_WAIT: 'Yeniden deneme bekliyor',
};
export function hasPendingNovaReply(data: Pick<NovaWebState, 'jobs'> | null): boolean {
  return !!data?.jobs.some(job => pendingStates.has(job.status));
}
export function novaPollInterval(data: Pick<NovaWebState, 'jobs'> | null): number {
  return hasPendingNovaReply(data) ? 2000 : 30000;
}
export function novaConnection(data: Pick<NovaWebState, 'devices' | 'serverNow'>, online: boolean) {
  if (!online) return {kind: 'offline', label: 'İnternet bağlantın kesildi', detail: 'Yeni mesajlar henüz kaydedilemez. Yazdığın metin burada kalır.'} as const;
  const devices = data.devices.filter(device => !device.revoked_at);
  const recent = devices.filter(device => {
    const age = Date.parse(data.serverNow) - Date.parse(device.last_seen_at ?? '');
    return Number.isFinite(age) && age >= 0 && age < 150000;
  });
  const ready = recent.filter(device => device.model_available);
  const isTestAdapter = (model: string | null) => model?.toLowerCase().startsWith('fake') ?? false;
  if (ready.some(device => !isTestAdapter(device.model))) return {kind: 'ready', label: 'Yerel model bağlı', detail: 'Yanıtlar bilgisayarında üretilir.'} as const;
  if (ready.length) return {kind: 'ready', label: 'Test bağdaştırıcısı bağlı', detail: 'Hazır test yanıtları kullanılıyor; gerçek yerel model çalışmıyor.'} as const;
  if (recent.length) return {kind: 'model-missing', label: 'Bilgisayar bağlı, model hazır değil', detail: 'Mesajın kaydedilir; yerel model hazır olduğunda yanıtlanır.'} as const;
  if (!devices.length) return {kind: 'unpaired', label: 'Bilgisayarını bağla', detail: 'Nova Lab’den cihazını eşleştirebilirsin. Gönderdiğin mesajlar sırada korunur.'} as const;
  return {kind: 'disconnected', label: 'Bilgisayar bağlantısı bekleniyor', detail: 'Bilgisayarında Başlat menüsünden “Nova Başlat”ı aç. Kaydedilen mesajların sırada korunur.'} as const;
}
export function novaReplyProgress(data: Pick<NovaWebState, 'jobs'>, connected: boolean) {
  const job = data.jobs.find(item => item.status === 'GENERATING')
    ?? data.jobs.find(item => item.status === 'CLAIMED')
    ?? data.jobs.find(item => pendingStates.has(item.status));
  if (!job) return null;
  if (!connected) return {kind: 'waiting', label: 'Mesajın sırada, bağlantı bekleniyor.'} as const;
  if (job.status === 'GENERATING') return {kind: 'generating', label: 'Nova yanıt yazıyor…'} as const;
  if (job.status === 'CLAIMED') return {kind: 'preparing', label: 'Nova mesajına hazırlanıyor…'} as const;
  if (job.status === 'RETRY_WAIT') return {kind: 'waiting', label: 'Yanıt yeniden denenecek. Mesajın korunuyor.'} as const;
  return {kind: 'waiting', label: 'Mesajın kaydedildi, yanıt sırası bekleniyor.'} as const;
}

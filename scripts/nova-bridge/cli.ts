import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { z } from 'zod';
import { FakeModelAdapter, OllamaModelAdapter } from '../../src/lib/nova/model';
import { CredentialStore, defaultCredentialPath, windowsDpapi } from './credentials';
import { BridgeError, HttpBridgeApi, NovaBridgeWorker, appOrigin, postBridge, wait } from './worker';
import { evaluateModel } from './evaluate';

const configSchema = z.object({ model: z.string().min(1), ollamaUrl: z.string().url(), timeoutMs: z.coerce.number().int().min(100).max(120000), keepAlive:z.string(),pollMs:z.coerce.number().int().min(5000).max(60000) });
const messages: Record<string, string> = {
  ready: 'Nova Bridge hazır; iş bekleniyor.', model_missing: 'Yerel model bulunamadı. Mesajlar kuyrukta korunuyor.',
  completed: 'Yanıt güvenli biçimde teslim edildi.', retry: 'Bağlantı veya işlem hatası; kontrollü yeniden deneme yapılacak.',
  revoked: 'Cihaz yetkisi kaldırıldı; Bridge durduruldu.', stopped: 'Bridge durduruldu. Kuyruktaki mesajlar korunuyor.',
  WINDOWS_DPAPI_REQUIRED: 'Bu cihaz kimliği Windows DPAPI gerektiriyor; düz metin dosyaya kaydedilmedi.',
  OLLAMA_MODEL_MISSING: 'Yerel model bulunamadı. Ollama kurulumunu ve model adını kontrol edin.',
  DEVICE_REVOKED: 'Cihaz yetkisi geçersiz veya kaldırılmış; Nova Lab üzerinden yeniden eşleştirin.',
};
function flags(args: string[]) {
  const values: Record<string, string> = {};
  const allowed = new Set(['app', 'name', 'model', 'ollama', 'timeout', 'output', 'fake','keep-alive','poll-ms']);
  for (let i = 0; i < args.length; i++) {
    const name = args[i].slice(2);
    if (!args[i].startsWith('--') || !allowed.has(name)) throw new Error('ARGUMENT_INVALID');
    if (name === 'fake') { values.fake = 'true'; continue; }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('ARGUMENT_INVALID');
    values[name] = args[++i];
  }
  return values;
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('NODE_24_REQUIRED');
  const [command, ...args] = process.argv.slice(2);
  const options = flags(args);
  const config = configSchema.parse({ model: options.model ?? process.env.NOVA_OLLAMA_MODEL ?? 'qwen3:8b', ollamaUrl: options.ollama ?? process.env.NOVA_OLLAMA_URL ?? 'http://127.0.0.1:11434', timeoutMs: options.timeout ?? process.env.NOVA_MODEL_TIMEOUT_MS ?? 90000,keepAlive:options['keep-alive']??process.env.NOVA_OLLAMA_KEEP_ALIVE??'15m',pollMs:options['poll-ms']??process.env.NOVA_POLL_MS??10000 });
  const adapter = new OllamaModelAdapter({ model: config.model, baseUrl: config.ollamaUrl, timeoutMs: config.timeoutMs,keepAlive:config.keepAlive });
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('SHUTDOWN'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'doctor') {
      const health = await adapter.inspect(controller.signal);
      console.log(JSON.stringify({ node: process.versions.node, windows: process.platform === 'win32', model: config.model, yerelModelHazır: health.available,kuruluYerelModeller:health.models,
        durum:health.reason==='ready'?'Seçili model hazır.':health.reason==='model_missing'?'Ollama açık, ancak yapılandırılan model bulunamadı. Model adını açıkça seçin; otomatik model değişimi yapılmadı.':'Ollama yerel bağlantısına ulaşılamıyor.',
        adres: config.ollamaUrl,sıcakTutma:config.keepAlive,kuyrukKontrolMs:config.pollMs, çıkarımTesti: 'Çalıştırılmadı; bu kontrol model listesini okur.' }, null, 2));
      if (!health.available) process.exitCode = 1;
      return;
    }
    if (command === 'eval') {
      const fake = options.fake === 'true';
      const result = await evaluateModel(fake ? new FakeModelAdapter() : adapter, fake ? 'fake-test-adapter' : config.model, controller.signal);
      const output = JSON.stringify(result, null, 2);
      if (options.output) { await writeFile(options.output, output, { encoding: 'utf8', flag: 'wx' }); console.log('Değerlendirme raporu kaydedildi.'); }
      else console.log(output);
      return;
    }
    if (options.fake) throw new Error('FAKE_EVAL_ONLY');
    if (command === 'pair') {
      const origin = appOrigin(options.app ?? process.env.NOVA_APP_URL ?? '');
      const store = new CredentialStore(defaultCredentialPath(), windowsDpapi());
      const challenge = randomBytes(32).toString('hex');
      const pairing = z.object({ pairing_id: z.string().uuid(), code: z.string().min(4).max(32), expires_at: z.string().datetime({ offset: true }) }).parse(await postBridge(origin, { operation: 'pair.begin', challenge, name: (options.name ?? hostname()).slice(0, 80) }, undefined, controller.signal));
      console.log(`Eşleştirme kodu: ${pairing.code}\nKendi tarayıcınızda giriş yaparak onaylayın: ${origin}/nova?pair=${encodeURIComponent(pairing.code)}\nParola veya anahtarınızı terminale yazmayın.`);
      while (Date.now() < Date.parse(pairing.expires_at)) {
        await wait(5000, controller.signal);
        try {
          const paired = z.object({ device_id: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/u) }).parse(await postBridge(origin, { operation: 'pair.exchange', pairing_id: pairing.pairing_id, challenge }, undefined, controller.signal));
          await store.save({ appUrl: origin, deviceId: paired.device_id, token: paired.token });
          console.log('Cihaz eşleştirildi. Cihaz sırrı Windows kullanıcı korumasıyla kaydedildi.'); return;
        } catch (error) { if (!(error instanceof BridgeError && error.status === 409)) throw error; }
      }
      throw new Error('PAIR_EXPIRED');
    }
    if (command === 'start') {
      const credentials = await new CredentialStore(defaultCredentialPath(), windowsDpapi()).load();
      const worker = new NovaBridgeWorker(new HttpBridgeApi(credentials), adapter, { modelName: config.model,pollMs:config.pollMs, onStatus: status => console.log(messages[status]),onMetrics:metrics=>console.log(JSON.stringify({olcum:metrics})) });
      await worker.run(controller.signal); return;
    }
    console.log('Kullanım: pnpm exec tsx scripts/nova-bridge/cli.ts pair --app https://uygulama-adresi\nKomutlar: pair, start, doctor, eval\nModel seçenekleri: --model qwen3:8b --ollama http://127.0.0.1:11434 --timeout 90000 --keep-alive 15m --poll-ms 10000\nDeğerlendirme: eval [--fake] [--output rapor.json]');
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
void main().catch(error => {
  const code = error instanceof Error ? error.message : 'UNKNOWN';
  console.error(messages[code] ?? (code === 'SHUTDOWN' ? 'İşlem durduruldu.' : 'İşlem tamamlanamadı. Yapılandırmayı, bağlantıyı ve eşleştirmeyi kontrol edin.'));
  process.exitCode = code === 'SHUTDOWN' ? 0 : 1;
});

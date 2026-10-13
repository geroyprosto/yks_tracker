/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
function validateConfig(value) {
  const keys = ['appUrl', 'model', 'ollamaUrl', 'timeoutMs', 'keepAlive', 'pollMs'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error('NOVA_CONFIG_INVALID');
  let app, ollama;
  try { app = new URL(value.appUrl); ollama = new URL(value.ollamaUrl); } catch { throw new Error('NOVA_CONFIG_INVALID'); }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash || app.pathname !== '/') throw new Error('NOVA_CONFIG_APP_INVALID');
  if (ollama.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(ollama.hostname) || ollama.username || ollama.password || ollama.search || ollama.hash || ollama.pathname !== '/' || (ollama.port && ollama.port !== '11434')) throw new Error('NOVA_CONFIG_LOCAL_ONLY');
  if (typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/u.test(value.model) || /cloud/iu.test(value.model)) throw new Error('NOVA_CONFIG_MODEL_INVALID');
  if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 120000 || !Number.isInteger(value.pollMs) || value.pollMs < 5000 || value.pollMs > 60000) throw new Error('NOVA_CONFIG_TIMING_INVALID');
  if (typeof value.keepAlive !== 'string' || !/^(?:0|[1-9]|[1-9][0-9]?[sm]|[12]h)$/u.test(value.keepAlive)) throw new Error('NOVA_CONFIG_KEEP_ALIVE_INVALID');
  return { appUrl: app.origin, model: value.model, ollamaUrl: ollama.origin, timeoutMs: value.timeoutMs, keepAlive: value.keepAlive, pollMs: value.pollMs };
}
function loadConfig(directory = __dirname) {
  const configured = path.join(directory, 'bridge-config.json');
  const text = fs.readFileSync(fs.existsSync(configured) ? configured : path.join(directory, 'bridge-config.example.json'), 'utf8');
  if (text.length > 4096) throw new Error('NOVA_CONFIG_INVALID');
  return validateConfig(JSON.parse(text.replace(/^\uFEFF/u, '')));
}
module.exports = { validateConfig, loadConfig };
if (require.main === module) {
  try { console.log(JSON.stringify(loadConfig())); }
  catch { console.error('Bridge ayarı geçersiz. bridge-config.json dosyasındaki model, yerel adres ve süreleri kontrol edin; buraya sır yazmayın.'); process.exitCode = 1; }
}

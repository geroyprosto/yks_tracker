import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {parseEnv} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {agentHouseReportSchema, type AgentHouseAgentId, type AgentHouseReport} from '../../src/lib/agent-house';
import {assemble, assertFresh, childEnvironment, digest, inputHash, inputSchema, outputJsonSchema, promptFor, roles, runOrder, sourcesFor, validateResult, type Input, type RoleResult} from './core';

const repo = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name: string) => {const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined;};
const inputPath = option('--input');
const statePath = option('--state');
if (!inputPath || !statePath) throw new Error('Usage: pnpm agents:codex --input <private input.json> --state <private state directory> [--publish]');
const state = resolve(statePath);
mkdirSync(state, {recursive: true});
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as unknown;
function save(path: string, value: unknown) {
  mkdirSync(dirname(path), {recursive: true});
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  renameSync(tmp, path);
}
const lock = join(state, 'running.lock');
try {writeFileSync(lock, JSON.stringify({pid: process.pid, started_at: new Date().toISOString()}), {flag: 'wx', mode: 0o600});}
catch {throw new Error('Başka bir Ajan Evi çalışması var. running.lock sahibinin sonlandığını doğrulamadan kilidi kaldırma.');}

type Receipt = {role: AgentHouseAgentId; model: string; effort: string; prompt_hash: string; completed_at: string; seconds: number; usage: unknown; result: RoleResult};
async function generate(input: Input, role: AgentHouseAgentId, previous: Partial<Record<AgentHouseAgentId, RoleResult>>, directory: string): Promise<RoleResult> {
  const stage = join(directory, role);
  mkdirSync(stage, {recursive: true});
  const prompt = promptFor(input, role, previous);
  const promptHash = digest(prompt);
  const receiptPath = join(stage, 'receipt.json');
  if (existsSync(receiptPath)) {
    const receipt = read(receiptPath) as Receipt;
    if (receipt.prompt_hash === promptHash && receipt.model === roles[role].model) return validateResult(receipt.result, role, sourcesFor(input, role));
  }
  console.log(JSON.stringify({event: 'agent_started', role, ...roles[role], instruction: undefined}));
  save(join(stage, 'schema.json'), outputJsonSchema);
  writeFileSync(join(stage, 'prompt.txt'), prompt, {mode: 0o600});
  const env = childEnvironment(process.env);
  const binary = process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex');
  const cli = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--json',
    '--model', roles[role].model, '-c', `model_reasoning_effort="${roles[role].effort}"`, '-c', 'web_search="disabled"',
    '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'plugins', '--disable', 'multi_agent', '--disable', 'computer_use', '--disable', 'browser_use', '--disable', 'view_image',
    '--cd', stage, '--output-schema', join(stage, 'schema.json'), '--output-last-message', join(stage, 'result.json'), '-'];
  const started = Date.now();
  const child = spawn(binary, cli, {cwd: stage, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let out = '', err = '', timedOut = false;
  const timer = setTimeout(() => {timedOut = true; child.kill();}, 12 * 60_000);
  child.stdout.on('data', chunk => {out += String(chunk);});
  child.stderr.on('data', chunk => {err += String(chunk);});
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  let code: number | null;
  try {code = await new Promise<number | null>((done, fail) => {child.once('error', fail); child.once('close', done);});}
  finally {clearTimeout(timer); writeFileSync(join(stage, 'events.jsonl'), out, {mode: 0o600}); writeFileSync(join(stage, 'stderr.log'), err, {mode: 0o600});}
  if (timedOut || code !== 0) throw new Error(`${role}: Codex tamamlanamadı (${timedOut ? 'zaman aşımı' : code}); özel stderr.log kaydını incele. API veya başka modele otomatik geçilmedi.`);
  const events = out.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as {type?: string; item?: {type?: string}; usage?: unknown});
  if (events.some(e => e.type === 'turn.failed' || e.type === 'error')) throw new Error(`${role}: Codex hata bildirdi`);
  if (events.some(e => e.item?.type && !['reasoning', 'agent_message'].includes(e.item.type))) throw new Error(`${role}: Beklenmeyen araç kullanımı; rapor yayınlanmadı`);
  if (!events.some(e => e.type === 'turn.completed')) throw new Error(`${role}: Tamamlanma kaydı yok`);
  const result = validateResult(read(join(stage, 'result.json')), role, sourcesFor(input, role));
  const receipt: Receipt = {role, model: roles[role].model, effort: roles[role].effort, prompt_hash: promptHash, completed_at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), usage: events.find(e => e.type === 'turn.completed')?.usage ?? null, result};
  save(receiptPath, receipt);
  console.log(JSON.stringify({event: 'agent_completed', role, model: receipt.model, seconds: receipt.seconds}));
  return result;
}

async function publish(report: AgentHouseReport) {
  // Credentials are loaded ONLY in the publisher, after all Codex subprocesses end.
  const env = parseEnv(readFileSync(join(repo, '.env.local'), 'utf8'));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  const email = env.ALLOWED_USER_EMAIL?.trim().toLowerCase();
  if (!url || !key || !email) throw new Error('Yerel yayıncı için Supabase ve sahip hesap yapılandırması eksik');
  const client = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
  let owner: string | undefined;
  for (let page = 1; page <= 100; page++) {
    const {data, error} = await client.auth.admin.listUsers({page, perPage: 100});
    if (error) throw new Error('Yayıncı hesap kimliğini doğrulayamadı');
    owner = data.users.find(u => u.email?.toLowerCase() === email)?.id;
    if (owner || data.users.length < 100) break;
  }
  if (!owner) throw new Error('Yapılandırılan sahip hesap bulunamadı');
  const allowed = await client.rpc('mcp_owner_allowed', {p_user_id: owner});
  if (allowed.error || allowed.data !== true) throw new Error('Sahip hesap izni doğrulanamadı');
  const result = await client.rpc('agent_house_publish_for_owner', {p_user_id: owner, p_report: report});
  if (result.error) throw new Error(`Rapor yayınlanamadı: ${result.error.code}`);
  const saved = agentHouseReportSchema.parse(result.data?.run);
  if (digest(saved) !== digest(report)) throw new Error('Yayınlanan rapor beklenen içerikle uyuşmuyor');
  return {run_id: saved.run_id, created: result.data.created === true, verified_at: new Date().toISOString()};
}

async function main() {
  const input = inputSchema.parse(read(resolve(inputPath!)));
  assertFresh(input);
  const hash = inputHash(input);
  const latestPath = join(state, 'latest.json');
  const latest = existsSync(latestPath) ? read(latestPath) as {input_hash?: string; published?: boolean; run_id?: string} : null;
  if (latest?.input_hash === hash && (!args.includes('--publish') || latest.published)) {
    console.log(JSON.stringify({event: 'unchanged', run_id: latest.run_id})); return;
  }
  const binary = process.env.CODEX_BIN || (process.platform === 'win32' ? 'codex.exe' : 'codex');
  const auth = spawnSync(binary, ['login', 'status'], {env: childEnvironment(process.env), encoding: 'utf8', windowsHide: true, timeout: 30_000});
  if (auth.status !== 0 || !/Logged in using ChatGPT/i.test(`${auth.stdout}\n${auth.stderr}`)) throw new Error('Codex ChatGPT oturumu gerekli; API anahtarıyla çalıştırılmayacak.');
  const directory = join(state, 'runs', hash);
  save(join(directory, 'input.json'), input);
  const reportPath = join(directory, 'report.json');
  let report: AgentHouseReport;
  if (existsSync(reportPath)) report = agentHouseReportSchema.parse(read(reportPath));
  else {
    const results: Partial<Record<AgentHouseAgentId, RoleResult>> = {};
    for (const role of runOrder) results[role] = await generate(input, role, results, directory);
    report = assemble(input, results as Record<AgentHouseAgentId, RoleResult>, hash, new Date().toISOString());
    save(reportPath, report);
  }
  const publication = args.includes('--publish') ? await publish(report) : null;
  save(latestPath, {input_hash: hash, run_id: report.run_id, report_path: reportPath, generated_at: report.generated_at, models: roles, published: Boolean(publication), publication});
  console.log(JSON.stringify({event: publication ? 'published' : 'generated', run_id: report.run_id, report_path: reportPath, publication}));
}

main().catch(error => {console.error(error instanceof Error ? error.message : 'Ajan Evi çalışması başarısız.'); process.exitCode = 1;}).finally(() => rmSync(lock));

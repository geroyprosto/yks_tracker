import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inputSchema, type Input, type Source} from './core';

export function mergeMemory(previous: Input, incoming: Input, removed: string[] = []): Input {
  const sources = new Map(previous.sources.map(source => [source.id, source]));
  for (const source of incoming.sources) {
    const old = sources.get(source.id);
    let next: Source = source;
    if (old?.kind === 'chatgpt' && source.kind === 'chatgpt') {
      // read_thread is paginated. Preserve older reviewed turns during incremental sync.
      const before: unknown = JSON.parse(old.content), after: unknown = JSON.parse(source.content);
      if (!Array.isArray(before) || !Array.isArray(after)) throw new Error('ChatGPT hafızası ayrı kimlikli turn dizisi olmalı');
      const turns = new Map<string, unknown>();
      for (const turn of [...before, ...after]) {
        if (!turn || typeof turn !== 'object' || typeof turn.id !== 'string') throw new Error('ChatGPT turn kimliği gerekli');
        turns.set(turn.id, turn);
      }
      next = {...source, content: JSON.stringify([...turns.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, turn]) => turn))};
    }
    sources.set(source.id, next);
  }
  for (const id of removed) sources.delete(id);
  return inputSchema.parse({...incoming, sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id))});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const incomingFile = args[args.indexOf('--incoming') + 1];
  const memoryFile = args[args.indexOf('--memory') + 1];
  if (!args.includes('--incoming') || !args.includes('--memory') || !incomingFile || !memoryFile) throw new Error('Usage: agents:sync --incoming <batch.json> --memory <input.json>');
  const batch = JSON.parse(readFileSync(resolve(incomingFile), 'utf8')) as {removed_source_ids?: string[]};
  const {removed_source_ids = [], ...value} = batch;
  if (!Array.isArray(removed_source_ids) || removed_source_ids.some(id => typeof id !== 'string')) throw new Error('Silinecek kaynak kimlikleri geçersiz');
  const incoming = inputSchema.parse(value);
  let previous = incoming;
  try {previous = inputSchema.parse(JSON.parse(readFileSync(resolve(memoryFile), 'utf8')));}
  catch (error) {if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;}
  const merged = mergeMemory(previous, incoming, removed_source_ids);
  mkdirSync(dirname(resolve(memoryFile)), {recursive: true});
  const tmp = `${resolve(memoryFile)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', {mode: 0o600});
  renameSync(tmp, resolve(memoryFile));
  console.log(JSON.stringify({event: 'memory_updated', source_count: merged.sources.length, as_of: merged.as_of}));
}

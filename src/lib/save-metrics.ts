type VisibilitySource = 'optimistic' | 'authoritative';
type ConfirmationSource = 'receipt' | 'state_check';
type Failure = 'http_error' | 'request_error' | 'invalid_response' | 'state_check_failed';
type SaveMetric = {
  command_type: string;
  outcome: 'pending' | 'confirmed' | 'failed';
  visible_ms: number | null;
  visible_source: VisibilitySource | null;
  confirmed_ms: number | null;
  confirmation_source: ConfirmationSource | null;
  failed_ms: number | null;
  failure: Failure | null;
  http_status: number | null;
  server_timing: Record<string, number>;
  refresh_ms: number | null;
  refresh_outcome: 'applied' | 'not_applied' | null;
};

export type SaveMeasurement = {
  visible(source: VisibilitySource): void;
  response(status: number, serverTiming: string | null): void;
  confirmed(source?: ConfirmationSource, at?: number): void;
  failed(reason: Failure, at?: number): void;
  refresh(): (applied: boolean) => void;
};

const operationNames = new Set([
  'task.create', 'task.update', 'task.move', 'task.delete', 'topic.create', 'topic.update',
  'practice.create', 'practice.update', 'practice.delete', 'exam.create', 'exam.update', 'exam.delete',
  'journal.create', 'journal.update', 'journal.delete', 'day.mark', 'day.unmark',
  'settings.update', 'settings.journal_analysis.set', 'plan.update', 'manual_study.create',
  'timer.start', 'timer.pause', 'timer.resume', 'timer.finish',
  'education.draft.save', 'education.draft.discard', 'education.profile.save',
  'education.course.create', 'education.course.update', 'education.term.activate',
  'education.results.batch', 'education.result.update',
]);

function serverDurations(header: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const stage of header?.split(',') ?? []) {
    const name = stage.split(';')[0].trim();
    // Header descriptions and arbitrary names can contain private data.
    if (!['auth_db', 'command', 'app'].includes(name)) continue;
    const duration = stage.match(/;\s*dur\s*=\s*(\d+(?:\.\d+)?)\s*(?:;|$)/)?.[1];
    if (duration !== undefined && Number.isFinite(Number(duration))) result[name] = Number(duration);
  }
  return result;
}

/** In-memory diagnostics only: no payloads, record identities, storage or network. */
export function createSaveMetrics(now: () => number = () => performance.now()) {
  const records: SaveMetric[] = [];
  const elapsed = (start: number, at = now()) => Math.round(Math.max(0, at - start) * 10) / 10;
  return {
    serialize: () => JSON.stringify(records),
    start(type: string, startedAt = now()): SaveMeasurement {
      const record: SaveMetric = {
        command_type: operationNames.has(type) ? type : 'unknown', outcome: 'pending',
        visible_ms: null, visible_source: null, confirmed_ms: null, confirmation_source: null,
        failed_ms: null, failure: null, http_status: null, server_timing: {},
        refresh_ms: null, refresh_outcome: null,
      };
      records.push(record);
      if (records.length > 10) records.shift();
      return {
        visible(source) {
          if (record.visible_ms !== null) return;
          record.visible_ms = elapsed(startedAt);
          record.visible_source = source;
        },
        response(status, serverTiming) {
          record.http_status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
          record.server_timing = serverDurations(serverTiming);
        },
        confirmed(source = 'receipt', at = now()) {
          if (record.confirmed_ms !== null) return;
          record.confirmed_ms = elapsed(startedAt, at);
          record.confirmation_source = source;
          record.outcome = 'confirmed';
        },
        failed(reason, at = now()) {
          if (record.failed_ms !== null) return;
          record.failed_ms = elapsed(startedAt, at);
          record.failure = reason;
          record.outcome = 'failed';
        },
        refresh() {
          const started = now();
          return applied => {
            record.refresh_ms = elapsed(started);
            record.refresh_outcome = applied ? 'applied' : 'not_applied';
          };
        },
      };
    },
  };
}

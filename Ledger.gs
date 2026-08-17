/**
 * Append-only ledger.
 *
 * The ledger is the memory of the job. Nothing is ever updated in place: a
 * later row supersedes an earlier one. That keeps the history auditable and
 * makes concurrent writes harmless, because two appends never fight over a
 * cell.
 *
 * Two sheets:
 *   ledger — one row per operation transition (planned / committed / skipped / failed)
 *   runs   — one row per execution, for the watchdog's timing checks
 */

const LEDGER_SHEET = 'ledger';
const RUNS_SHEET = 'runs';

const LEDGER_HEADER = [
  'ts', 'run_id', 'op_key', 'phase', 'source_id',
  'source_name', 'target_path', 'actor', 'reason', 'detail'
];

const RUNS_HEADER = [
  'run_id', 'started_at', 'finished_at', 'mode',
  'planned', 'committed', 'skipped', 'failed', 'duration_ms'
];

function sheet_(cfg, name, header) {
  const ss = SpreadsheetApp.openById(cfg.LEDGER_SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function ledgerAppend_(cfg, row) {
  const sh = sheet_(cfg, LEDGER_SHEET, LEDGER_HEADER);
  withRetry_('ledger.append', () => sh.appendRow([
    new Date(),
    row.runId,
    row.opKey,
    row.phase,
    row.sourceId || '',
    row.sourceName || '',
    row.targetPath || '',
    row.actor || 'consolidator',
    row.reason || '',
    row.detail || ''
  ]));
}

function ledgerRows_(cfg) {
  const sh = sheet_(cfg, LEDGER_SHEET, LEDGER_HEADER);
  const values = sh.getDataRange().getValues();
  const header = values.shift() || [];
  return {
    header: header,
    rows: values.map(v => {
      const o = {};
      header.forEach((h, i) => { o[h] = v[i]; });
      return o;
    })
  };
}

/**
 * Current state of every operation key: the phase of its most recent row.
 * Reading the whole ledger once per run is cheaper than one lookup per file,
 * and it is the only read that has to be consistent.
 */
function ledgerState_(cfg) {
  const state = {};
  ledgerRows_(cfg).rows.forEach(r => {
    if (!r.op_key) return;
    state[r.op_key] = { phase: r.phase, ts: r.ts, row: r };
  });
  return state;
}

function runsAppend_(cfg, run) {
  const sh = sheet_(cfg, RUNS_SHEET, RUNS_HEADER);
  withRetry_('runs.append', () => sh.appendRow([
    run.runId,
    run.startedAt,
    run.finishedAt,
    run.mode,
    run.planned,
    run.committed,
    run.skipped,
    run.failed,
    run.finishedAt - run.startedAt
  ]));
}

function lastRun_(cfg) {
  const sh = sheet_(cfg, RUNS_SHEET, RUNS_HEADER);
  const n = sh.getLastRow();
  if (n < 2) return null;
  const v = sh.getRange(n, 1, 1, RUNS_HEADER.length).getValues()[0];
  const o = {};
  RUNS_HEADER.forEach((h, i) => { o[h] = v[i]; });
  return o;
}

/** Run ids are sortable and readable: 2026-08-16T21:05:12Z-4f2a. */
function newRunId_() {
  const iso = Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  return iso + '-' + Utilities.getUuid().slice(0, 4);
}

/**
 * Integrity watchdog.
 *
 * The consolidator checks its own work. The watchdog checks that the
 * consolidator is still there and still telling the truth — which is a
 * different job, and the reason it runs on its own trigger.
 *
 * Every check returns { ok, detail }. A check that cannot run (missing
 * config, unreachable folder) fails; it never returns ok on the grounds that
 * it had nothing to look at. A silent monitor is worse than none.
 */

const STALE_PLANNED_HOURS = 6;
const ORPHAN_STAGING_DAYS = 7;
const RUN_WINDOW_HOURS = 26;   // daily trigger + two hours of slack
const FAILURE_WINDOW_HOURS = 24;

const CHECKS = [
  {
    id: 'config_complete',
    run: cfg => ({
      ok: cfg.missing.length === 0,
      detail: cfg.missing.length ? 'missing: ' + cfg.missing.join(', ') : 'all required properties set'
    })
  },
  {
    id: 'staging_reachable',
    run: cfg => {
      const f = DriveApp.getFolderById(cfg.STAGING_FOLDER_ID);
      return { ok: true, detail: 'staging: ' + f.getName() };
    }
  },
  {
    id: 'archive_root_reachable',
    run: cfg => {
      const f = DriveApp.getFolderById(cfg.ARCHIVE_ROOT_ID);
      return { ok: true, detail: 'archive: ' + f.getName() };
    }
  },
  {
    id: 'ledger_reachable',
    run: cfg => {
      const name = SpreadsheetApp.openById(cfg.LEDGER_SPREADSHEET_ID).getName();
      return { ok: true, detail: 'ledger: ' + name };
    }
  },
  {
    id: 'ledger_schema_intact',
    run: cfg => {
      const header = ledgerRows_(cfg).header.join(',');
      const expected = LEDGER_HEADER.join(',');
      return {
        ok: header === expected,
        detail: header === expected ? 'header matches' : 'header drifted: ' + header
      };
    }
  },
  {
    id: 'no_stale_planned',
    run: cfg => {
      const cutoff = Date.now() - STALE_PLANNED_HOURS * 3600e3;
      const state = ledgerState_(cfg);
      const stale = Object.keys(state).filter(k =>
        state[k].phase === 'planned' && new Date(state[k].ts).getTime() < cutoff);
      return {
        ok: stale.length === 0,
        detail: stale.length ? stale.length + ' operations planned but never committed' : 'no open plans'
      };
    }
  },
  {
    id: 'no_duplicate_commits',
    run: cfg => {
      const seen = {};
      const dupes = [];
      ledgerRows_(cfg).rows.forEach(r => {
        if (r.phase !== 'committed') return;
        if (seen[r.op_key]) dupes.push(r.op_key); else seen[r.op_key] = true;
      });
      return {
        ok: dupes.length === 0,
        detail: dupes.length ? dupes.length + ' keys committed more than once' : 'commits are unique'
      };
    }
  },
  {
    id: 'no_orphan_staging_files',
    run: cfg => {
      const cutoff = Date.now() - ORPHAN_STAGING_DAYS * 86400e3;
      const it = DriveApp.getFolderById(cfg.STAGING_FOLDER_ID).getFiles();
      let n = 0;
      while (it.hasNext()) {
        const f = it.next();
        if (!cfg.ignore.test(f.getName()) && f.getDateCreated().getTime() < cutoff) n++;
      }
      return {
        ok: n === 0,
        detail: n ? n + ' files sitting in staging for over ' + ORPHAN_STAGING_DAYS + ' days' : 'staging is current'
      };
    }
  },
  {
    id: 'no_recent_failures',
    run: cfg => {
      const cutoff = Date.now() - FAILURE_WINDOW_HOURS * 3600e3;
      const recent = ledgerRows_(cfg).rows.filter(r =>
        r.phase === 'failed' && new Date(r.ts).getTime() >= cutoff);
      return {
        ok: recent.length === 0,
        detail: recent.length
          ? recent.length + ' failures in ' + FAILURE_WINDOW_HOURS + 'h (last: ' + recent[recent.length - 1].reason + ')'
          : 'no failures in window'
      };
    }
  },
  {
    id: 'last_run_within_window',
    run: cfg => {
      const run = lastRun_(cfg);
      if (!run) return { ok: false, detail: 'no run has ever been recorded' };
      const age = (Date.now() - new Date(run.finished_at).getTime()) / 3600e3;
      return {
        ok: age <= RUN_WINDOW_HOURS,
        detail: 'last run ' + age.toFixed(1) + 'h ago (' + run.run_id + ')'
      };
    }
  },
  {
    id: 'run_duration_within_budget',
    run: cfg => {
      const run = lastRun_(cfg);
      if (!run) return { ok: false, detail: 'no run has ever been recorded' };
      const seconds = Number(run.duration_ms) / 1000;
      return {
        ok: seconds <= cfg.maxRunSeconds,
        detail: 'last run took ' + seconds.toFixed(1) + 's of ' + cfg.maxRunSeconds + 's budget'
      };
    }
  },
  {
    id: 'triggers_installed',
    run: () => {
      const handlers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
      const missing = ['runConsolidation', 'runWatchdog'].filter(h => handlers.indexOf(h) === -1);
      return {
        ok: missing.length === 0,
        detail: missing.length ? 'no trigger for: ' + missing.join(', ') : 'both triggers installed'
      };
    }
  }
];

function runChecks_(cfg) {
  return CHECKS.map(check => {
    try {
      const r = check.run(cfg);
      return { id: check.id, ok: !!r.ok, detail: r.detail };
    } catch (err) {
      return { id: check.id, ok: false, detail: String(err).slice(0, 200) };
    }
  });
}

function formatReport_(results) {
  const failed = results.filter(r => !r.ok);
  const head = failed.length
    ? '⚠️ ' + failed.length + '/' + results.length + ' checks failing'
    : '✅ ' + results.length + '/' + results.length + ' checks passing';
  const body = failed.map(r => '• ' + r.id + ': ' + r.detail).join('\n');
  return failed.length ? head + '\n' + body : head;
}

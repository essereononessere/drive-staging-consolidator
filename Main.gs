/**
 * Entry points. These are the only functions meant to be called by hand or by
 * a trigger; everything else is internal (trailing underscore).
 *
 *   runConsolidation()  plan + commit, honouring DRY_RUN
 *   runWatchdog()       integrity checks + alert on state change
 *   installTriggers()   daily consolidation, watchdog every 6 hours
 *   removeTriggers()    undo the above
 */

function runConsolidation() {
  const cfg = getConfig();
  if (cfg.missing.length) {
    throw new Error('preflight failed, missing script properties: ' + cfg.missing.join(', '));
  }

  // One execution at a time. Two overlapping runs would both read the ledger
  // before either wrote to it, and plan the same file twice.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    log_('WARN', 'another execution holds the lock, skipping this run');
    return;
  }

  const runId = newRunId_();
  const startedAt = new Date();

  try {
    const planned = planRun_(cfg, runId);
    const committed = commitRun_(cfg, runId);

    const run = {
      runId: runId,
      startedAt: startedAt,
      finishedAt: new Date(),
      mode: cfg.dryRun ? 'dry-run' : 'live',
      planned: planned.planned,
      committed: committed.committed,
      skipped: planned.skipped,
      failed: committed.failed
    };
    runsAppend_(cfg, run);

    log_('INFO', [
      runId, run.mode,
      'planned=' + run.planned,
      'committed=' + run.committed,
      'skipped=' + run.skipped,
      'failed=' + run.failed
    ].join(' '));

    if (run.failed > 0) {
      notify_(cfg, '⚠️ ' + run.failed + ' operation(s) failed in run ' + runId);
    }
  } finally {
    lock.releaseLock();
  }
}

function runWatchdog() {
  const cfg = getConfig();
  const results = runChecks_(cfg);
  log_('INFO', formatReport_(results));
  notifyStateChange_(cfg, results);
  return results;
}

/** Convenience: run every check and print the report without alerting. */
function checkNow() {
  const results = runChecks_(getConfig());
  results.forEach(r => log_(r.ok ? 'OK' : 'FAIL', r.id + ' — ' + r.detail));
  return results;
}

function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('runConsolidation').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('runWatchdog').timeBased().everyHours(6).create();
  log_('INFO', 'triggers installed');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['runConsolidation', 'runWatchdog'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

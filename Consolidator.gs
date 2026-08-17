/**
 * Two-phase consolidation: plan, then commit.
 *
 * Phase 1 (plan) reads the staging folder and writes one `planned` row per
 * file. It moves nothing. Phase 2 (commit) reads the open `planned` rows —
 * including those left behind by a previous run that died mid-way — performs
 * the move, verifies the result at the source, and appends `committed`.
 *
 * The split exists because Apps Script executions are killed at six minutes
 * with no warning and no rollback. A single-phase job that dies halfway leaves
 * a state nobody can reconstruct. With the plan on disk, the next run resumes
 * instead of guessing.
 *
 * The job never deletes and never overwrites. Ambiguity is recorded and
 * surfaced by the watchdog; a human decides.
 */

function planRun_(cfg, runId) {
  const staging = DriveApp.getFolderById(cfg.STAGING_FOLDER_ID);
  const state = ledgerState_(cfg);
  const counters = { planned: 0, skipped: 0 };

  const it = staging.getFiles();
  while (it.hasNext() && counters.planned < cfg.batchLimit) {
    const file = it.next();
    const name = file.getName();

    if (cfg.ignore.test(name)) {
      continue;
    }

    const opKey = contentKey(file, cfg.hashMaxBytes);
    const current = state[opKey];

    if (current && current.phase === 'committed') {
      // Same content already archived under some name. Left in staging on
      // purpose: deleting a user's file to tidy up is not this job's call.
      ledgerAppend_(cfg, {
        runId: runId, opKey: opKey, phase: 'skipped',
        sourceId: file.getId(), sourceName: name,
        reason: 'duplicate-of-archived',
        detail: 'archived at ' + current.row.target_path
      });
      counters.skipped++;
      continue;
    }

    if (current && current.phase === 'planned') {
      continue; // already queued by an earlier run; commit will pick it up
    }

    const segments = periodPath(file.getDateCreated());
    ledgerAppend_(cfg, {
      runId: runId, opKey: opKey, phase: 'planned',
      sourceId: file.getId(), sourceName: name,
      targetPath: segments.join('/') + '/' + name,
      reason: 'staged file eligible for archive',
      detail: 'size=' + file.getSize()
    });
    counters.planned++;
  }

  return counters;
}

function commitRun_(cfg, runId) {
  const state = ledgerState_(cfg);
  const counters = { committed: 0, failed: 0 };
  const deadline = Date.now() + cfg.maxRunSeconds * 1000;

  Object.keys(state).forEach(opKey => {
    if (state[opKey].phase !== 'planned') return;
    if (Date.now() > deadline) return; // stop cleanly; the rest resumes next run
    if (counters.committed >= cfg.batchLimit) return;

    const row = state[opKey].row;

    if (cfg.dryRun) {
      log_('DRY', 'would move ' + row.source_name + ' -> ' + row.target_path);
      return;
    }

    try {
      const file = DriveApp.getFileById(row.source_id);
      const sizeBefore = file.getSize();
      const target = folderPath(
        cfg.ARCHIVE_ROOT_ID, String(row.target_path).split('/').slice(0, -1), true);

      if (target.getFilesByName(file.getName()).hasNext()) {
        // Same name, different content: renaming silently would hide the
        // collision. Record it and let a human look.
        ledgerAppend_(cfg, {
          runId: runId, opKey: opKey, phase: 'failed',
          sourceId: row.source_id, sourceName: row.source_name,
          targetPath: row.target_path, reason: 'name-collision',
          detail: 'a different file with this name already exists in the target'
        });
        counters.failed++;
        return;
      }

      withRetry_('drive.move', () => file.moveTo(target));

      // Verify at the source before calling it done. Drive is eventually
      // consistent enough that a successful call is not proof of a result.
      const check = DriveApp.getFileById(row.source_id);
      const parents = check.getParents();
      const parentId = parents.hasNext() ? parents.next().getId() : null;
      if (parentId !== target.getId() || check.getSize() !== sizeBefore) {
        throw new Error('post-move verification failed');
      }

      ledgerAppend_(cfg, {
        runId: runId, opKey: opKey, phase: 'committed',
        sourceId: row.source_id, sourceName: row.source_name,
        targetPath: row.target_path, reason: 'archived',
        detail: 'verified parent=' + parentId + ' size=' + check.getSize()
      });
      counters.committed++;

    } catch (err) {
      ledgerAppend_(cfg, {
        runId: runId, opKey: opKey, phase: 'failed',
        sourceId: row.source_id, sourceName: row.source_name,
        targetPath: row.target_path, reason: 'error',
        detail: String(err).slice(0, 400)
      });
      counters.failed++;
    }
  });

  return counters;
}

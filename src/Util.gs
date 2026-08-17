/** Helpers. Pure, except withRetry_ which sleeps. */

/**
 * Identity of a file by content, not by name. Two uploads of the same document
 * under different names collapse to one key and the second is skipped.
 *
 * Files above HASH_MAX_BYTES cannot be read into memory, so they fall back to
 * name + size + timestamp. That key is weaker: two genuinely different files
 * sharing all three would collide. The limitation is documented rather than
 * hidden, and the check `checksum.match` only applies to md5 keys.
 */
function contentKey(file, hashMaxBytes) {
  const size = file.getSize();
  if (size <= hashMaxBytes) {
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5, file.getBlob().getBytes());
    return 'md5:' + digest
      .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  }
  return ['meta', file.getName(), size, file.getLastUpdated().getTime()].join(':');
}

/** Archive layout: ARCHIVE_ROOT / YYYY / MM. */
function periodPath(date) {
  const tz = Session.getScriptTimeZone();
  return [
    Utilities.formatDate(date, tz, 'yyyy'),
    Utilities.formatDate(date, tz, 'MM')
  ];
}

/** Resolve (or create) a nested folder path under a root id. */
function folderPath(rootId, segments, create) {
  let folder = DriveApp.getFolderById(rootId);
  segments.forEach(name => {
    const it = folder.getFoldersByName(name);
    if (it.hasNext()) {
      folder = it.next();
    } else if (create) {
      folder = folder.createFolder(name);
    } else {
      throw new Error('missing folder: ' + segments.join('/'));
    }
  });
  return folder;
}

/** Drive and UrlFetch fail transiently. Exponential backoff with jitter. */
function withRetry_(label, fn, attempts) {
  const max = attempts || 3;
  let last;
  for (let i = 0; i < max; i++) {
    try {
      return fn();
    } catch (err) {
      last = err;
      Utilities.sleep(Math.pow(2, i) * 500 + Math.floor(Math.random() * 300));
    }
  }
  throw new Error(label + ' failed after ' + max + ' attempts: ' + last);
}

function log_(level, message) {
  console.log('[' + level + '] ' + message);
}

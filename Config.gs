/**
 * Configuration.
 *
 * Nothing sensitive lives in the repository. Every value is read from Script
 * Properties (Project settings -> Script properties) once per run. Missing
 * required values fail the preflight check, before anything is written.
 */

const REQUIRED_PROPS = [
  'STAGING_FOLDER_ID',     // folder the job watches
  'ARCHIVE_ROOT_ID',       // root of the YYYY/MM archive tree
  'LEDGER_SPREADSHEET_ID'  // spreadsheet holding the `ledger` and `runs` sheets
];

const DEFAULTS = {
  DRY_RUN: 'true',              // safe by default: plan and verify, move nothing
  MAX_RUN_SECONDS: '240',       // budget check; Apps Script hard limit is 360
  HASH_MAX_BYTES: '20971520',   // 20 MB. Above this we fall back to a weaker key
  BATCH_LIMIT: '50',            // files per run, keeps us inside the quota
  IGNORE_REGEX: '^(~\\$|\\.)',  // Office lock files and dotfiles
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: ''
};

function getConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const cfg = Object.assign({}, DEFAULTS, props);

  cfg.missing = REQUIRED_PROPS.filter(k => !cfg[k]);

  // Anything other than the literal string "false" keeps the job in dry run.
  // The default has to be the harmless one: a typo must not start moving files.
  cfg.dryRun = String(cfg.DRY_RUN).toLowerCase() !== 'false';

  cfg.maxRunSeconds = Number(cfg.MAX_RUN_SECONDS);
  cfg.hashMaxBytes = Number(cfg.HASH_MAX_BYTES);
  cfg.batchLimit = Number(cfg.BATCH_LIMIT);
  cfg.ignore = new RegExp(cfg.IGNORE_REGEX);
  cfg.alerting = Boolean(cfg.TELEGRAM_BOT_TOKEN && cfg.TELEGRAM_CHAT_ID);

  return cfg;
}

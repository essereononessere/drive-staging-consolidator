/**
 * Alerting.
 *
 * One rule: an alert that repeats every hour stops being read by day two, and
 * from then on the monitor is decorative. So the same failing state is sent
 * once, then held for REPEAT_AFTER_HOURS. Recovery is always sent — knowing a
 * problem cleared is worth as much as knowing it started.
 *
 * Credentials live in Script Properties, never in the repository. With no
 * credentials configured the job still runs and still logs; it just cannot
 * reach anyone, and `alerting_configured` is not treated as a passing state.
 */

const REPEAT_AFTER_HOURS = 12;
const ALERT_STATE_KEY = 'WATCHDOG_LAST_ALERT';

function notify_(cfg, text) {
  if (!cfg.alerting) {
    log_('WARN', 'alerting not configured, message dropped: ' + text);
    return false;
  }
  const url = 'https://api.telegram.org/bot' + cfg.TELEGRAM_BOT_TOKEN + '/sendMessage';
  withRetry_('telegram.send', () => {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: cfg.TELEGRAM_CHAT_ID, text: text })
    });
    if (res.getResponseCode() >= 300) {
      throw new Error('HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    }
  });
  return true;
}

/** Send only on change, on recovery, or after the hold expires. */
function notifyStateChange_(cfg, results) {
  const failing = results.filter(r => !r.ok).map(r => r.id).sort().join('|');
  const props = PropertiesService.getScriptProperties();
  const previous = JSON.parse(props.getProperty(ALERT_STATE_KEY) || '{}');

  const changed = previous.failing !== failing;
  const expired = previous.ts
    ? (Date.now() - previous.ts) > REPEAT_AFTER_HOURS * 3600e3
    : true;

  if (!failing && !previous.failing) return false;          // still healthy, stay quiet
  if (!changed && !expired) return false;                   // same problem, already reported

  const text = failing
    ? formatReport_(results)
    : '✅ recovered — all ' + results.length + ' checks passing again';

  const sent = notify_(cfg, text);
  props.setProperty(ALERT_STATE_KEY, JSON.stringify({ failing: failing, ts: Date.now() }));
  return sent;
}

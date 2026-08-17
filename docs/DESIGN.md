# Design notes

Why the job is shaped the way it is. Each section states the failure first,
because the failure is what justifies the code.

---

## 1. Identity by content, not by name

**The failure.** Someone re-uploads `invoice.pdf` as `invoice_final.pdf`. A
name-based job archives it a second time. Six months later the archive has
three copies of the same document under three names, and nobody can tell which
is authoritative.

**What the job does.** An operation key is the MD5 of the file contents
(`Util.gs → contentKey`). The key, not the name, is what the ledger stores and
what the next run looks up. A re-upload under any name resolves to a key that
is already `committed`, and is skipped.

**What it costs.** Hashing means reading the file into memory, which caps at
about 50 MB in Apps Script. Above `HASH_MAX_BYTES` the key degrades to
name + size + timestamp — weaker, and documented as such in the README rather
than hidden in a comment.

---

## 2. Two-phase write

**The failure.** Apps Script kills executions at six minutes. There is no
warning, no rollback, no `finally` you can rely on. A single-phase job that
dies after moving 30 of 80 files leaves a state that cannot be reconstructed:
you cannot tell, later, whether file 31 was moved and the log lost, or never
moved at all.

**What the job does.** Phase one (`planRun_`) writes one `planned` row per
eligible file and moves nothing. Phase two (`commitRun_`) reads open plans —
including plans left by earlier runs — performs the move, and writes
`committed`.

The consequence is that a killed execution is not a problem to diagnose. The
next run reads the same open plans and continues. `commitRun_` also stops
voluntarily at `MAX_RUN_SECONDS`, below the platform limit, so the common case
is a clean stop rather than a kill.

---

## 3. Verify at the source

**The failure.** `file.moveTo(folder)` returns without throwing. That is
evidence the request was accepted, not that the file is where you think it is.
Treating the two as equivalent is how a job reports success for a week while
quietly doing nothing.

**What the job does.** After every move it re-reads the file by id, checks that
its parent is the intended folder and that the size is unchanged, and only then
appends `committed`. If verification fails, the row is `failed` with the reason
attached — the plan stays open and the next run retries it.

The same principle governs the watchdog: a check that cannot run returns
`ok: false`. It never passes on the grounds that it had nothing to look at.

---

## 4. Append-only ledger

**The failure.** State kept in a cell that gets updated is state you cannot
audit. When something looks wrong, the one question worth answering — *what did
it do, and when did it start doing that?* — has no answer left in the system.

**What the job does.** Nothing is ever updated in place. Each transition is a
new row with timestamp, run id, operation key, phase, actor and reason; the
current state of a key is the phase of its most recent row (`ledgerState_`).
History is therefore complete by construction, and two concurrent appends
cannot corrupt each other the way two concurrent updates can.

`LockService` still guards the run itself, for a different reason: two
overlapping executions would each read the ledger before either wrote to it,
and both would plan the same file.

---

## 5. Alerting on state change

**The failure.** A monitor that sends the same message every hour is muted by
the second week, and from then on the system is unmonitored while appearing to
be monitored. That is worse than no monitor, because it also buys false
confidence.

**What the job does.** The watchdog compares the *set of currently failing
checks* against the last set it reported. It sends when that set changes, when
the state has been held longer than `REPEAT_AFTER_HOURS`, or on recovery.
Steady-state health is silent.

Recovery is always announced. Knowing a problem cleared is worth as much as
knowing it started, and a monitor that only ever brings bad news gets muted for
that reason alone.

---

## 6. What the job refuses to decide

Same filename, different content, in the target folder. The tempting move is to
rename to `file (2).pdf` and continue. The job records a `name-collision`
failure instead and stops on that file.

Rationale: an automated system should not resolve a genuine ambiguity about
someone else's documents on its own initiative. Automatic renaming makes the
run look clean and moves the confusion into the archive, where it will surface
later without context. A failed row surfaces it now, with the source id, the
target path and the reason.

For the same reason the job never deletes. A duplicate is left in staging with
a `skipped` row explaining why; the orphan check flags it after seven days.

---

## 7. Failure modes, and which are accepted

| Failure | Handling |
|---|---|
| Execution killed mid-commit | Open plans resume on the next run |
| Drive transient 5xx | `withRetry_`, exponential backoff with jitter |
| Two overlapping executions | `LockService`, second run skips |
| Missing configuration | Preflight throws before any write |
| Target name collision | Recorded as `failed`, human decides |
| Ledger header edited by hand | `ledger_schema_intact` fails, alert fires |
| Trigger deleted | `triggers_installed` fails, alert fires |
| Telegram unreachable | Retried, then logged; the job keeps running |
| Backlog larger than `BATCH_LIMIT` | Drains over several runs, by design |
| Ledger grown past spreadsheet limits | **Not handled.** Accepted limitation |

The last row matters as much as the others. A job that claims to handle
everything has usually only failed to look.

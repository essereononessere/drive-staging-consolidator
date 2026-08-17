# drive-staging-consolidator

A small Google Apps Script job that files documents dropped into a Drive
staging folder into a dated archive — and keeps proving, on its own schedule,
that it is still doing so.

The interesting part is not the filing. It is what has to be true for an
unattended job to still be trustworthy on day 40, when a file has been renamed,
an execution was killed mid-way, and nobody has looked at it since day 1.

*[Leer en español](README.es.md)*

## What it does

- Watches one **staging** folder in Google Drive.
- Files each document into `ARCHIVE_ROOT/YYYY/MM/`, based on creation date.
- Recognises content it has already archived, whatever the file is called now,
  and skips it instead of making a second copy.
- Records every decision in an **append-only ledger** (a Google Sheet): what
  was done, when, to which file, and why.
- Runs a **watchdog** with **12 integrity checks** on its own trigger, and
  sends a Telegram alert when the answers change.

About 670 lines of Apps Script. No dependencies, no build step, no server.

## Why it is built this way

Four decisions carry the whole thing. Each is written up in
**[docs/DESIGN.md](docs/DESIGN.md)**, with the failure it prevents.

| Decision | The failure it prevents |
|---|---|
| Identity by content hash, not filename | The same document, renamed, archived twice |
| Two-phase write: plan, then commit | A six-minute timeout leaving a state nobody can reconstruct |
| Verify at the source after writing | A successful API call mistaken for a completed result |
| Alert on state change, not on schedule | A daily alert nobody reads by the second week |

It also never deletes and never overwrites. Where the right answer is
ambiguous — same name, different content — it records the collision and stops.
A human decides.

## Setup

1. Create an Apps Script project and copy in the contents of `src/`.
   (Or use [clasp](https://github.com/google/clasp): copy
   `.clasp.json.example` to `.clasp.json`, add your script id, `clasp push`.)
2. Create three things in Drive: a staging folder, an archive root folder, and
   an empty spreadsheet for the ledger.
3. In **Project settings → Script properties**, set:

   | Property | Required | Meaning |
   |---|---|---|
   | `STAGING_FOLDER_ID` | yes | folder the job watches |
   | `ARCHIVE_ROOT_ID` | yes | root of the `YYYY/MM` archive tree |
   | `LEDGER_SPREADSHEET_ID` | yes | spreadsheet for the `ledger` and `runs` sheets |
   | `TELEGRAM_BOT_TOKEN` | no | leave empty and alerts are logged only |
   | `TELEGRAM_CHAT_ID` | no | destination for alerts |
   | `DRY_RUN` | no | `true` by default; only the literal `false` enables moves |

4. Run `checkNow()` and read the log. Every check should pass before anything
   is allowed to move files.
5. Run `runConsolidation()` while `DRY_RUN` is still `true`: the ledger fills
   with the plan, the log shows what *would* move, Drive is untouched.
6. Set `DRY_RUN` to `false`, then `installTriggers()` — daily consolidation at
   03:00, watchdog every six hours.

No credentials are stored in the repository. `.clasp.json` is gitignored.

## Known limitations

Stated rather than discovered later:

- Files above `HASH_MAX_BYTES` (20 MB default) cannot be read into memory, so
  their identity falls back to name + size + timestamp. That key is weaker and
  two genuinely different files could collide.
- One staging folder, non-recursive. Subfolders are ignored.
- The ledger is a spreadsheet. Fine for thousands of rows, not for millions.
- The archive layout uses file creation date. Documents that describe a period
  other than the one they were uploaded in will be filed by upload date.
- `BATCH_LIMIT` caps files per run to stay inside quota; a large backlog drains
  over several runs by design.

## Licence

MIT — see [LICENSE](LICENSE).

# Changelog

## 0.1.0

Initial release.

- Portable session directory names: home prefix → `HOME`, other roots → `ROOT`,
  remainder URL-encoded.
- Configurable via `extensions/pi-portable-sessions/config.json`
  (`homeLabel`, `rootLabel`, `extraPrefixes`, `notifyOnStart`), with
  project-level overrides under `.pi/extensions/pi-portable-sessions/config.json`.
- The session root directory is resolved from Pi itself
  (`PI_CODING_AGENT_SESSION_DIR`, then `sessionDir` in `settings.json`, then the
  default `<agentDir>/sessions`) — no separate configuration needed.
- `/portable-sessions status` command to inspect the portable name and
  directories.
- `/portable-sessions migrate` command to rename session directories to their
  portable names with a symlink bridge. Accepts `--all`, `--dry-run`, and
  `--yes`, or one or more positional `<name>` targets (default directory names,
  portable names, or absolute working directories) to migrate specific sessions.
- Confirmation dialog showing the current and portable directory names before
  migration; session operations and user input are blocked while a migration
  runs.
- When the portable directory already holds a same-named session file, the two
  files are merged with Pi's default model via a nested `pi -p --no-session`
  run; the merge session is isolated in a temporary directory that is deleted
  afterwards.
- After Pi starts, notifies which session directories can still be migrated and
  the command to run (configurable via `notifyOnStart`).

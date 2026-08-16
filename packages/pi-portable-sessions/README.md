# @brglng/pi-portable-sessions

Portable session directory names for the [Pi coding agent](https://github.com/earendil-works/pi-mono).

By default, Pi stores each project's sessions under a directory named after the
encoded working directory:

```text
~/.pi/agent/sessions/--Users-zpan-my-project--/20240816_1234abcd.jsonl
```

The name embeds the absolute path, so it is different on every machine (different
user name, different mount point). `@brglng/pi-portable-sessions` renames that
directory to a **portable** form — the home prefix becomes `HOME`, other roots
become `ROOT`, and the remaining path is URL-encoded — so the same project maps
to the same directory name on every machine. That makes session directories
syncable and shareable across machines.

For a Chinese version of this document, see [README.zh.md](README.zh.md).

## How it works

Pi hard-codes the `--<encoded-cwd>--` directory name. This extension cannot
change Pi's internal encoding, so it migrates the directory and leaves a
**symlink bridge** at Pi's default path:

```text
~/.pi/agent/sessions/
├── HOME%2Fmy-project/            ← real directory (portable name)
└── --Users-brglng-my-project--   ← symlink → HOME%2Fmy-project
```

Pi keeps writing through the symlink, so the current session, `/resume`, and
future startups all keep working while the on-disk name becomes portable.

## Naming rules

1. The longest matching `extraPrefixes` entry wins.
2. Otherwise the home directory prefix is replaced with `homeLabel`.
3. Otherwise the root prefix (`/`) is replaced with `rootLabel`.
4. The remainder of the path is percent-encoded (URL encoding), which keeps the
   name reversible and free of filesystem-hostile characters.

| Working directory | Portable name |
|-------------------|---------------|
| `/Users/brglng/my-project` (home `/Users/brglng`) | `HOME%2Fmy-project` |
| `/Users/brglng` | `HOME` |
| `/var/www` | `ROOT%2Fvar%2Fwww` |
| `/Volumes/Backup/data` (with `{"/Volumes/Backup": "BACKUP"}`) | `BACKUP%2Fdata` |

## Installation

```bash
npm install -g @brglng/pi-portable-sessions
```

The package registers itself via `pi.extensions` and is loaded automatically.

## Configuration

The extension reads the standard Pi extension config files:

- Global: `~/.pi/agent/extensions/pi-portable-sessions/config.json`
- Project: `<cwd>/.pi/extensions/pi-portable-sessions/config.json`

Project values override global values; `extraPrefixes` maps are merged. See
[`config/config.example.json`](config/config.example.json) and
[`schemas/config.schema.json`](schemas/config.schema.json).

```json
{
  "$schema": "https://raw.githubusercontent.com/brglng/pi-packages/main/packages/pi-portable-sessions/schemas/config.schema.json",
  "homeLabel": "HOME",
  "rootLabel": "ROOT",
  "extraPrefixes": {
    "/Volumes/Backup": "BACKUP"
  },
  "notifyOnStart": true
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `homeLabel` | `HOME` | Label replacing the home directory prefix. |
| `rootLabel` | `ROOT` | Label replacing the root directory prefix. |
| `extraPrefixes` | `{}` | Additional absolute path prefix → label mappings. |
| `notifyOnStart` | `true` | After Pi starts, notify which session directories can be migrated and the command to run. |

The session root directory is not configurable here: it is resolved from Pi
itself, with the same precedence Pi uses — `PI_CODING_AGENT_SESSION_DIR`, then
`sessionDir` in `settings.json`, then the default `<agentDir>/sessions`.

## Commands

### `/portable-sessions status`

Show the portable name, Pi's default directory, and the portable directory for
the current project.

### `/portable-sessions migrate`

Migrate the current project's session directory to its portable name and leave
a symlink at Pi's default path.

- `--all` — migrate every default-named session directory under the sessions
  root (each directory is identified by the `cwd` recorded in its session files'
  headers).
- `--dry-run` — preview what would change without moving anything.
- `--yes` — skip the confirmation dialog (required in non-TUI modes).

Before anything is moved, a confirmation dialog shows each rename — the current
directory name and its portable target:

```text
Migrate 2 session directories?
  --Users-brglng-project-a--  →  HOME%2Fproject-a
  --var-www--                 →  ROOT%2Fvar%2Fwww
```

While the migration runs, Pi blocks session operations (`/new`, `/resume`,
`/fork`, `/tree`, `/compact`) and swallows user input with a warning, so no
session file can be written into a directory that is about to be renamed or
merged.

When the portable directory already contains a session file with the same name
as one in the directory being migrated, the two files are merged with Pi's
default model: a nested `pi -p` (print mode, `--no-session`) run merges both
JSONL files into the target file. The merge run's session is isolated in a
temporary directory that is deleted afterwards, so it is never migrated and
leaves no trace. Conflicts the merge fails to resolve are skipped and reported
in the migration summary.

The migration is idempotent: running it again reports already-migrated
directories and skips them.

## Startup notification

After Pi starts, the extension scans the sessions root and notifies when
session directories can still be migrated, listing each rename and the command
to run (`/portable-sessions migrate` for the current project, or
`/portable-sessions migrate --all` for everything). Disable with
`"notifyOnStart": false` in the config.

## Limitations

- Pi's *current* session file is still addressed through the `--<encoded-cwd>--`
  symlink; only the physical directory name changes. This is intentional — it is
  what keeps Pi fully functional before and after migration.
- When a portable directory already exists (for example, sessions synced from
  another machine), migration merges files into it without overwriting existing
  ones.
- Session directories with no readable session-file header cannot be migrated by
  `--all`; they are reported and skipped.

## License

MPL-2.0

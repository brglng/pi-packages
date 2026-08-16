# @brglng/pi-portable-sessions

Portable session directory names for the [Pi coding agent](https://github.com/earendil-works/pi-mono).

By default, Pi stores each project's sessions under a directory named after the
encoded working directory:

```text
~/.pi/agent/sessions/--Users-brglng-my-project--/20240816_1234abcd.jsonl
```

The name embeds the absolute path, so it is different on every machine (different
user name, different mount point). `@brglng/pi-portable-sessions` moves that
directory into a **portable** root — the home prefix becomes `HOME`, other roots
become `ROOT`, and the remaining path is URL-encoded — so the same project maps
to the same directory name on every machine. That makes session directories
syncable and shareable across machines.

For a Chinese version of this document, see [README.zh.md](README.zh.md).

## How it works

Pi hard-codes the `--<encoded-cwd>--` directory name. This extension cannot
change Pi's internal encoding, so it keeps Pi's default path as a **symlink
bridge** into a portable directory under its own root:

```text
~/.pi/agent/sessions/
└── --Users-brglng-my-project--   ← symlink → ~/.pi/agent/portable-sessions/HOME%2Fmy-project

~/.pi/agent/portable-sessions/
└── HOME%2Fmy-project/            ← real directory (portable name)
```

Pi keeps writing through the symlink, so the current session, `/resume`, and
future startups all keep working while the physical storage lives in the
portable root.

### Auto-bridge on session start

Whenever a session starts (startup, resume, new, or fork), the current
project's default directory is **automatically bridged**: Pi's `--<cwd>--`
directory becomes a symlink into a fresh `portable-sessions/<portable-name>`
directory. This is idempotent — already bridged projects are left untouched.
The portable root is separate from Pi's sessions root, so the sessions root
only ever contains symlinks.

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
  "notifyOnStart": true,
  "portableRoot": "~/.pi/agent/portable-sessions"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `homeLabel` | `HOME` | Label replacing the home directory prefix. |
| `rootLabel` | `ROOT` | Label replacing the root directory prefix. |
| `extraPrefixes` | `{}` | Additional absolute path prefix → label mappings. |
| `notifyOnStart` | `true` | After Pi starts, notify which session directories can still be migrated. |
| `portableRoot` | `<agentDir>/portable-sessions` | Root directory holding the portable session directories. |

The migration source (Pi's sessions root) is not configurable here: it is
resolved from Pi itself, with the same precedence Pi uses —
`PI_CODING_AGENT_SESSION_DIR`, then `sessionDir` in `settings.json`, then the
default `<agentDir>/sessions`.

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

In interactive mode the migration walks **one directory at a time**: each
rename is confirmed individually before it is migrated, then the next one is
offered.

```text
Migrate session directory?
  --Users-brglng-project-a--  →  HOME%2Fproject-a
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
to run (`/portable-sessions migrate --all` for everything, or pass individual
directory names). Disable with `"notifyOnStart": false` in the config.

## Limitations

- Pi's *current* session file is still addressed through the `--<encoded-cwd>--`
  symlink; only the physical directory location changes. This is intentional —
  it is what keeps Pi fully functional before and after migration.
- When a portable directory already exists (for example, sessions synced from
  another machine), migration merges files into it without overwriting existing
  ones.
- Session directories with no readable session-file header cannot be migrated by
  `--all`; they are skipped and counted in the summary.

## License

MPL-2.0

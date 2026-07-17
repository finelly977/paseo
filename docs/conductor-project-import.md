# Conductor Project Import

Paseo can import repository-local Conductor project settings into `paseo.json`.

The importer reads only these files from the selected project root:

- `.conductor/settings.local.toml`
- `.conductor/settings.toml`
- `conductor.json`, only when `.conductor/settings.toml` is absent

It does not read `~/.conductor` or managed organization settings, because importing those into a repository-owned `paseo.json` could leak local or policy-controlled values.

## Imported

- `scripts.setup` becomes `worktree.setup` when Paseo setup is empty.
- `scripts.archive` becomes `worktree.teardown` when Paseo teardown is empty.
- `scripts.run.<id>.command` becomes `scripts.<id>.command` unless Paseo already has that script id.
- Legacy `scripts.run` string becomes `scripts.run`.
- Run `args` are shell-quoted and appended to the command.
- Safe relative run `options.cwd` becomes a `cd -- <path> &&` command prefix.
- Run scripts using `CONDUCTOR_PORT` become Paseo service scripts and use `PASEO_PORT`.

## Reported But Not Imported

- Existing Paseo setup, teardown, or script ids win and are reported as collisions.
- Absolute or escaping `cwd` values are skipped.
- Cloud-only scripts are skipped.
- Hidden scripts import their command but report the hidden flag as unsupported.
- `scripts.run_mode` and `scripts.auto_run_after_setup` are unsupported.
- `file_include_globs` and `.worktreeinclude` are reported, not converted to shell copy commands.
- Environment variable values are never returned to the client or written into `paseo.json`; only names are shown.
- Spotlight, git, archive, agent, provider, and presentation-only Conductor settings are not migrated.

Apply re-reads the source files and `paseo.json` before writing. If either changed since preview, the user must refresh the preview before importing.

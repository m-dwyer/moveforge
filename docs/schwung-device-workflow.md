# Schwung Device Workflow

Moveforge's fast loop should stay local: render WAVs, run core tests, and use
the browser emulator before copying anything to Move. Once hardware is in the
loop, use the scripts here to keep deploy/debug steps repeatable.

## Health Check

```bash
MOVE_HOST=ableton@move.local MODULE_ID=westfold mise run move-health
```

This verifies SSH, Schwung module paths, the selected module's deployed files,
free space under `/data/UserData`, debug logging state, and the tail of
`/data/UserData/schwung/debug.log`.

## Logs

Enable logging, clear the old log, and follow new output:

```bash
MOVE_HOST=ableton@move.local ./scripts/tail-move-log.sh --enable --clear --yes
```

Read the last lines without following:

```bash
./scripts/tail-move-log.sh --no-follow --lines 120
```

Schwung writes unified logs to:

```text
/data/UserData/schwung/debug.log
```

The flag file enabling logging is:

```text
/data/UserData/schwung/debug_log_on
```

## Runtime Cache

Preview transient shared-memory buffers and Schwung temp files that would be
cleared:

```bash
mise run move-cache
```

Apply the deletion:

```bash
./scripts/clear-move-cache.sh --apply
```

To also clear Schwung's download/cache directory:

```bash
./scripts/clear-move-cache.sh --apply --purge-download-cache
```

## Restart

Ask Schwung's installed restart helper to restart Move:

```bash
mise run move-restart
```

This script intentionally delegates to `/data/UserData/schwung/restart-move.sh`
instead of carrying a local process-kill recipe. Keep device restart behavior
owned by the installed Schwung version.

## Screen Capture

Capture the Move/Schwung browser endpoint for later comparison with emulator
behavior:

```bash
MOVE_SCREEN_URL=http://move.local:7681/ mise run move-screen
```

The default output is:

```text
renders/move-screen.png
```

Use `MOVE_SCREEN_OUT=path/to/file.png` to save a named capture for a specific
module or UI state.

## Upstream References

Refresh the vendored Schwung reference checkout:

```bash
./scripts/update-upstream-schwung.sh
```

Use this before updating local API headers, module metadata assumptions, or
Shadow UI behavior. The script requires network access and only works when
`upstream/schwung` is a git checkout.

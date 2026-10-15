# Library and artwork persistence

Resonance keeps the existing `resonance_library.json` format (version 2) and
AppData location. No migration or library reset is required to upgrade.

## Library saves

- A single serialized frontend writer feeds an AppData snapshot command.
- Native snapshots are staged and synced to a temporary file before replacing
  the primary file in the same directory.
- Before replacing a valid primary, a copy is staged and atomically installed
  as `resonance_library.json.bak`.
- On launch, the native loader validates the primary JSON and falls back to the
  last valid backup. It does **not** automatically delete or overwrite either.
- If both copies are unreadable, native saves are blocked for that session to
  avoid replacing a potentially recoverable library with empty defaults.
- The original audio files are never moved or edited by these operations.

A backup is first created when the upgraded app successfully performs a second
library save. Older installations had only the primary JSON; the first upgraded
save creates a backup of that previous primary.

## Folder artwork

The optional `artwork_sources_v1.json` records source path, file size,
modification time, and the AppData artwork copy's relative path. Rescans skip
reading and copying unchanged source images when that cached destination still
exists. If the source changed or the index is unavailable, Resonance fingerprints
the source bytes and only writes a copy if its fingerprinted file does not exist.

This index does not own original source artwork or user-selected covers and can
be rebuilt. Existing imported covers and custom artwork paths remain unchanged.
Old fingerprinted artwork copies are **not** garbage-collected during upgrades,
so no other saved track can lose an image because it became temporarily unused.

## Manual Windows checks

1. Upgrade an installation with existing tracks, playlists, Favorites and custom
   covers. Confirm all data remains after closing and reopening the application.
2. Change a playlist and volume, restart and verify the latest values.
3. Rescan an unchanged cover folder, then modify one image and rescan. Check
   that unchanged covers keep their AppData paths and the changed cover updates.
4. Import a folder containing unreadable files and verify other tracks survive.
5. On a **disposable test profile only**, corrupt the primary library JSON after
   two valid saves. Confirm the backup is restored and the broken primary has not
   been deleted. If both copies are damaged, verify new writes are blocked.

The existing browser build retains its localStorage fallback.

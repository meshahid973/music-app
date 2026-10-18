# Audio playback and SQLite migration

The desktop music library now uses `resonance_library.sqlite3` under the same
Tauri AppData directory as the older `resonance_library.json`. Tracks, playlists,
and preferences are stored in separate SQLite tables. Track and playlist metadata
remain complete and future-compatible.

On the first run, the app reads the existing JSON file (or a valid `.json.bak`)
and imports it transactionally. The original files are **not deleted, renamed, or
modified**. If the migration or SQLite read fails, the app shows a recovery warning
and disables automatic database saves to protect the previous data.

Saved audio file paths and artwork references remain unchanged. Only files
already selected/authorized through Tauri's file-system scope are added to the
asset protocol's allowlist. The player grants access immediately before opening
a track; imports also authorize files before probing their duration. This avoids
an unrestricted `$HOME/**` asset scope.

The web/browser version retains its existing localStorage behavior.

## Test checklist

1. Back up your Resonance AppData directory before replacing an installed build.
2. Upgrade a library with playlists, Favorites, selected artwork, and settings.
   Reopen the app and confirm everything is unchanged.
3. Play and seek an MP3 from the selected music folder; restart and replay it.
4. Test FLAC/M4A/Opus on the actual Windows WebView2 version. A file extension
   does not guarantee the installed media decoder supports that codec.
5. Play tracks added using single-file import, folder import, and drag-and-drop.
6. Move/remove a song and confirm a clear playback error, not an endless
   playing indication.
7. Rescan and edit playlists; verify the SQLite database persists those changes.
8. On a **disposable test profile only**, intentionally corrupt legacy JSON and
   verify SQLite migration fails without overwriting the original.
9. If testing the separate Spotify PR, remember that unmatched Spotify entries
   are metadata placeholders: Spotify audio is never streamed or downloaded.

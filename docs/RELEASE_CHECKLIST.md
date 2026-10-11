# Windows Release QA Checklist

Use this checklist for each candidate release of Resonance. A successful CI build confirms compilation and automated checks; it does **not** prove that the installer, Windows file permissions, audio devices, or restart recovery work on a real machine.

Record the Windows version, app version, test date, and tester alongside the release notes. Mark a case as passed only after performing it on the target machine.

Automated CI coverage is also provided by `.github/workflows/verify.yml`: on a Windows runner it builds the NSIS installer, installs it silently, locates the installed executable, launches it, and checks that the process remains running briefly. This validates installation and startup only; it does not mark the interactive audio, permission, artwork, persistence, upgrade, or uninstall checks below as passed.

## Clean-install smoke test

- [ ] Use a clean Windows 10/11 user profile or disposable VM without an earlier Resonance install.
- [ ] Install the generated NSIS `*-setup.exe` as the current user, without administrator elevation.
- [ ] Confirm the app launches and creates its AppData storage without permission errors.
- [ ] Confirm the app launches if WebView2 is already installed; verify the documented bootstrapper behavior if it is absent.
- [ ] Import a single MP3, a FLAC file, and a folder containing nested music files.
- [ ] Verify title, artist, album, duration, and embedded artwork for representative files; note formats whose tags are unsupported.
- [ ] Play, pause, seek, adjust volume, skip next/previous, and confirm playback errors are visible rather than silently failing.
- [ ] Create, rename, and delete a playlist; add/remove tracks and verify Favorites.
- [ ] Edit a song's title, artist, album, and cover art; verify edits remain after restart.
- [ ] Change theme preset, accent color, volume, shuffle/repeat, and selected folders; restart and verify preferences persist.
- [ ] Close the app fully, relaunch it, and verify the library, playlist membership, metadata edits, artwork, and settings restore.
- [ ] Move or temporarily remove an imported source file and confirm the failure is understandable and does not corrupt the rest of the library.
- [ ] Test selecting and rescanning a folder, drag-and-drop, and a path containing spaces and non-ASCII characters.
- [ ] Verify no music files are uploaded and document the fact that the app stores file paths rather than copying the original audio into its library database.

## Upgrade and recovery

- [ ] Install the candidate over the previous released version with a non-empty library.
- [ ] Verify existing playlists, manual metadata edits, artwork, and settings survive the upgrade.
- [ ] Test recovery from a missing, empty, malformed, or older-version library payload using disposable test data.
- [ ] Confirm a failed or denied folder access produces clear feedback and does not erase unrelated saved state.
- [ ] Uninstall and reinstall only after backing up test data; record which data the uninstaller retains or removes.

## Release gate

- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] Windows NSIS installer and MSI build successfully in GitHub Actions.
- [ ] The tag matches the versions in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
- [ ] Clean-install and upgrade tests above are recorded as passed or explicitly documented as not tested.
- [ ] README limitations and supported audio/tag formats are accurate.
- [ ] Release notes describe known issues, source-file path behavior, and any untested scenarios.

## Known limitations to document

- Resonance is local-first and has no account, backend, or cloud library sync.
- Saved desktop entries refer to original audio paths; moving or deleting a source file can break playback.
- Browser object URLs are session-scoped and should not be treated as persistent file access.
- Codec and metadata support depends on the implemented parser and the underlying WebView/browser.
- CI build success does not constitute manual Windows installer, audio-device, or long-duration playback testing.

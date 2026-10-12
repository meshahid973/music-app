# Resonance Music Player

A local-first music player for the browser and Windows desktop, built with React 19, TypeScript, Vite, Zustand, Howler.js, Framer Motion, and Tauri.

## Local development

Install Node.js 22.12 or later (Node.js 24 LTS recommended) and npm.

```bash
git clone https://github.com/todouro/music-app.git
cd music-app
npm install
npm run dev
```

Open http://localhost:3000. The development server binds to localhost by default. To intentionally expose it to another device on a trusted network, pass the host option explicitly:

```bash
npm run dev -- --host 0.0.0.0
```

Only expose the development server on networks you trust; it can serve development resources. Do not enable permissive host checks for convenience.

```bash
npm test
npm run lint
npm run build
npm run preview
```

## Community Cover Art

Community Cover Art is an optional, separate gallery. It never assigns artwork to tracks or edits audio files. To enable it, deploy the Worker described in [cloudflare/cover-art/README.md](cloudflare/cover-art/README.md), then set `VITE_COVER_ART_API_URL` to its HTTPS `workers.dev` URL in a local `.env.local` file or your release build environment. See [`.env.example`](.env.example) for the variable name. The gallery remains unavailable (without affecting playback) until configured, and the initial catalogue is intentionally empty until you upload artwork with documented redistribution rights.

Downloads in the installed desktop app use a native Save As dialog and a native command that validates the image type and 15 MiB limit before creating a new file. Existing files are never silently overwritten, and downloaded images remain outside the music library.

## Building Windows `setup.exe` (Tauri Desktop)

### Option 1: Build locally on Windows

Prerequisites: Node.js 22+, Rust stable toolchain (`rustup`), and Microsoft Visual Studio C++ Build Tools.

```bash
npm install
npm run tauri:build:win
```

The NSIS installer will be output to:
`src-tauri/target/release/bundle/nsis/Resonance_1.0.0_x64-setup.exe`

### Option 2: Build via GitHub Actions

1. Push to `main` or manually trigger the **Verify music player** or **Release Resonance** workflow via `workflow_dispatch` in the **Actions** tab to download the `Resonance-Windows-Setup` artifact containing `Resonance_1.0.0_x64-setup.exe`.
2. Push a version tag (`git tag v1.0.0 && git push origin v1.0.0`) to automatically publish a GitHub Release with `Resonance_1.0.0_x64-setup.exe` and `.msi` installers attached.

## Using Resonance

Import local audio files from **Add songs** or choose a **Music folder**. Embedded metadata extraction currently reads ID3 tags; files using other tag systems may fall back to filename-based guesses. Use **Edit song info** if a title or artist is wrong. Album art can be matched by filename or folder. Add tracks to playlists and Favorites, search your library, and use the player controls to shuffle or repeat songs. Audio format recognition does not guarantee every codec can be decoded by the installed Windows WebView.

In the **Windows desktop app**, the library, playlists, playback preferences, and durable artwork references are saved to the app's local AppData storage, with a localStorage backup for recovery. The app stores file paths and metadata rather than copying your music into its database; the original audio files must remain available at those paths. If a source file is moved or deleted, its saved entry may no longer be playable until you locate or re-import it.

In the **browser build**, playback depends on the browser session's access to imported files. Temporary browser object URLs are not durable across restarts, so re-import files when needed. Music is not uploaded to a server. There is no backend, cloud sync, or account system.

Some audio extensions may be recognized but cannot play if the WebView/browser lacks a suitable decoder. Before publishing a Windows release, complete the [Windows release QA checklist](docs/RELEASE_CHECKLIST.md); CI builds are not a substitute for installing and smoke-testing the generated installer on a clean Windows machine.

## Contributing

Please work on a feature branch and submit a focused pull request to the upstream project. Run `npm test`, `npm run lint`, and `npm run build` before proposing changes. Test keyboard and pointer operation when modifying playback UI.

The elastic volume control is an adaptation of the [React Bits Elastic Slider](https://reactbits.dev/components/elastic-slider), implemented with the existing Framer Motion dependency and a native accessible range input.

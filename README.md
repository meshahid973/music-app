# Resonance Music Player

A local-first browser music player built with React 19, TypeScript, Vite, Zustand, Howler.js and Framer Motion.

## Local development

Install Node.js 22.12 or later (Node.js 24 LTS recommended) and npm.

```bash
git clone https://github.com/todouro/music-app.git
cd music-app
npm install
npm run dev
```

Open http://localhost:3000. The Vite server is localhost-only by default; to test from another device on a trusted network, explicitly opt in with `npm run dev -- --host 0.0.0.0` and configure allowed hosts deliberately.

```bash
npm test
npm run lint
npm run build
npm run preview
```

## Using Resonance

Import local audio files from **Add songs** or choose a **Music folder**. The app extracts supported ID3 tags and can match album art by filename or folder. Add tracks to playlists and Favorites, search your library, and use the player controls to shuffle or repeat songs.

Playlists and player preferences are stored in your browser's localStorage. **For privacy and browser-security reasons, audio files themselves are not persisted or uploaded.** After refreshing, re-import the same local files to restore playable tracks and associate them with saved playlists. Music stays on your device.

Some audio extensions may be recognized but cannot play if the browser lacks a suitable decoder. There is no backend, cloud sync, or account system.

## Contributing

Please work on a feature branch and submit a focused pull request to the upstream project. Run `npm test`, `npm run lint`, and `npm run build` before proposing changes. Test keyboard and pointer operation when modifying playback UI.

The elastic volume control is an adaptation of the [React Bits Elastic Slider](https://reactbits.dev/components/elastic-slider), implemented with the existing Framer Motion dependency and a native accessible range input.

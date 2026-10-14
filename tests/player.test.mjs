import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybackQueue } from '../src/utils/queue.ts'
import { trackIdForFile } from '../src/utils/trackIdentity.ts'
import { objectUrlForFile, revokeOwnedObjectUrls } from '../src/utils/objectUrls.ts'
import { readID3Metadata, detectSongAndArtist, autoDetectTrackMetadata } from '../src/utils/metadata.ts'
import { uniqueTracks, tracksFromFiles } from '../src/utils/library.ts'
import { syncTracksWithCovers } from '../src/utils/covers.ts'
import { getVisibleTracks } from '../src/hooks/useTrackFilter.ts'
import {
  parseId3Header,
  readBoundedMetadataFromReader,
  MAX_METADATA_BYTES,
} from '../src/utils/boundedMetadata.ts'
import {
  sanitizeTrackForPersistence,
  sanitizeTracksForPersistence,
  hydrateTrackArtwork,
  hydrateTracksArtwork,
  sanitizeArtworkFilename,
} from '../src/utils/artworkStorage.ts'
import { migrateDesktopLibraryPayload } from '../src/utils/desktopDatabase.ts'
import { nativeTracksFromPaths, scanNativeDroppedPaths, scanNativeFolder } from '../src/utils/nativeFileSystem.ts'
import { getVirtualListRange } from '../src/utils/virtualList.ts'
import { processTrackEdit } from '../src/utils/trackEdit.ts'
import fs from 'node:fs'

const localStorageStore = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => localStorageStore.get(key) ?? null,
    setItem: (key, value) => localStorageStore.set(key, String(value)),
    removeItem: (key) => localStorageStore.delete(key),
    clear: () => localStorageStore.clear(),
  },
})

const { useMusicStore } = await import('../src/store/useMusicStore.ts')
const { syncPlaylistQueue } = await import('../src/hooks/usePlaylistManager.ts')

function fileInfo(path = 'album/song.mp3') {
  return { name: 'song.mp3', size: 123, lastModified: 42, webkitRelativePath: path }
}

test('virtual list range stays bounded and includes visible rows plus overscan', () => {
  assert.deepEqual(getVirtualListRange(1000, 0, 500), { start: 0, end: 14 })
  assert.deepEqual(getVirtualListRange(1000, 8600, 500), { start: 92, end: 114 })
  assert.deepEqual(getVirtualListRange(10, 999999, 500), { start: 10, end: 10 })
  assert.deepEqual(getVirtualListRange(0, 0, 500), { start: 0, end: 0 })
  assert.deepEqual(getVirtualListRange(10, -100, -1), { start: 0, end: 8 })
})

test('playlist filtering keeps only playlist members and search still applies', () => {
  const tracks = [
    { id: 'a', title: 'First Song', artist: 'Artist', album: 'Album', fileName: 'first.mp3', duration: 100 },
    { id: 'b', title: 'Second Song', artist: 'Artist', album: 'Album', fileName: 'second.mp3', duration: 120 },
    { id: 'c', title: 'Third Song', artist: 'Other', album: 'Elsewhere', fileName: 'third.mp3', duration: 140 },
  ]
  const playlist = { id: 'mix', name: 'Mix', trackIds: ['b', 'c'], createdAt: 1 }
  assert.deepEqual(getVisibleTracks(tracks, 'mix', playlist, '').map((track) => track.id), ['b', 'c'])
  assert.deepEqual(getVisibleTracks(tracks, 'mix', playlist, 'third').map((track) => track.id), ['c'])
  assert.deepEqual(getVisibleTracks(tracks, 'library', undefined, '').map((track) => track.id), ['a', 'b', 'c'])
})

test('search matches Unicode styled alphabets, accents, and invisible formatting marks', () => {
  const zeroWidth = String.fromCharCode(0x200b)
  const combiningAccent = String.fromCharCode(0x0301)
  const tracks = [
    { id: 'styled', title: '𝓢𝓾𝓷𝓼𝓱𝓲𝓷𝓮', artist: 'Beyoncé', album: '𝖭𝗂𝗀𝗁𝗍', fileName: 'sunshine.mp3', duration: 100 },
    { id: 'hidden', title: 'Late' + zeroWidth + 'Night', artist: 'Aster', album: 'Cafe' + combiningAccent, fileName: 'late-night.mp3', duration: 120 },
  ]

  assert.deepEqual(getVisibleTracks(tracks, 'library', undefined, 'sunshine').map((track) => track.id), ['styled'])
  assert.deepEqual(getVisibleTracks(tracks, 'library', undefined, 'beyonce').map((track) => track.id), ['styled'])
  assert.deepEqual(getVisibleTracks(tracks, 'library', undefined, 'night').map((track) => track.id), ['styled', 'hidden'])
  assert.deepEqual(getVisibleTracks(tracks, 'library', undefined, 'cafe').map((track) => track.id), ['hidden'])
})

test('deleting a song removes playlist references and stops it if currently playing', () => {
  const original = useMusicStore.getState()
  const retainedTrack = { id: 'keep', title: 'Keep', artist: 'Artist', album: '', duration: 1, fileName: 'keep.mp3', filePath: 'C:/Music/keep.mp3' }
  const deletedTrack = { id: 'delete-me', title: 'Delete me', artist: 'Artist', album: '', duration: 1, fileName: 'delete-me.mp3', filePath: 'C:/Music/delete-me.mp3' }

  useMusicStore.setState({
    tracks: [retainedTrack, deletedTrack],
    playlists: [
      { id: 'favorites', name: 'Favorites', trackIds: ['delete-me', 'keep'], createdAt: 1 },
      { id: 'mix', name: 'Mix', trackIds: ['delete-me'], createdAt: 2 },
    ],
    currentTrackId: 'delete-me',
    isPlaying: true,
  })

  try {
    useMusicStore.getState().deleteTrackFromLibrary('delete-me')
    const state = useMusicStore.getState()
    assert.deepEqual(state.tracks.map((track) => track.id), ['keep'])
    assert.deepEqual(state.playlists.map((playlist) => playlist.trackIds), [['keep'], []])
    assert.equal(state.currentTrackId, undefined)
    assert.equal(state.isPlaying, false)
    assert.equal(retainedTrack.filePath, 'C:/Music/keep.mp3')
  } finally {
    useMusicStore.setState(original, true)
  }
})

test('song rows use opacity-only transitions and volume rail does not expand on hover', () => {
  const appCss = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  const volumeCss = fs.readFileSync(new URL('../src/components/ElasticSlider.css', import.meta.url), 'utf8')
  const trackList = fs.readFileSync(new URL('../src/components/TrackList.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(trackList, /layout="position"|scale:\s*\{/)
  assert.match(trackList, /initial=\{\{ opacity: 0 \}\}/)
  const activeRail = volumeCss.match(/\.volume-track-container\.active \.volume-track-rail,[\s\S]*?\{([\s\S]*?)\}/)
  assert.ok(activeRail)
  assert.match(activeRail[1], /height: 4px/)
  assert.match(volumeCss, /transition: width 65ms cubic-bezier/)
  assert.match(appCss, /transition: width 65ms cubic-bezier/)
})
test('native folder scan reports inaccessible subfolders without discarding accessible files', async () => {
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  try {
    const result = await scanNativeFolder('root', async (currentPath) => {
      if (currentPath === 'root') {
        return [
          { name: 'Track.mp3', isDirectory: false, isFile: true },
          { name: 'cover.jpg', isDirectory: false, isFile: true },
          { name: 'restricted', isDirectory: true, isFile: false },
        ]
      }
      throw new Error('Permission denied')
    })

    assert.deepEqual(result.audioPaths, ['root/Track.mp3'])
    assert.deepEqual(result.coverPaths, ['root/cover.jpg'])
    assert.deepEqual(result.errors, ['root/restricted'])
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0][0]), /Could not read directory root\/restricted/)
  } finally {
    console.warn = originalWarn
  }
})

test('scanNativeDroppedPaths classifies dropped audio and cover files and nativeTracksFromPaths deduplicates batch paths', async () => {
  const dropped = await scanNativeDroppedPaths([
    'C:\\Music\\Album\\Track 01.mp3',
    'C:\\Music\\Album\\cover.jpg',
    'C:\\Music\\Album\\Track 02.flac',
  ])
  assert.deepEqual(dropped.audioPaths, [
    'C:\\Music\\Album\\Track 01.mp3',
    'C:\\Music\\Album\\Track 02.flac',
  ])
  assert.deepEqual(dropped.coverPaths, ['C:\\Music\\Album\\cover.jpg'])

  const tracks = await nativeTracksFromPaths(
    ['C:\\Music\\Artist - Song.mp3', 'C:\\Music\\Artist - Song.mp3'],
    new Map(),
  )
  assert.equal(tracks.length, 1)
  assert.equal(tracks[0].title, 'Song')
  assert.equal(tracks[0].artist, 'Artist')
})

test('setMusicFolder and setCoverFolder preserve folder paths and names in music store state', () => {
  useMusicStore.getState().setMusicFolder('C:\\Users\\Music', 'Music')
  useMusicStore.getState().setCoverFolder('C:\\Users\\Covers', 'Covers')

  const state = useMusicStore.getState()
  assert.equal(state.musicFolderPath, 'C:\\Users\\Music')
  assert.equal(state.musicFolderName, 'Music')
  assert.equal(state.coverFolderPath, 'C:\\Users\\Covers')
  assert.equal(state.coverFolderName, 'Covers')
})

test('rescan filtering only returns newly added audio files when rescanning a folder', async () => {
  const existingTracks = [
    { id: 'native:C:\\Music\\Song 1.mp3', title: 'Song 1', artist: 'Artist', duration: 100, fileName: 'Song 1.mp3', audioUrl: 'asset://song1.mp3' }
  ]
  const existingIds = new Set(existingTracks.map(t => t.id))

  // Rescan finds Song 1 (existing) and Song 2 (newly added)
  const allScannedFiles = ['C:\\Music\\Song 1.mp3', 'C:\\Music\\Song 2.mp3']
  const newTracks = await nativeTracksFromPaths(allScannedFiles, new Map(), existingIds)

  // Only Song 2 should be returned as a new track to add
  assert.equal(newTracks.length, 1)
  assert.equal(newTracks[0].id, 'native:C:\\Music\\Song 2.mp3')
  assert.equal(newTracks[0].title, 'Song 2')
})

test('Favorites is permanent and liking a song restores it if missing', () => {
  const originalPlaylists = useMusicStore.getState().playlists
  const trackId = 'test-track-fav-restore'

  // Simulate a persisted library where Favorites was missing.
  useMusicStore.setState({
    playlists: originalPlaylists.filter((playlist) => playlist.id !== 'favorites'),
  })
  useMusicStore.getState().addTrackToPlaylist('favorites', trackId)

  let favoritesPlaylist = useMusicStore.getState().playlists.find((playlist) => playlist.id === 'favorites')
  assert.ok(favoritesPlaylist)
  assert.equal(favoritesPlaylist.name, 'Favorites')
  assert.equal(favoritesPlaylist.trackIds.includes(trackId), true)

  // The protected playlist cannot be deleted or renamed.
  useMusicStore.getState().deletePlaylist('favorites')
  useMusicStore.getState().renamePlaylist('favorites', 'Renamed')
  favoritesPlaylist = useMusicStore.getState().playlists.find((playlist) => playlist.id === 'favorites')
  assert.ok(favoritesPlaylist)
  assert.equal(favoritesPlaylist.name, 'Favorites')

  useMusicStore.getState().removeTrackFromPlaylist('favorites', trackId)
  useMusicStore.setState({ playlists: originalPlaylists })
})

test('addTrackToPlaylist prevents duplicate track ids in playlist', () => {
  const store = useMusicStore.getState()
  const trackId = 'test-track-dup-1'
  const playlistId = 'favorites'

  store.addTrackToPlaylist(playlistId, trackId)
  store.addTrackToPlaylist(playlistId, trackId)

  const playlist = useMusicStore.getState().playlists.find((p) => p.id === playlistId)
  const occurrences = playlist.trackIds.filter((id) => id === trackId).length
  assert.equal(occurrences, 1)

  // Clean up
  store.removeTrackFromPlaylist(playlistId, trackId)
})

test('clicking or switching playlist while actively listening does not auto-switch the song', () => {
  const queue = new PlaybackQueue()
  const syncState = { lastPlaylistId: 'library', lastTrackIds: ['track1', 'track2', 'track3'] }
  queue.start(['track1', 'track2', 'track3'], 'track2')

  let selectedTrackId = null
  const onTrackSelect = (id) => {
    selectedTrackId = id
  }

  // Actively listening to 'track2' from library. User clicks on a different playlist ('playlist-chill' with ['trackA', 'trackB'])
  syncPlaylistQueue(queue, syncState, {
    activePlaylistId: 'playlist-chill',
    playlistTrackIds: ['trackA', 'trackB'],
    currentTrackId: 'track2',
    isPlaying: true,
    onTrackSelect,
  })

  // onTrackSelect MUST NOT be called! Current song MUST NOT auto-switch!
  assert.equal(selectedTrackId, null)
  // Queue still retains track2 and playback can continue in active session
  assert.equal(queue.currentHistory[0], 'track2')
  assert.equal(queue.next('track2', false, 'off'), 'track3')
})

test('ambient mode is removed and legacy preferences normalize to normal', () => {
  const settingsSource = fs.readFileSync(
    new URL('../src/components/modals/SettingsModal.tsx', import.meta.url),
    'utf8',
  )
  assert.equal(settingsSource.includes('Ambient Mode'), false)
  assert.equal(useMusicStore.getState().themeMode, 'normal')

  const migrated = migrateDesktopLibraryPayload({
    tracks: [],
    playlists: [],
    volume: 0.82,
    shuffle: false,
    repeat: 'off',
    themeMode: 'ambient',
  })
  assert.equal(migrated?.themeMode, 'normal')

  const heroSource = fs.readFileSync(
    new URL('../src/components/HeroPlayer.tsx', import.meta.url),
    'utf8',
  )
  const heroStyles = fs.readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.equal(heroSource.includes('hero-acrylic-backdrop'), true)
  assert.equal(heroStyles.includes('.hero-acrylic-backdrop-img'), true)
  assert.equal(heroStyles.includes('.app-shell.theme-normal .hero-acrylic-backdrop'), false)
})




test('filename metadata parsing preserves meaningful hyphens in artist and title', async () => {
  const detected = await autoDetectTrackMetadata('Jay-Z - 99-Problems.mp3')
  assert.equal(detected.artist, 'Jay-Z')
  assert.equal(detected.title, '99-Problems')
})

test('ID3v2.3 parser skips a valid extended header before reading frames', async () => {
  const tagged = new Uint8Array(await makeTag(3, 'Extended Header Song', 'Extended Header Artist').arrayBuffer())
  const frameBytes = tagged.subarray(10)
  // ID3v2.3 extended header: 4-byte size (excluding the size field), flags, padding size.
  const extendedHeader = Buffer.from([0, 0, 0, 6, 0, 0, 0, 0, 0, 0])
  const tagSize = extendedHeader.length + frameBytes.length
  const header = Buffer.from([73, 68, 51, 3, 0, 0x40, ...synchsafe(tagSize)])
  const file = new File([Buffer.concat([header, extendedHeader, Buffer.from(frameBytes)])], 'extended.mp3', { type: 'audio/mpeg' })
  const result = await readID3Metadata(file)
  assert.equal(result?.title, 'Extended Header Song')
  assert.equal(result?.artist, 'Extended Header Artist')
})

test('editing text metadata preserves existing embedded artwork provenance', async () => {
  const originalTrack = {
    id: 'native:/music/embedded.mp3',
    title: 'Original',
    artist: 'Original Artist',
    album: 'Original Album',
    duration: 180,
    fileName: 'embedded.mp3',
    filePath: '/music/embedded.mp3',
    audioUrl: 'asset:///music/embedded.mp3',
    coverUrl: 'asset:///appdata/artwork/embedded.jpg',
    coverPath: '/appdata/artwork/embedded.jpg',
    coverSource: 'embedded',
    accent: '#555555',
  }
  const result = await processTrackEdit({
    track: originalTrack,
    title: '  Corrected Title  ',
    artist: '  Corrected Artist ',
    album: '  Corrected Album ',
    coverUrl: originalTrack.coverUrl,
    coverPath: originalTrack.coverPath,
    isDesktop: true,
  })
  assert.equal(result.success, true)
  assert.equal(result.updates?.title, 'Corrected Title')
  assert.equal(result.updates?.artist, 'Corrected Artist')
  assert.equal(result.updates?.album, 'Corrected Album')
  assert.equal(result.updates?.coverUrl, originalTrack.coverUrl)
  assert.equal(result.updates?.coverPath, originalTrack.coverPath)
  assert.equal(result.updates?.coverSource, 'embedded')
})

test('removed Looks preferences are ignored during desktop library migration', async () => {
  const { migrateDesktopLibraryPayload } = await import('../src/utils/desktopDatabase.ts')
  const base = {
    tracks: [],
    playlists: [],
    activePlaylistId: 'library',
    volume: 0.82,
    shuffle: false,
    repeat: 'off',
    themeMode: 'ambient',
  }
  const legacy = migrateDesktopLibraryPayload({ ...base, themePreset: 'ocean', accentColor: '#12abef' })
  assert.equal(legacy?.themePreset, undefined)
  assert.equal(legacy?.accentColor, undefined)
  assert.equal('themePreset' in (legacy ?? {}), false)
  assert.equal('accentColor' in (legacy ?? {}), false)

  const settingsSource = fs.readFileSync(
    new URL('../src/components/modals/SettingsModal.tsx', import.meta.url),
    'utf8',
  )
  assert.equal(settingsSource.includes('Looks'), false)
  assert.equal(settingsSource.includes('themePreset'), false)
  assert.equal(settingsSource.includes('accentColor'), false)
})



test('cover-folder imports store durable paths and refresh stale direct artwork URLs', () => {
  const track = {
    id: 'native:C:\\Music\\Song.mp3',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    fileName: 'Song.mp3',
    filePath: 'C:\\Music\\Song.mp3',
    audioUrl: 'asset:///C:/Music/Song.mp3',
    accent: 'hsl(220 14% 62%)',
  }
  const staleTrack = {
    ...track,
    id: 'native:C:\\Music\\Another Song.mp3',
    title: 'Another Song',
    fileName: 'Another Song.mp3',
    filePath: 'C:\\Music\\Another Song.mp3',
    audioUrl: 'asset:///C:/Music/Another%20Song.mp3',
    coverUrl: 'asset:///C:/Old/Another%20Song.jpg',
    coverPath: 'C:\\Old\\Another Song.jpg',
    coverSource: 'direct',
  }
  const songCoverUrl = 'asset:///C:/Music/Covers/Song.jpg'
  const otherCoverUrl = 'asset:///C:/Music/Covers/Another%20Song.jpg'
  const songCoverPath = 'C:\\Music\\Covers\\Song.jpg'
  const otherCoverPath = 'C:\\Music\\Covers\\Another Song.jpg'

  useMusicStore.setState({
    tracks: [track, staleTrack],
    coverPool: [],
    coverLookup: new Map(),
  })
  useMusicStore.getState().addCovers(
    new Map([
      ['song', songCoverUrl],
      ['another song', otherCoverUrl],
    ]),
    [songCoverUrl, otherCoverUrl],
    new Map([
      ['song', songCoverPath],
      ['another song', otherCoverPath],
    ]),
  )

  const updatedTracks = useMusicStore.getState().tracks
  const updated = updatedTracks.find((item) => item.id === track.id)
  const refreshed = updatedTracks.find((item) => item.id === staleTrack.id)
  assert.equal(updated?.coverUrl, songCoverUrl)
  assert.equal(updated?.coverPath, songCoverPath)
  assert.equal(updated?.coverSource, 'direct')
  assert.equal(refreshed?.coverUrl, otherCoverUrl)
  assert.equal(refreshed?.coverPath, otherCoverPath)
  assert.equal(refreshed?.coverSource, 'direct')

  // The durable path is used to rebuild cover URLs after a desktop restart.
  for (const item of [updated, refreshed]) {
    assert.ok(item)
    const sanitized = sanitizeTrackForPersistence(item)
    const hydrated = hydrateTrackArtwork(sanitized)
    assert.equal(hydrated.coverPath, item.coverPath)
    assert.equal(hydrated.coverUrl, item.coverPath)
  }
})


test('refreshed cover pools replace inaccessible persisted artwork URLs', () => {
  const oldCoverUrl = 'http://asset.localhost/C:/Users/test/Music/covers/old.jpg'
  const freshCoverA = 'http://asset.localhost/C:/Users/test/AppData/artwork/fresh-a.jpg'
  const freshCoverB = 'http://asset.localhost/C:/Users/test/AppData/artwork/fresh-b.jpg'
  const tracks = [
    {
      id: 'one',
      title: 'Song One',
      artist: 'Artist',
      album: 'Record One',
      duration: 180,
      fileName: 'song-one.mp3',
      filePath: 'C:\\Music\\song-one.mp3',
      coverUrl: oldCoverUrl,
      coverSource: 'pool',
      accent: '#555555',
    },
    {
      id: 'two',
      title: 'Song Two',
      artist: 'Artist',
      album: 'Record Two',
      duration: 180,
      fileName: 'song-two.mp3',
      filePath: 'C:\\Music\\song-two.mp3',
      coverUrl: oldCoverUrl,
      coverPath: 'C:\\Old Covers\\old.jpg',
      coverSource: 'direct',
      accent: '#555555',
    },
  ]

  const refreshed = syncTracksWithCovers(
    tracks,
    new Map([['cover-one', freshCoverA], ['cover-two', freshCoverB]]),
    [freshCoverA, freshCoverB],
  )

  assert.equal(refreshed.length, 2)
  for (const track of refreshed) {
    assert.ok([freshCoverA, freshCoverB].includes(track.coverUrl))
    assert.notEqual(track.coverUrl, oldCoverUrl)
    assert.equal(track.coverSource, 'pool')
  }
})

test('first-run setup completion is normalized and persisted in desktop payloads', () => {
  const base = {
    tracks: [],
    playlists: [],
    activePlaylistId: 'library',
    volume: 0.82,
    shuffle: false,
    repeat: 'off',
  }

  const complete = migrateDesktopLibraryPayload({ ...base, firstRunSetupCompleted: true })
  assert.equal(complete?.firstRunSetupCompleted, true)

  const incomplete = migrateDesktopLibraryPayload({ ...base, firstRunSetupCompleted: false })
  assert.equal(incomplete?.firstRunSetupCompleted, false)
})

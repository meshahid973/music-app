import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybackEngine } from '../src/utils/playbackEngine.ts'
import { mergeHydratedLibraryTracks, restorePlayableTrackId } from '../src/utils/libraryHydration.ts'

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function createFixture(overrides = {}) {
  const instances = []
  const phases = []
  const errors = []
  let ends = 0
  const engine = new PlaybackEngine({
    source: 'http://asset.localhost/song.mp3',
    authorize: overrides.authorize ?? (async () => {}),
    createAudio: (events) => {
      const sound = {
        events,
        playCalls: 0,
        unloadCalls: 0,
        position: 0,
        unlocked: null,
        playingFlag: false,
        currentState: 'loading',
        state() { return this.currentState },
        playing() { return this.playingFlag },
        play() { this.playCalls++ },
        pause() { this.playingFlag = false; events.onpause() },
        stop() { this.playingFlag = false },
        unload() { this.unloadCalls++; this.currentState = 'unloaded' },
        seek(value) {
          if (typeof value === 'number') { this.position = value; return this }
          return this.position
        },
        volume() { return this },
        once(event, callback) {
          if (event === 'unlock') this.unlocked = callback
          return this
        },
      }
      instances.push(sound)
      return sound
    },
    onPhase: (p) => phases.push(p),
    onError: (reason, original) => errors.push({ reason, original }),
    onEnd: () => { ends++ },
    deadlineMs: overrides.deadlineMs ?? 100,
    checkEveryMs: overrides.checkEveryMs ?? 5,
  })
  return { engine, instances, phases, errors, endCount: () => ends }
}

test('startup authorization must finish before the first media element is created', async () => {
  let permit
  const gate = new Promise((resolve) => { permit = resolve })
  const f = createFixture({ authorize: () => gate })
  try {
    f.engine.play()
    assert.equal(f.instances.length, 0)
    assert.equal(f.engine.status, 'loading')
    permit()
    await wait()
    assert.equal(f.instances.length, 1)
    assert.equal(f.instances[0].playCalls, 1)
    // No optimistic "playing" UI before onplay.
    assert.notEqual(f.engine.status, 'playing')
    f.instances[0].events.onload()
    f.instances[0].currentState = 'loaded'
    f.instances[0].playingFlag = true
    f.instances[0].events.onplay()
    assert.equal(f.engine.status, 'playing')
  } finally { f.engine.dispose() }
})

test('pause and resume use the same player without resetting its position', async () => {
  const f = createFixture()
  try {
    await wait()
    const audio = f.instances[0]
    f.engine.play()
    audio.currentState = 'loaded'
    audio.playingFlag = true
    audio.events.onplay()
    f.engine.seek(17)
    f.engine.pause()
    assert.equal(f.engine.status, 'paused')
    assert.equal(audio.position, 17)
    f.engine.play()
    assert.equal(audio.playCalls, 2)
    assert.equal(f.instances.length, 1)
  } finally { f.engine.dispose() }
})

test('a denied or broken media URL is retried once and then errors, not fake-playing', async () => {
  const f = createFixture()
  try {
    f.engine.play()
    await wait()
    f.instances[0].events.onloaderror(1, 'HTTP 403')
    await wait()
    assert.equal(f.instances.length, 2)
    assert.equal(f.instances[0].unloadCalls, 1)
    f.instances[1].events.onloaderror(1, 'HTTP 403 again')
    assert.equal(f.engine.status, 'error')
    assert.equal(f.errors.length, 1)
    assert.ok(!f.phases.includes('playing'))
  } finally { f.engine.dispose() }
})

test('a stalled loading player is rebuilt then fails within a deadline', async () => {
  const f = createFixture({ deadlineMs: 30, checkEveryMs: 5 })
  try {
    f.engine.play()
    await wait(105)
    assert.equal(f.instances.length, 2)
    assert.equal(f.engine.status, 'error')
    assert.equal(f.errors.length, 1)
    assert.equal(f.errors[0].reason, 'The audio did not start before the timeout.')
  } finally { f.engine.dispose() }
})

test('a playing player whose position never advances is recognized as stalled', async () => {
  const f = createFixture({ deadlineMs: 30, checkEveryMs: 5 })
  try {
    f.engine.play()
    await wait()
    const first = f.instances[0]
    first.currentState = 'loaded'
    first.playingFlag = true
    first.events.onplay()
    await wait(45)
    assert.equal(f.instances.length, 2)
    assert.equal(f.instances[0].unloadCalls, 1)
  } finally { f.engine.dispose() }
})

test('Howler playerror keeps the audio instance alive until an unlock event', async () => {
  const f = createFixture()
  try {
    f.engine.play()
    await wait()
    const audio = f.instances[0]
    audio.events.onplayerror(1, 'autoplay blocked')
    assert.equal(f.engine.status, 'buffering')
    assert.equal(audio.unloadCalls, 0)
    assert.equal(typeof audio.unlocked, 'function')
    audio.unlocked()
    assert.equal(audio.playCalls, 2)
    audio.playingFlag = true
    audio.events.onplay()
    assert.equal(f.engine.status, 'playing')
  } finally { f.engine.dispose() }
})

test('obsolete authorization cannot start media after selection is replaced', async () => {
  let authorize
  const gate = new Promise((resolve) => { authorize = resolve })
  const f = createFixture({ authorize: () => gate })
  f.engine.play()
  f.engine.dispose()
  authorize()
  await wait()
  assert.equal(f.instances.length, 0)
})

test('track hydration always prefers native AppData URLs over old browser state', () => {
  const legacy = { id: 'native:C:\\Music\\song.mp3', filePath: 'C:\\Music\\song.mp3', audioUrl: 'blob:expired', title: 'old', duration: 20 }
  const authoritative = { ...legacy, audioUrl: 'asset://fresh', title: 'saved' }
  const pending = { id: 'native:C:\\Music\\new.mp3', filePath: 'C:\\Music\\new.mp3', audioUrl: 'asset://pending', title: 'new', duration: 10 }
  const tracks = mergeHydratedLibraryTracks([authoritative], [legacy, pending])
  const restored = tracks.find((track) => track.id === authoritative.id)
  assert.equal(restored.title, 'saved')
  assert.equal(restored.audioUrl, 'C:\\Music\\song.mp3') // Rebuilt deterministically from native filePath in non-Tauri tests.
  assert.equal(tracks.length, 2)
})

test('restart chooses a playable saved song, not a dangling current track ID', () => {
  const tracks = [
    { id: 'placeholder', title: 'unmatched', audioUrl: undefined },
    { id: 'good', title: 'saved track', audioUrl: 'http://asset.localhost/song.mp3' },
  ]
  assert.equal(restorePlayableTrackId(tracks, 'deleted', 'placeholder'), 'good')
  assert.equal(restorePlayableTrackId(tracks, 'good', 'placeholder'), 'good')
  assert.equal(restorePlayableTrackId(tracks, 'placeholder', 'good'), 'good')
  assert.equal(restorePlayableTrackId([tracks[0]], 'placeholder'), undefined)
})


test('play recreates a non-null Howl whose state became unloaded', async () => {
  const f = createFixture()
  try {
    await wait()
    assert.equal(f.instances.length, 1)
    f.instances[0].currentState = 'unloaded'
    f.engine.play()
    await wait()
    assert.equal(f.instances.length, 2)
    assert.equal(f.instances[1].playCalls, 1)
  } finally { f.engine.dispose() }
})

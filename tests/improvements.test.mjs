import test from 'node:test'
import assert from 'node:assert/strict'
import { findMissingTrackIds, isPathInside, normalizePathForCompare } from '../src/utils/missingTracks.ts'
import { shouldIgnoreShortcut } from '../src/utils/shortcutGuard.ts'
import { queueSqliteSave } from '../src/utils/desktopDatabase.ts'
import { pruneOrphanArtwork, referencedArtworkNames, statFingerprint } from '../src/utils/artworkStorage.ts'

const DAY = 24 * 60 * 60 * 1000
const track = (id, filePath, extra = {}) => ({ id, title: id, artist: '', album: '', duration: 0, fileName: id, accent: '#000', filePath, ...extra })

// ---------- missing tracks ----------
test('path comparison ignores case and separator style on Windows paths', () => {
  assert.equal(normalizePathForCompare('C:\\Music\\Song.MP3'), 'c:/music/song.mp3')
  assert.ok(isPathInside('C:\\Music\\Rock\\a.mp3', 'c:/music'))
  assert.ok(isPathInside('c:/music/a.mp3', 'C:\\Music\\'))
})

test('a sibling folder with the same prefix is not "inside" the music folder', () => {
  assert.equal(isPathInside('C:\\Music2\\a.mp3', 'C:\\Music'), false)
})

test('only tracks inside the scanned folder that were not found are reported missing', () => {
  const tracks = [
    track('kept', 'C:\\Music\\kept.mp3'),
    track('gone', 'C:\\Music\\Rock\\gone.mp3'),
    track('moved-case', 'C:\\Music\\Same.mp3'),
    track('elsewhere', 'D:\\Other\\elsewhere.mp3'),
    track('no-path', undefined),
  ]
  const scanned = ['c:/music/kept.mp3', 'C:\\MUSIC\\same.mp3']
  assert.deepEqual(findMissingTrackIds(tracks, scanned, 'C:\\Music'), ['gone'])
})

// ---------- keyboard guard ----------
const key = (overrides = {}) => ({
  key: 'm', code: 'KeyM', ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
  target: { tagName: 'DIV', isContentEditable: false, closest: () => null }, ...overrides,
})

test('plain keys on the page trigger shortcuts', () => {
  assert.equal(shouldIgnoreShortcut(key()), false)
})

test('browser/OS combinations are never hijacked', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(shouldIgnoreShortcut(key({ key: 'r', code: 'KeyR', [mod]: true })), true, mod)
  }
})

test('typing in fields and already-handled keys are ignored', () => {
  assert.equal(shouldIgnoreShortcut(key({ target: { tagName: 'INPUT', closest: () => null } })), true)
  assert.equal(shouldIgnoreShortcut(key({ target: { tagName: 'DIV', isContentEditable: true, closest: () => null } })), true)
  assert.equal(shouldIgnoreShortcut(key({ defaultPrevented: true })), true)
})

test('Space on a focused button keeps its native meaning but still plays elsewhere', () => {
  const onButton = { tagName: 'BUTTON', closest: (sel) => (sel.includes('button') ? {} : null) }
  assert.equal(shouldIgnoreShortcut(key({ key: ' ', code: 'Space', target: onButton })), true)
  assert.equal(shouldIgnoreShortcut(key({ key: ' ', code: 'Space' })), false)
  // other keys are still allowed while a button has focus
  assert.equal(shouldIgnoreShortcut(key({ target: onButton })), false)
})

test('dialogs and menus keep their own keyboard handling', () => {
  const inDialog = { tagName: 'DIV', closest: (sel) => (sel.includes('dialog') ? {} : null) }
  assert.equal(shouldIgnoreShortcut(key({ key: 'ArrowDown', code: 'ArrowDown', target: inDialog })), true)
})

test('hardware media keys always work, even inside fields or with modifiers', () => {
  const input = { tagName: 'INPUT', closest: () => ({}) }
  assert.equal(shouldIgnoreShortcut(key({ key: 'MediaTrackNext', code: 'MediaTrackNext', target: input })), false)
})

// ---------- serialized native SQLite saves ----------
test('SQLite saves remain ordered when earlier writes are slow', async () => {
  const events = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const writer = async (json) => {
    events.push('start:' + json)
    if (json === 'one') await gate
    events.push('end:' + json)
  }
  const first = queueSqliteSave('one', writer)
  const second = queueSqliteSave('two', writer)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['start:one'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(events, ['start:one', 'end:one', 'start:two', 'end:two'])
})

test('SQLite write failures are propagated without blocking later saves', async () => {
  await assert.rejects(
    queueSqliteSave('broken', async () => { throw new Error('disk full') }),
    /disk full/,
  )
  const events = []
  await queueSqliteSave('new', async (json) => { events.push(json) })
  assert.deepEqual(events, ['new'])
})

// ---------- artwork cache ----------
test('stat fingerprint changes when size or modified time changes, and is stable otherwise', () => {
  assert.equal(statFingerprint(100, 5000), statFingerprint(100, 5000))
  assert.notEqual(statFingerprint(100, 5000), statFingerprint(101, 5000))
  assert.notEqual(statFingerprint(100, 5000), statFingerprint(100, 5001))
})

test('referenced artwork names are read from paths and Windows asset URLs, ignoring temporary URLs', () => {
  const names = referencedArtworkNames(
    [
      { coverPath: 'C:\\Users\\me\\AppData\\Roaming\\app\\artwork\\Folder_A_1f.JPG' },
      { coverUrl: 'http://asset.localhost/C%3A%5CUsers%5Cme%5Cartwork%5Cpool_b.png?x=1' },
      { coverUrl: 'blob:http://localhost/abc' },
      { coverUrl: 'data:image/png;base64,AAAA' },
      {},
    ],
    ['C:\\x\\artwork\\extra.webp'],
  )
  assert.deepEqual([...names].sort(), ['extra.webp', 'folder_a_1f.jpg', 'pool_b.png'])
})

function pruneDeps(files) {
  const removed = []
  return {
    removed,
    listFiles: async () => Object.keys(files),
    modifiedAt: async (name) => files[name],
    remove: async (name) => { removed.push(name) },
  }
}

test('cleanup removes only old, unreferenced artwork', async () => {
  const now = 100 * DAY
  const deps = pruneDeps({
    'used-old.jpg': now - 90 * DAY, // referenced -> keep
    'orphan-old.jpg': now - 90 * DAY, // unreferenced + old -> remove
    'orphan-new.jpg': now - 2 * DAY, // unreferenced but recent -> keep
    'unknown-mtime.jpg': null, // cannot tell how old -> keep
  })
  const count = await pruneOrphanArtwork(new Set(['used-old.jpg']), deps, now)
  assert.equal(count, 1)
  assert.deepEqual(deps.removed, ['orphan-old.jpg'])
})

test('cleanup is case-insensitive about references and survives a missing folder or a failing delete', async () => {
  const now = 100 * DAY
  const deps = pruneDeps({ 'Used.JPG': now - 90 * DAY })
  assert.equal(await pruneOrphanArtwork(new Set(['used.jpg']), deps, now), 0)

  const noFolder = { listFiles: async () => { throw new Error('ENOENT') }, modifiedAt: async () => 0, remove: async () => {} }
  assert.equal(await pruneOrphanArtwork(new Set(), noFolder, now), 0)

  const flaky = {
    listFiles: async () => ['a.jpg', 'b.jpg'],
    modifiedAt: async () => now - 90 * DAY,
    remove: async (name) => { if (name === 'a.jpg') throw new Error('in use') },
  }
  assert.equal(await pruneOrphanArtwork(new Set(), flaky, now), 1) // b.jpg still removed
})

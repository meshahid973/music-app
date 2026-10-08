import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybackQueue } from '../src/utils/queue.ts'
import { trackIdForFile } from '../src/utils/trackIdentity.ts'
import { objectUrlForFile, revokeOwnedObjectUrls } from '../src/utils/objectUrls.ts'
import { readID3Metadata, detectSongAndArtist } from '../src/utils/metadata.ts'
import { uniqueTracks, tracksFromFiles } from '../src/utils/library.ts'

function fileInfo(path = 'album/song.mp3') {
  return { name: 'song.mp3', size: 123, lastModified: 42, webkitRelativePath: path }
}

test('stable IDs survive reordered imports and distinguish folders', () => {
  assert.equal(trackIdForFile(fileInfo()), trackIdForFile(fileInfo()))
  assert.notEqual(trackIdForFile(fileInfo()), trackIdForFile(fileInfo('other/song.mp3')))
  const file = fileInfo()
  const second = { ...file, lastModified: file.lastModified + 1 }
  assert.notEqual(trackIdForFile(file), trackIdForFile(second))
})

test('duplicate filtering works within an incoming batch', () => {
  const a = { id: 'same' }
  const b = { id: 'other' }
  assert.deepEqual(uniqueTracks([], [a, a, b, b]).map(x => x.id), ['same', 'other'])
  assert.deepEqual(uniqueTracks([a], [a, b]).map(x => x.id), ['other'])
})

test('object URLs are reused until session cleanup', () => {
  const file = new File(['content'], 'song.mp3', { type: 'audio/mpeg', lastModified: 14 })
  const same = new File(['content'], 'song.mp3', { type: 'audio/mpeg', lastModified: 14 })
  const url = objectUrlForFile(file)
  assert.equal(objectUrlForFile(same), url)
  revokeOwnedObjectUrls()
  assert.notEqual(objectUrlForFile(file), url)
  revokeOwnedObjectUrls()
})

test('existing files are rejected before metadata or duration extraction', async () => {
  const file = new File(['fake'], 'song.mp3', { type: 'audio/mpeg', lastModified: 14 })
  const tracks = await tracksFromFiles([file], new Map(), new Set([trackIdForFile(file)]))
  assert.deepEqual(tracks, [])
})

test('shuffle does not repeat until available tracks have played', () => {
  const queue = new PlaybackQueue()
  queue.start(['a', 'b', 'c'], 'a')
  const next = queue.next('a', true, 'off', false, () => 0)
  const third = queue.next(next, true, 'off', false, () => 0)
  assert.equal(new Set(['a', next, third]).size, 3)
  assert.equal(queue.next(third, true, 'off'), undefined)
  assert.equal(queue.previous(third, true, 'off'), next)
  assert.equal(queue.next(next, true, 'off'), third)
})

test('repeat modes and manual Next have distinct behavior', () => {
  const queue = new PlaybackQueue()
  queue.start(['a','b'], 'a')
  assert.equal(queue.next('a',false,'one',true),'a')
  assert.equal(queue.next('a',false,'one',false),'b')
  assert.equal(queue.next('b',false,'off'),undefined)
  assert.equal(queue.next('b',false,'all'),'a')
  assert.equal(queue.previous('a',false,'all'),'b')
})

test('active search does not alter the saved queue', () => {
  const queue = new PlaybackQueue()
  queue.start(['a','b','c'],'a')
  assert.equal(queue.next('a',false,'off'),'b')
})

function synchsafe(n) { return [(n >>> 21)&127,(n>>>14)&127,(n>>>7)&127,n&127] }
function makeTag(version, title, artist) {
  const buildFrame = (name, value) => {
    const data = Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')])
    const size = version === 2 ? Buffer.from([(data.length>>>16)&255,(data.length>>>8)&255,data.length&255]) :
      Buffer.from(version === 4 ? synchsafe(data.length) : [(data.length>>>24)&255,(data.length>>>16)&255,(data.length>>>8)&255,data.length&255])
    return Buffer.concat([Buffer.from(name), size, ...(version === 2 ? [] : [Buffer.from([0,0])]),data])
  }
  const body = Buffer.concat([buildFrame(version === 2 ? 'TT2':'TIT2',title),buildFrame(version === 2 ? 'TP1':'TPE1',artist)])
  const header = Buffer.from([73,68,51,version,0,0,...synchsafe(body.length)])
  return new File([Buffer.concat([header,body])],'track.mp3',{type:'audio/mpeg'})
}

for (const version of [2,3,4]) {
  test(`ID3v2.${version} title and artist metadata`, async () => {
    const result = await readID3Metadata(makeTag(version, 'My Track', 'My Artist'))
    assert.equal(result?.title, 'My Track')
    assert.equal(result?.artist, 'My Artist')
  })
}

test('parses audio filename when no tags are available', () => {
  assert.deepEqual(detectSongAndArtist('Artist - Title.mp3'), { title:'Title', artist:'Artist' })
})

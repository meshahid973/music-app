import test from 'node:test'
import assert from 'node:assert/strict'
import { PlaybackQueue } from '../src/utils/queue.ts'
import { trackIdForFile } from '../src/utils/trackIdentity.ts'
import { objectUrlForFile, revokeOwnedObjectUrls } from '../src/utils/objectUrls.ts'
import { readID3Metadata, detectSongAndArtist, autoDetectTrackMetadata } from '../src/utils/metadata.ts'
import { uniqueTracks, tracksFromFiles } from '../src/utils/library.ts'
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

function createMockReader(data) {
  let offset = 0
  let closed = false
  let totalBytesRead = 0
  return {
    async stat() {
      return { size: data.length }
    },
    async read(buffer) {
      if (closed) throw new Error('Reader is closed')
      if (offset >= data.length) return null
      const bytesToRead = Math.min(buffer.length, data.length - offset)
      buffer.set(data.subarray(offset, offset + bytesToRead))
      offset += bytesToRead
      totalBytesRead += bytesToRead
      return bytesToRead
    },
    async close() {
      closed = true
    },
    get totalBytesRead() {
      return totalBytesRead
    },
    get isClosed() {
      return closed
    },
  }
}

test('parseId3Header validates ID3 header and detects tag size safely', () => {
  // Valid ID3v2.3 header with 1024 bytes body
  const validHeader = new Uint8Array([73, 68, 51, 3, 0, 0, ...synchsafe(1024)])
  const parsed = parseId3Header(validHeader)
  assert.equal(parsed.isValid, true)
  assert.equal(parsed.version, 3)
  assert.equal(parsed.tagBodySize, 1024)
  assert.equal(parsed.totalTagSize, 1034)

  // Header shorter than 10 bytes
  assert.equal(parseId3Header(new Uint8Array([73, 68, 51])).isValid, false)

  // Header without ID3 magic
  assert.equal(parseId3Header(new Uint8Array(10)).isValid, false)

  // Unsupported version (e.g. ID3v2.5)
  assert.equal(parseId3Header(new Uint8Array([73, 68, 51, 5, 0, 0, 0, 0, 1, 0])).isValid, false)

  // Invalid synchsafe integer with bit 7 set in size
  assert.equal(parseId3Header(new Uint8Array([73, 68, 51, 3, 0, 0, 0x80, 0, 0, 1])).isValid, false)

  // ID3v2.4 with footer flag accounts for 10-byte footer
  const footerHeader = new Uint8Array([73, 68, 51, 4, 0, 0x10, ...synchsafe(200)])
  const parsedFooter = parseId3Header(footerHeader)
  assert.equal(parsedFooter.isValid, true)
  assert.equal(parsedFooter.totalTagSize, 220) // 10 header + 200 body + 10 footer
})

test('bounded reader reads only 10 bytes and stops when no ID3 tag exists', async () => {
  // Simulate a 5 MB audio file starting with MP3 sync frame (no ID3 tag)
  const fileData = new Uint8Array(5 * 1024 * 1024)
  fileData[0] = 0xff
  fileData[1] = 0xfb
  const mockReader = createMockReader(fileData)

  const result = await readBoundedMetadataFromReader(mockReader)
  assert.equal(result, null)
  // Only the initial 10-byte header should have been read from disk, not the 5MB audio!
  assert.equal(mockReader.totalBytesRead, 10)
  assert.equal(mockReader.isClosed, true)
})

test('bounded reader reads only declared tag region without reading audio data', async () => {
  // Tag size: 256 bytes body + 10 byte header = 266 bytes total
  const tagHeader = new Uint8Array([73, 68, 51, 3, 0, 0, ...synchsafe(256)])
  const fullFile = new Uint8Array(4 * 1024 * 1024) // 4 MB audio file
  fullFile.set(tagHeader, 0)
  // Fill tag body with dummy bytes
  for (let i = 10; i < 266; i++) fullFile[i] = 42

  const mockReader = createMockReader(fullFile)
  const result = await readBoundedMetadataFromReader(mockReader)

  assert.notEqual(result, null)
  assert.equal(result?.length, 266)
  // Total bytes read must be exactly the tag size (266 bytes), never loading the full 4MB file!
  assert.equal(mockReader.totalBytesRead, 266)
  assert.equal(mockReader.isClosed, true)
})

test('bounded reader enforces MAX_METADATA_BYTES limit on oversized tags', async () => {
  // Declare an oversized tag of 10 MB in a 12 MB file
  const oversizedTagSize = 10 * 1024 * 1024
  const tagHeader = new Uint8Array([73, 68, 51, 3, 0, 0, ...synchsafe(oversizedTagSize)])
  const fullFile = new Uint8Array(12 * 1024 * 1024)
  fullFile.set(tagHeader, 0)

  const mockReader = createMockReader(fullFile)
  const result = await readBoundedMetadataFromReader(mockReader, MAX_METADATA_BYTES)

  assert.notEqual(result, null)
  assert.equal(result?.length, MAX_METADATA_BYTES)
  assert.equal(mockReader.totalBytesRead, MAX_METADATA_BYTES)
  assert.equal(mockReader.isClosed, true)
})

test('extracts title, artist, album, and embedded artwork from bounded tag bytes', async () => {
  const buildFrame = (name, value) => {
    const data = Buffer.concat([Buffer.from([3]), Buffer.from(value, 'utf8')])
    const size = Buffer.from([(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255])
    return Buffer.concat([Buffer.from(name), size, Buffer.from([0, 0]), data])
  }

  // APIC frame with JPEG cover
  const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])
  const mime = Buffer.from('image/jpeg\0', 'ascii')
  const apicBody = Buffer.concat([Buffer.from([0]), mime, Buffer.from([3, 0]), fakeJpeg])
  const apicSize = Buffer.from([(apicBody.length >>> 24) & 255, (apicBody.length >>> 16) & 255, (apicBody.length >>> 8) & 255, apicBody.length & 255])
  const apicFrame = Buffer.concat([Buffer.from('APIC'), apicSize, Buffer.from([0, 0]), apicBody])

  const body = Buffer.concat([
    buildFrame('TIT2', 'Bounded Song'),
    buildFrame('TPE1', 'Bounded Artist'),
    buildFrame('TALB', 'Bounded Album'),
    apicFrame,
  ])
  const header = Buffer.from([73, 68, 51, 3, 0, 0, ...synchsafe(body.length)])
  const tagBytes = new Uint8Array(Buffer.concat([header, body]))

  const detected = await autoDetectTrackMetadata('test_audio.mp3', tagBytes)
  assert.equal(detected.title, 'Bounded Song')
  assert.equal(detected.artist, 'Bounded Artist')
  assert.equal(detected.album, 'Bounded Album')
  assert.notEqual(detected.coverBytes, undefined)
  assert.equal(detected.coverMime, 'image/jpeg')
  assert.deepEqual(Array.from(detected.coverBytes || []), Array.from(fakeJpeg))
})

test('sanitizeTrackForPersistence strips temporary blob and data URLs while preserving coverPath', () => {
  const trackWithBlob = {
    id: 'native:song1.mp3',
    title: 'Song One',
    artist: 'Artist One',
    album: 'Album One',
    duration: 180,
    fileName: 'song1.mp3',
    audioUrl: 'asset://song1.mp3',
    filePath: '/music/song1.mp3',
    coverUrl: 'blob:http://localhost:3000/temp-uuid-1234',
    coverPath: '/appdata/artwork/song1.jpg',
    coverSource: 'embedded',
    accent: '#ffffff',
  }

  const sanitized = sanitizeTrackForPersistence(trackWithBlob)
  assert.equal(sanitized.coverUrl, undefined)
  assert.equal(sanitized.coverPath, '/appdata/artwork/song1.jpg')

  const trackWithDataUrl = {
    ...trackWithBlob,
    coverUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  }
  const sanitizedData = sanitizeTrackForPersistence(trackWithDataUrl)
  assert.equal(sanitizedData.coverUrl, undefined)
  assert.equal(sanitizedData.coverPath, '/appdata/artwork/song1.jpg')

  const batch = sanitizeTracksForPersistence([trackWithBlob, trackWithDataUrl])
  assert.equal(batch[0].coverUrl, undefined)
  assert.equal(batch[1].coverUrl, undefined)
})

test('hydrateTrackArtwork regenerates artwork and audio URLs from durable file paths', () => {
  const savedTrack = {
    id: 'native:song.mp3',
    title: 'Persisted Song',
    artist: 'Persisted Artist',
    album: 'Persisted Album',
    duration: 200,
    fileName: 'song.mp3',
    audioUrl: 'stale-or-empty',
    filePath: '/music/album/song.mp3',
    coverUrl: 'blob:stale-blob-url',
    coverPath: '/music/album/cover.jpg',
    coverSource: 'direct',
    accent: '#ff0000',
  }

  const hydrated = hydrateTrackArtwork(savedTrack)
  assert.notEqual(hydrated.coverUrl, undefined)
  assert.equal(hydrated.coverUrl.startsWith('blob:'), false)
  // URL regenerated from durable coverPath
  assert.equal(hydrated.coverPath, '/music/album/cover.jpg')
  assert.equal(hydrated.audioUrl, '/music/album/song.mp3') // in test environment toNativeAssetUrl returns path

  // When track has stale blob and no coverPath, dead blob is cleared
  const trackNoCoverPath = {
    ...savedTrack,
    coverPath: undefined,
    coverUrl: 'blob:dead-link',
  }
  const hydratedNoPath = hydrateTrackArtwork(trackNoCoverPath)
  assert.equal(hydratedNoPath.coverUrl, undefined)

  const hydratedBatch = hydrateTracksArtwork([savedTrack, trackNoCoverPath])
  assert.equal(hydratedBatch[0].coverPath, '/music/album/cover.jpg')
  assert.equal(hydratedBatch[1].coverUrl, undefined)
})

test('user-selected custom artwork survives serialization and deserialization lifecycle', () => {
  const editedTrack = {
    id: 'native:custom.mp3',
    title: 'Custom Art Song',
    artist: 'Custom Artist',
    album: 'Custom Album',
    duration: 150,
    fileName: 'custom.mp3',
    audioUrl: 'asset://custom.mp3',
    filePath: '/music/custom.mp3',
    coverUrl: 'asset:///appdata/artwork/custom_my_song.png',
    coverPath: '/appdata/artwork/custom_my_song.png',
    coverSource: 'custom',
    accent: '#00ff00',
  }

  // 1. Save flow (sanitization)
  const toSave = sanitizeTrackForPersistence(editedTrack)
  assert.equal(toSave.coverPath, '/appdata/artwork/custom_my_song.png')

  // Simulate JSON persistence to disk
  const serialized = JSON.stringify(toSave)
  const parsed = JSON.parse(serialized)

  // 2. Load flow (hydration)
  const rehydrated = hydrateTrackArtwork(parsed)
  assert.equal(rehydrated.coverPath, '/appdata/artwork/custom_my_song.png')
  assert.notEqual(rehydrated.coverUrl, undefined)
  assert.equal(rehydrated.coverSource, 'custom')
})

test('artwork removal clears both coverUrl and coverPath and prevents resurrection', () => {
  const trackWithoutCover = {
    id: 'native:nocover.mp3',
    title: 'No Cover Song',
    artist: 'Artist',
    album: 'Album',
    duration: 120,
    fileName: 'nocover.mp3',
    audioUrl: 'asset://nocover.mp3',
    filePath: '/music/nocover.mp3',
    coverUrl: undefined,
    coverPath: undefined,
    coverSource: undefined,
    accent: '#111111',
  }

  const sanitized = sanitizeTrackForPersistence(trackWithoutCover)
  assert.equal(sanitized.coverUrl, undefined)
  assert.equal(sanitized.coverPath, undefined)

  const hydrated = hydrateTrackArtwork(sanitized)
  assert.equal(hydrated.coverUrl, undefined)
  assert.equal(hydrated.coverPath, undefined)
})

test('sanitizeArtworkFilename produces safe deterministic filesystem paths', () => {
  const name1 = sanitizeArtworkFilename('native:C:\\Music\\Song #1 [Remastered].mp3')
  const name2 = sanitizeArtworkFilename('native:C:\\Music\\Song #1 [Remastered].mp3')
  assert.equal(name1, name2)
  assert.equal(/^[a-zA-Z0-9_-]+$/.test(name1), true)
  assert.equal(name1.length <= 48, true)
})

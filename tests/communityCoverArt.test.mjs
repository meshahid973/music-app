import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAllowedArtworkApiUrl,\n  artworkLoadErrorMessage,\n  isSaveDialogCancelled,
  isArtworkId,
  sanitizeArtworkFilename,
  validateArtworkResponse,
} from '../src/utils/communityCoverArt.ts'

test('artwork IDs reject traversal and unsafe characters', () => {
  assert.equal(isArtworkId('original-cover_02'), true)
  assert.equal(isArtworkId('../secret'), false)
  assert.equal(isArtworkId('cover%2fsecret'), false)
})

test('filename sanitization removes Windows path and reserved characters', () => {
  assert.equal(sanitizeArtworkFilename('../A:B? *', 'jpeg'), 'AB.jpg')
  assert.equal(sanitizeArtworkFilename('...', 'webp'), 'community-cover.webp')
  assert.equal(sanitizeArtworkFilename('CON', 'png'), '_CON.png')
})

test('API URL accepts HTTPS workers.dev only', () => {
  assert.equal(isAllowedArtworkApiUrl('https://resonance.example.workers.dev'), true)
  assert.equal(isAllowedArtworkApiUrl('http://resonance.example.workers.dev'), false)
  assert.equal(isAllowedArtworkApiUrl('https://attacker.example/api'), false)
})

test('download validation checks MIME, size and image signature', () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
  assert.equal(validateArtworkResponse(png, 'image/png', 'png'), null)
  assert.match(validateArtworkResponse(png, 'image/jpeg', 'jpeg') || '', /format/)
  assert.match(validateArtworkResponse(new Uint8Array(), 'image/png', 'png') || '', /empty/)
  assert.match(validateArtworkResponse(new Uint8Array(15 * 1024 * 1024 + 1), 'image/png', 'png') || '', /15 MiB/)
})

test('offline errors are described without affecting the local library', () => {
  assert.match(artworkLoadErrorMessage(new TypeError('fetch failed')), /connection/)
  assert.equal(artworkLoadErrorMessage(new Error('bad response')), 'bad response')
})

test('save dialog cancellation is a quiet no-op', () => {
  assert.equal(isSaveDialogCancelled(null), true)
  assert.equal(isSaveDialogCancelled(''), true)
  assert.equal(isSaveDialogCancelled('C:\\\\Art\\\\cover.png'), false)
})

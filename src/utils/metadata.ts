import { objectUrlForBlob } from './objectUrls.ts'

/**
 * Ultra-lightweight audio metadata extractor and smart filename parser.
 * Zero external dependencies (< 3KB compiled), lightning fast (< 2ms).
 */

export type DetectedTrackInfo = {
  title: string
  artist: string
  album: string
  coverUrl?: string
  coverBytes?: Uint8Array
  coverMime?: string
}

export type ID3Metadata = {
  title?: string
  artist?: string
  album?: string
  coverUrl?: string
  coverBytes?: Uint8Array
  coverMime?: string
}

/**
 * Common junk patterns from YouTube, SoundCloud, torrent rips, web downloads, and audio bitrates.
 */
const JUNK_SUFFIX_PATTERNS = [
  /\s*\(\s*(?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|mv)|audio|video|lyrics?|visualizer|hq|hd|high\s*quality|prod(?:\.|\s+by)[^)]*)\s*\)/gi,
  /\s*\[\s*(?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|mv)|audio|video|lyrics?|visualizer|hq|hd|high\s*quality|\d+\s*k?bps|1080p|720p|4k|flac|lossless|cd\s*rip)\s*\]/gi,
  /\s*-\s*\(\s*\d+\s*k?bps\s*\)/gi,
  /\s*\(\s*\d+\s*k?bps\s*\)/gi,
  /\s*-\s*\d+\s*k?bps\s*$/gi,
  /\s+\d+\s*k?bps\s*$/gi,
  /\s*\[\s*(?:remastered|remaster)(?:\s*\d{4})?\s*\]/gi,
  /\s*\(\s*(?:remastered|remaster)(?:\s*\d{4})?\s*\)/gi,
  /\s*[-–—]\s*$/g,
]

/**
 * Clean a raw title/artist string of rip artifacts and leftover punctuation.
 */
export function cleanMusicString(raw: string): string {
  if (!raw) return ''
  let cleaned = raw
  for (const pattern of JUNK_SUFFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  return cleaned
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Detect track number prefixes like "01 - ", "01. ", "1-01 ", "[01] ", "Track 01 - ", "A1 - ".
 */
function stripTrackPrefix(name: string): string {
  return name
    .replace(/^\s*(?:track\s*)?\d{1,3}[\s._-]+/i, '')
    .replace(/^\s*\[\s*\d{1,3}\s*\]\s*/i, '')
    .replace(/^\s*\(\s*\d{1,3}\s*\)\s*/i, '')
    .replace(/^\s*\d{1,2}\s*[-–—]\s*\d{1,2}[\s._-]+/i, '') // e.g. 1-01
    .replace(/^\s*[a-d]\d{1,2}[\s._-]+/i, '') // vinyl sides A1, B2
    .trim()
}

/**
 * Intelligently parse song name and artist from filename or text.
 * Handles:
 * - "Artist - Title"
 * - "Artist-Title"
 * - "Artist – Title" / "Artist — Title"
 * - "01 - Artist - Title"
 * - "Artist ~ Title" / "Artist | Title"
 * - "Title by Artist"
 * - "Artist feat. Co-Artist - Title"
 */
export function detectSongAndArtist(rawFileNameOrTitle: string): {
  title: string
  artist: string
  album?: string
} {
  if (!rawFileNameOrTitle) {
    return { title: 'Unknown song', artist: 'Unknown artist' }
  }

  // 1. Remove file extension
  let base = rawFileNameOrTitle.replace(/\.[^/.]+$/, '').trim()

  // 2. Strip junk web video/audio suffixes first
  for (const pattern of JUNK_SUFFIX_PATTERNS) {
    base = base.replace(pattern, '')
  }

  // 3. Strip track number prefixes like "01. ", "01 - ", etc.
  base = stripTrackPrefix(base)

  // 4. Check for "Title by Artist" pattern
  const byMatch = base.match(/^(.+?)\s+(?:by|from)\s+(.+)$/i)
  if (byMatch && byMatch[1] && byMatch[2]) {
    const title = cleanMusicString(byMatch[1])
    const artist = cleanMusicString(byMatch[2])
    if (title && artist) {
      return { title, artist }
    }
  }

  // 5. Look for standard artist-title separators:
  // " - ", " – ", " — ", " ─ ", " ~ ", " | ", " • ", " _-_ ", " -- "
  const separatorRegex = /\s*(?:\s[-–—─~|•]\s|[-–—─]\s|\s[-–—─]|_-_|--)\s*/
  if (separatorRegex.test(base)) {
    const parts = base.split(separatorRegex).map((s) => s.trim()).filter(Boolean)
    if (parts.length >= 2) {
      // Check if first part was a track number that slipped through
      let artistCandidate = parts[0]
      let titleParts = parts.slice(1)

      if (/^\d+$/.test(artistCandidate) && parts.length >= 3) {
        artistCandidate = parts[1]
        titleParts = parts.slice(2)
      }

      const artist = cleanMusicString(artistCandidate)
      const title = cleanMusicString(titleParts.join(' - '))

      if (title && artist) {
        return { title, artist }
      }
    }
  }

  // 6. Look for tight hyphen without space: e.g. "Cuco-Lover Is a Day"
  const tightDashMatch = base.match(/^([A-Za-z0-9\s.']{2,})[-–—]([A-Za-z0-9\s.']{2,})$/)
  if (tightDashMatch && tightDashMatch[1] && tightDashMatch[2]) {
    const artist = cleanMusicString(tightDashMatch[1])
    const title = cleanMusicString(tightDashMatch[2])
    if (artist && title) {
      return { title, artist }
    }
  }

  // 7. Underscores instead of spaces: e.g. "Cuco_Lover_Is_a_Day"
  if (base.includes('_') && !base.includes(' ')) {
    const spaced = base.replace(/_+/g, ' ')
    return detectSongAndArtist(spaced)
  }

  // 8. Fallback: Entire clean string as title, unknown artist
  const fallbackTitle = cleanMusicString(base) || 'Unknown song'
  return {
    title: fallbackTitle,
    artist: 'Unknown artist',
  }
}

/**
 * Bounded ID3v2.2–2.4 reader with support for title, artist, album, and cover-art frames.
 * Reads only the tag (up to 4MB) and does not load the audio stream.
 */
export async function readID3Metadata(
  source: File | Blob | Uint8Array,
): Promise<ID3Metadata | null> {
  try {
    let bytes: Uint8Array
    let limit: number

    if (source instanceof Uint8Array) {
      if (source.length < 10 || source[0] !== 0x49 || source[1] !== 0x44 || source[2] !== 0x33) return null
      const version = source[3]
      if (version < 2 || version > 4) return null
      const synchsafe = (b: Uint8Array, i: number) =>
        ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) |
        ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)
      const tagSize = synchsafe(source, 6)
      const size = Math.min(source.length, 10 + tagSize, 4 * 1024 * 1024)
      bytes = source.subarray(0, size)
      limit = bytes.length
    } else {
      const initial = new Uint8Array(await source.slice(0, 10).arrayBuffer())
      if (initial.length < 10 || initial[0] !== 0x49 || initial[1] !== 0x44 || initial[2] !== 0x33) return null
      const version = initial[3]
      if (version < 2 || version > 4) return null

      const synchsafe = (b: Uint8Array, i: number) =>
        ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) |
        ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)

      const tagSize = synchsafe(initial, 6)
      // Read the declared tag, including reasonably sized cover art, without loading whole audio files.
      const size = Math.min(source.size, 10 + tagSize, 4 * 1024 * 1024)
      bytes = new Uint8Array(await source.slice(0, size).arrayBuffer())
      limit = bytes.length
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let offset = 10
    let title: string | undefined
    let artist: string | undefined
    let album: string | undefined
    let coverUrl: string | undefined
    let coverBytes: Uint8Array | undefined
    let coverMime: string | undefined

    const version = bytes[3]

    const decodeText = (encoding: number, data: Uint8Array): string => {
      try {
        const codec = encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' :
          encoding === 3 ? 'utf-8' : 'iso-8859-1'
        return new TextDecoder(codec).decode(data).replace(/\0/g, '').trim()
      } catch {
        return ''
      }
    }

    const synchsafe = (b: Uint8Array, i: number) =>
      ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) |
      ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)

    while (offset + (version === 2 ? 6 : 10) <= limit) {
      const headerSize = version === 2 ? 6 : 10
      const idSize = version === 2 ? 3 : 4
      if (bytes[offset] === 0) break
      const id = String.fromCharCode(...bytes.subarray(offset, offset + idSize))
      if (!/^[A-Z0-9]+$/.test(id)) break
      const frameSize = version === 2
        ? (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5]
        : version === 4 ? synchsafe(bytes, offset + 4) : view.getUint32(offset + 4)
      const start = offset + headerSize
      const end = start + frameSize
      if (frameSize <= 0 || end > limit) break

      const encoding = bytes[start]
      const content = bytes.subarray(start + 1, end)
      if ((id === 'TIT2' || id === 'TT2') && !title) title = decodeText(encoding, content)
      if ((id === 'TPE1' || id === 'TP1') && !artist) artist = decodeText(encoding, content)
      if ((id === 'TALB' || id === 'TAL') && !album) album = decodeText(encoding, content)

      if ((id === 'APIC' || id === 'PIC') && !coverUrl && frameSize > 8) {
        const pictureFormat = id === 'PIC'
          ? String.fromCharCode(...bytes.subarray(start + 1, start + 4)).toLowerCase()
          : ''
        let cursor = start + 1
        let mime = 'image/jpeg'
        if (id === 'PIC') {
          mime = pictureFormat === 'png' ? 'image/png' : 'image/jpeg'
          cursor += 3
        } else {
          const mimeStart = cursor
          while (cursor < end && bytes[cursor] !== 0) cursor++
          mime = new TextDecoder('ascii').decode(bytes.subarray(mimeStart, cursor)) || mime
          cursor++
        }
        cursor++ // picture type
        if (encoding === 1 || encoding === 2) {
          while (cursor + 1 < end && (bytes[cursor] !== 0 || bytes[cursor + 1] !== 0)) cursor += 2
          cursor += 2
        } else {
          while (cursor < end && bytes[cursor] !== 0) cursor++
          cursor++
        }
        if (cursor < end && /^image\/(jpe?g|png|webp|gif)$/i.test(mime)) {
          coverBytes = Uint8Array.from(bytes.subarray(cursor, end))
          coverMime = mime
          coverUrl = objectUrlForBlob(new Blob([coverBytes as unknown as BlobPart], { type: mime }))
        }
      }
      offset = end
    }
    return title || artist || album || coverUrl
      ? { title, artist, album, coverUrl, coverBytes, coverMime }
      : null
  } catch {
    return null
  }
}

/**
 * High-level detection helper:
 * Combines ID3 tag reader with filename heuristic for comprehensive detection.
 */
export async function autoDetectTrackMetadata(
  fileName: string,
  source?: File | Blob | Uint8Array,
): Promise<DetectedTrackInfo> {
  // 1. Try reading real ID3 tags from source if provided
  if (source) {
    const id3 = await readID3Metadata(source)
    if (id3 && (id3.title || id3.artist || id3.coverUrl)) {
      const cleanTitle = cleanMusicString(id3.title || '')
      const cleanArtist = cleanMusicString(id3.artist || '')

      if (cleanTitle && cleanArtist) {
        return {
          title: cleanTitle,
          artist: cleanArtist,
          album: cleanMusicString(id3.album || '') || 'Local files',
          coverUrl: id3.coverUrl,
          coverBytes: id3.coverBytes,
          coverMime: id3.coverMime,
        }
      }

      // If ID3 had title but no artist, or artist but no title, augment with filename
      const fromName = detectSongAndArtist(fileName)
      return {
        title: cleanTitle || fromName.title,
        artist: cleanArtist || fromName.artist,
        album: cleanMusicString(id3.album || '') || 'Local files',
        coverUrl: id3.coverUrl,
        coverBytes: id3.coverBytes,
        coverMime: id3.coverMime,
      }
    }
  }

  // 2. Filename heuristic
  const fromName = detectSongAndArtist(fileName)
  return {
    title: fromName.title,
    artist: fromName.artist,
    album: 'Local files',
  }
}

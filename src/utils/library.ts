import type { CoverLookup, Track } from '../types'

const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const coverExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif'])

export function isAudioFile(file: File) {
  return audioExtensions.has(getExtension(file.name))
}

export function isCoverFile(file: File) {
  return coverExtensions.has(getExtension(file.name))
}

export function buildCoverLookup(files: File[]) {
  return files.reduce<CoverLookup>((lookup, file) => {
    if (!isCoverFile(file)) return lookup
    lookup.set(normalizeName(file.name), URL.createObjectURL(file))
    return lookup
  }, new Map())
}

export async function tracksFromFiles(files: File[], covers: CoverLookup) {
  const audioFiles = files.filter(isAudioFile)
  const tracks = await Promise.all(
    audioFiles.map(async (file, index) => {
      const audioUrl = URL.createObjectURL(file)
      const parsed = parseTrackName(file.name)
      const duration = await readDuration(audioUrl)

      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        duration,
        fileName: file.name,
        audioUrl,
        coverUrl: covers.get(normalizeName(file.name)),
        accent: colorFromString(file.name),
      } satisfies Track
    }),
  )

  return tracks
}

export function attachCovers(tracks: Track[], covers: CoverLookup) {
  return tracks.map((track) => ({
    ...track,
    coverUrl: covers.get(normalizeName(track.fileName)) ?? track.coverUrl,
  }))
}

export function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function uniqueTracks(existing: Track[], incoming: Track[]) {
  const seen = new Set(existing.map((track) => track.id))
  return incoming.filter((track) => !seen.has(track.id))
}

function getExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function cleanDisplayTitle(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/\s*\(\s*(?:official\s*(?:video|audio|music\s*video|lyric\s*video)|audio|video|lyrics?|remastered|hq|hd)\s*\)/gi, '')
    .replace(/\s*\[\s*(?:official\s*(?:video|audio|music\s*video|lyric\s*video)|audio|video|lyrics?|remastered|hq|hd|\d+\s*k?bps)\s*\]/gi, '')
    .replace(/\s*-\s*\(\s*\d+\s*k?bps\s*\)/gi, '')
    .replace(/\s*\(\s*\d+\s*k?bps\s*\)/gi, '')
    .replace(/\s*-\s*\d+\s*k?bps\s*$/gi, '')
    .replace(/\s+\d+\s*k?bps\s*$/gi, '')
    .replace(/\s*[-–—]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function normalizeName(fileName: string) {
  return fileName
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTrackName(fileName: string) {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ')
  const [maybeArtist, ...rest] = cleanName.split(' - ')

  if (rest.length > 0) {
    return {
      artist: maybeArtist.trim(),
      title: cleanDisplayTitle(rest.join(' - ')),
      album: 'Local files',
    }
  }

  return {
    artist: 'Unknown artist',
    title: cleanDisplayTitle(cleanName),
    album: 'Local files',
  }
}

function readDuration(audioUrl: string) {
  return new Promise<number>((resolve) => {
    const audio = new Audio(audioUrl)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => resolve(audio.duration)
    audio.onerror = () => resolve(0)
  })
}

function colorFromString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash)
  }

  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 74% 58%)`
}

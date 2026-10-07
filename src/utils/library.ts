import type { CoverLookup, Track } from '../types'

const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const coverExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg'])

export function isAudioFile(file: File) {
  return audioExtensions.has(getExtension(file.name))
}

export function isCoverFile(file: File) {
  return coverExtensions.has(getExtension(file.name)) || file.type.startsWith('image/')
}

export function extractCovers(files: File[]): { lookup: CoverLookup; urls: string[] } {
  const coverFiles = files.filter(isCoverFile)
  const lookup: CoverLookup = new Map()
  const urls: string[] = []

  for (const file of coverFiles) {
    const url = URL.createObjectURL(file)
    urls.push(url)

    // Match by base filename without extension
    const baseName = normalizeName(file.name)
    if (baseName && !lookup.has(baseName)) {
      lookup.set(baseName, url)
    }

    // If file came from a directory path (webkitRelativePath), also index by parent directory name
    const relPath = file.webkitRelativePath
    if (relPath) {
      const parts = relPath.split('/').filter(Boolean)
      if (parts.length > 1) {
        const parentFolder = normalizeName(parts[parts.length - 2])
        if (parentFolder && !lookup.has(parentFolder)) {
          lookup.set(parentFolder, url)
        }
      }
    }
  }

  return { lookup, urls }
}

export function buildCoverLookup(files: File[]) {
  return extractCovers(files).lookup
}

export async function tracksFromFiles(files: File[], covers: CoverLookup) {
  const audioFiles = files.filter(isAudioFile)
  const availableCovers = Array.from(covers.values())
  let pool = [...availableCovers].sort(() => Math.random() - 0.5)
  let poolIndex = 0

  const tracks = await Promise.all(
    audioFiles.map(async (file, index) => {
      const audioUrl = URL.createObjectURL(file)
      const parsed = parseTrackName(file.name)
      const duration = await readDuration(audioUrl)

      // Direct name matches: by filename, parsed title, or clean title
      let coverUrl =
        covers.get(normalizeName(file.name)) ||
        covers.get(normalizeName(parsed.title)) ||
        covers.get(normalizeName(cleanDisplayTitle(parsed.title)))

      if (!coverUrl && availableCovers.length > 0) {
        if (poolIndex >= pool.length) {
          pool = [...availableCovers].sort(() => Math.random() - 0.5)
          poolIndex = 0
        }
        coverUrl = pool[poolIndex] || availableCovers[Math.floor(Math.random() * availableCovers.length)]
        poolIndex += 1
      }

      return {
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        duration,
        fileName: file.name,
        audioUrl,
        coverUrl,
        accent: colorFromString(file.name),
      } satisfies Track
    }),
  )

  return tracks
}

export function attachCovers(tracks: Track[], covers: CoverLookup, existingPool: string[] = []) {
  const newCovers = Array.from(covers.values())
  const allCovers = Array.from(new Set([...existingPool, ...newCovers]))
  if (allCovers.length === 0) return tracks

  let pool = [...allCovers].sort(() => Math.random() - 0.5)
  let poolIndex = 0

  return tracks.map((track) => {
    // 1. Exact name match has priority if the track does not already have an assigned cover art
    if (!track.coverUrl) {
      const directMatch =
        covers.get(normalizeName(track.fileName)) ||
        covers.get(normalizeName(track.title)) ||
        covers.get(normalizeName(cleanDisplayTitle(track.title)))

      if (directMatch) {
        return { ...track, coverUrl: directMatch }
      }
    }

    // 2. Keep existing cover if song already has one assigned
    if (track.coverUrl) {
      return track
    }

    // 3. Otherwise, assign random cover from the pool (covers may be repeated for multiple songs if no other option)
    if (poolIndex >= pool.length) {
      pool = [...allCovers].sort(() => Math.random() - 0.5)
      poolIndex = 0
    }
    const randomCover = pool[poolIndex] || allCovers[Math.floor(Math.random() * allCovers.length)]
    poolIndex += 1

    return {
      ...track,
      coverUrl: randomCover,
    }
  })
}

export function assignRandomCovers(tracks: Track[], coverPool: string[]): Track[] {
  if (coverPool.length === 0) return tracks
  let shuffled = [...coverPool].sort(() => Math.random() - 0.5)
  let index = 0

  return tracks.map((track) => {
    if (track.coverUrl) return track
    if (index >= shuffled.length) {
      shuffled = [...coverPool].sort(() => Math.random() - 0.5)
      index = 0
    }
    const coverUrl = shuffled[index] || coverPool[Math.floor(Math.random() * coverPool.length)]
    index += 1
    return { ...track, coverUrl }
  })
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

const colorCache = new Map<string, { r: number; g: number; b: number; css: string }>()

export function getAverageColor(imageUrl: string): Promise<{ r: number; g: number; b: number; css: string }> {
  if (colorCache.has(imageUrl)) {
    return Promise.resolve(colorCache.get(imageUrl)!)
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          const fallback = { r: 21, g: 23, b: 22, css: 'rgb(21, 23, 22)' }
          resolve(fallback)
          return
        }
        const size = 32
        canvas.width = size
        canvas.height = size
        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data
        let r = 0
        let g = 0
        let b = 0
        let count = 0
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3]
          if (alpha > 32) {
            r += data[i]
            g += data[i + 1]
            b += data[i + 2]
            count += 1
          }
        }
        if (count > 0) {
          r = Math.round(r / count)
          g = Math.round(g / count)
          b = Math.round(b / count)
        } else {
          r = 21
          g = 23
          b = 22
        }
        const result = { r, g, b, css: `rgb(${r}, ${g}, ${b})` }
        colorCache.set(imageUrl, result)
        resolve(result)
      } catch {
        const fallback = { r: 21, g: 23, b: 22, css: 'rgb(21, 23, 22)' }
        resolve(fallback)
      }
    }
    img.onerror = () => {
      const fallback = { r: 21, g: 23, b: 22, css: 'rgb(21, 23, 22)' }
      resolve(fallback)
    }
    img.src = imageUrl
  })
}

export function hslToRgb(hslStr: string): { r: number; g: number; b: number; css: string } {
  const match = hslStr.match(/hsl\((\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\)/)
  if (!match) return { r: 21, g: 23, b: 22, css: 'rgb(21, 23, 22)' }
  const h = Number(match[1]) / 360
  const s = Number(match[2]) / 100
  const l = Number(match[3]) / 100

  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = l
    g = l
    b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let tc = t
      if (tc < 0) tc += 1
      if (tc > 1) tc -= 1
      if (tc < 1 / 6) return p + (q - p) * 6 * tc
      if (tc < 1 / 2) return q
      if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  const red = Math.round(r * 255)
  const green = Math.round(g * 255)
  const blue = Math.round(b * 255)
  return { r: red, g: green, b: blue, css: `rgb(${red}, ${green}, ${blue})` }
}

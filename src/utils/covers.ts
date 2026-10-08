import type { CoverLookup, Track } from '../types'
import { isCoverFile } from './audioFiles.ts'
import { cleanMusicString } from './metadata.ts'
import { objectUrlForFile } from './objectUrls.ts'

export function normalizeName(fileName: string): string {
  return fileName
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractCovers(files: File[]): { lookup: CoverLookup; urls: string[] } {
  const coverFiles = files.filter(isCoverFile)
  const lookup: CoverLookup = new Map()
  const urls: string[] = []

  for (const file of coverFiles) {
    const url = objectUrlForFile(file)
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

export function buildCoverLookup(files: File[]): CoverLookup {
  return extractCovers(files).lookup
}

export function findDirectCoverMatch(
  track: { fileName: string; title: string; album?: string },
  covers: CoverLookup,
): string | undefined {
  const normFile = normalizeName(track.fileName)
  if (normFile && covers.has(normFile)) return covers.get(normFile)

  const normTitle = normalizeName(track.title)
  if (normTitle && covers.has(normTitle)) return covers.get(normTitle)

  const normCleanTitle = normalizeName(cleanMusicString(track.title))
  if (normCleanTitle && covers.has(normCleanTitle)) return covers.get(normCleanTitle)

  if (track.album && track.album !== 'Local files') {
    const normAlbum = normalizeName(track.album)
    if (normAlbum && covers.has(normAlbum)) return covers.get(normAlbum)
  }

  return undefined
}

export function assignCoversToTracks(
  existingTracks: Track[],
  incomingTracks: Track[],
  coverPool: string[],
  covers: CoverLookup = new Map(),
): Track[] {
  const allAvailableCovers = Array.from(new Set([...coverPool, ...Array.from(covers.values())]))

  const usageCounts = new Map<string, number>()
  for (const url of allAvailableCovers) {
    usageCounts.set(url, 0)
  }
  for (const track of existingTracks) {
    if (track.coverUrl && usageCounts.has(track.coverUrl)) {
      usageCounts.set(track.coverUrl, (usageCounts.get(track.coverUrl) || 0) + 1)
    }
  }

  return incomingTracks.map((track) => {
    if (track.coverUrl && track.coverSource !== 'pool') {
      if (usageCounts.has(track.coverUrl)) {
        usageCounts.set(track.coverUrl, (usageCounts.get(track.coverUrl) || 0) + 1)
      }
      return track
    }

    const directMatch = findDirectCoverMatch(track, covers)
    if (directMatch) {
      if (usageCounts.has(directMatch)) {
        usageCounts.set(directMatch, (usageCounts.get(directMatch) || 0) + 1)
      }
      return {
        ...track,
        coverUrl: directMatch,
        coverSource: 'direct' as const,
      }
    }

    if (track.coverUrl) {
      if (usageCounts.has(track.coverUrl)) {
        usageCounts.set(track.coverUrl, (usageCounts.get(track.coverUrl) || 0) + 1)
      }
      return track
    }

    if (allAvailableCovers.length === 0) {
      return track
    }

    const unusedCovers = allAvailableCovers.filter((url) => (usageCounts.get(url) || 0) === 0)
    let selectedCover: string

    if (unusedCovers.length > 0) {
      const randomIndex = Math.floor(Math.random() * unusedCovers.length)
      selectedCover = unusedCovers[randomIndex]
    } else {
      let minUsage = Infinity
      for (const url of allAvailableCovers) {
        const count = usageCounts.get(url) || 0
        if (count < minUsage) {
          minUsage = count
        }
      }
      const leastUsedCovers = allAvailableCovers.filter(
        (url) => (usageCounts.get(url) || 0) === minUsage,
      )
      const randomIndex = Math.floor(Math.random() * leastUsedCovers.length)
      selectedCover = leastUsedCovers[randomIndex]
    }

    usageCounts.set(selectedCover, (usageCounts.get(selectedCover) || 0) + 1)

    return {
      ...track,
      coverUrl: selectedCover,
      coverSource: 'pool' as const,
    }
  })
}

export function syncTracksWithCovers(
  tracks: Track[],
  covers: CoverLookup,
  coverPool: string[],
): Track[] {
  if (tracks.length === 0) return tracks

  const allAvailableCovers = Array.from(new Set([...coverPool, ...Array.from(covers.values())]))
  if (allAvailableCovers.length === 0) return tracks

  const usageCounts = new Map<string, number>()
  for (const url of allAvailableCovers) {
    usageCounts.set(url, 0)
  }

  for (const track of tracks) {
    if (
      track.coverUrl &&
      (track.coverSource === 'direct' ||
        track.coverSource === 'embedded' ||
        track.coverSource === 'custom')
    ) {
      if (usageCounts.has(track.coverUrl)) {
        usageCounts.set(track.coverUrl, (usageCounts.get(track.coverUrl) || 0) + 1)
      }
    }
  }

  const step1Tracks = tracks.map((track) => {
    if (
      track.coverSource === 'direct' ||
      track.coverSource === 'embedded' ||
      track.coverSource === 'custom'
    ) {
      return track
    }

    const directMatch = findDirectCoverMatch(track, covers)
    if (directMatch) {
      if (usageCounts.has(directMatch)) {
        usageCounts.set(directMatch, (usageCounts.get(directMatch) || 0) + 1)
      }
      return {
        ...track,
        coverUrl: directMatch,
        coverSource: 'direct' as const,
      }
    }

    return track
  })

  const seenPoolCovers = new Set<string>()
  const finalTracks: Track[] = []

  for (const track of step1Tracks) {
    if (
      track.coverSource === 'direct' ||
      track.coverSource === 'embedded' ||
      track.coverSource === 'custom'
    ) {
      finalTracks.push(track)
      continue
    }

    const currentCover = track.coverUrl
    const isDuplicate = currentCover ? seenPoolCovers.has(currentCover) : true
    const unusedCovers = allAvailableCovers.filter((url) => (usageCounts.get(url) || 0) === 0)

    if (currentCover && !isDuplicate && (!track.coverSource || track.coverSource === 'pool')) {
      seenPoolCovers.add(currentCover)
      usageCounts.set(currentCover, (usageCounts.get(currentCover) || 0) + 1)
      finalTracks.push({
        ...track,
        coverSource: 'pool',
      })
      continue
    }

    if (unusedCovers.length > 0) {
      const randomIndex = Math.floor(Math.random() * unusedCovers.length)
      const selectedCover = unusedCovers[randomIndex]
      usageCounts.set(selectedCover, (usageCounts.get(selectedCover) || 0) + 1)
      seenPoolCovers.add(selectedCover)
      finalTracks.push({
        ...track,
        coverUrl: selectedCover,
        coverSource: 'pool',
      })
    } else if (currentCover) {
      seenPoolCovers.add(currentCover)
      usageCounts.set(currentCover, (usageCounts.get(currentCover) || 0) + 1)
      finalTracks.push(track)
    } else {
      let minUsage = Infinity
      for (const url of allAvailableCovers) {
        const count = usageCounts.get(url) || 0
        if (count < minUsage) {
          minUsage = count
        }
      }
      const leastUsedCovers = allAvailableCovers.filter(
        (url) => (usageCounts.get(url) || 0) === minUsage,
      )
      const randomIndex = Math.floor(Math.random() * leastUsedCovers.length)
      const selectedCover = leastUsedCovers[randomIndex]
      usageCounts.set(selectedCover, (usageCounts.get(selectedCover) || 0) + 1)
      seenPoolCovers.add(selectedCover)
      finalTracks.push({
        ...track,
        coverUrl: selectedCover,
        coverSource: 'pool',
      })
    }
  }

  return finalTracks
}

export function attachCovers(
  tracks: Track[],
  covers: CoverLookup,
  existingPool: string[] = [],
): Track[] {
  const mergedPool = Array.from(new Set([...existingPool, ...Array.from(covers.values())]))
  return syncTracksWithCovers(tracks, covers, mergedPool)
}

export function assignRandomCovers(tracks: Track[], coverPool: string[]): Track[] {
  return assignCoversToTracks([], tracks, coverPool)
}

export function colorFromString(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash)
  }

  const neutralHues = [215, 220, 225, 200, 240, 210, 35, 45, 195]
  const hue = neutralHues[Math.abs(hash) % neutralHues.length]
  return `hsl(${hue} 14% 62%)`
}

const colorCache = new Map<string, { r: number; g: number; b: number; css: string }>()

export function getAverageColor(
  imageUrl: string,
): Promise<{ r: number; g: number; b: number; css: string }> {
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

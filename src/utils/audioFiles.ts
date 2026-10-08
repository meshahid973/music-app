import { detectSongAndArtist } from './metadata.ts'

export const audioExtensions = new Set([
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'flac',
  'aac',
  'opus',
  'webm',
  'wma',
  'alac',
  'aiff',
])

export const coverExtensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'bmp',
  'gif',
  'svg',
])

export function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function isAudioFile(file: File): boolean {
  return audioExtensions.has(getExtension(file.name)) || file.type.startsWith('audio/')
}

export function isCoverFile(file: File): boolean {
  return coverExtensions.has(getExtension(file.name)) || file.type.startsWith('image/')
}

export function parseTrackName(fileName: string) {
  const detected = detectSongAndArtist(fileName)
  return {
    title: detected.title,
    artist: detected.artist,
    album: detected.album || 'Local files',
  }
}

export function readDuration(audioUrl: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const audio = new Audio()
    let finished = false
    const finish = (duration: number) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      audio.onloadedmetadata = null
      audio.onerror = null
      audio.removeAttribute('src')
      audio.load()
      resolve(Number.isFinite(duration) ? duration : 0)
    }
    const timer = setTimeout(() => finish(0), 10000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => finish(audio.duration)
    audio.onerror = () => finish(0)
    audio.src = audioUrl
  })
}

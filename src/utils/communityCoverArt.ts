export type CoverArtCategory = 'community' | 'album'
export type CoverArtFormat = 'png' | 'jpeg' | 'webp'

export type CommunityArtwork = {
  id: string
  title: string
  creator?: string
  artist?: string
  category: CoverArtCategory
  format: CoverArtFormat
  width?: number
  height?: number
  fileSize?: number
  source: string
  licence: string
  attributionRequired?: boolean
  attribution?: string
  imageUrl: string
}

export const MAX_COVER_ART_BYTES = 15 * 1024 * 1024
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/

export function sanitizeArtworkFilename(title: string, format: CoverArtFormat): string {
  const base = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  let safe = base && base !== '.' && base !== '..' ? base : 'community-cover'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) safe = '_' + safe
  return safe + '.' + (format === 'jpeg' ? 'jpg' : format)
}

export function isArtworkId(value: string): boolean {
  return ID_PATTERN.test(value)
}

export function isAllowedArtworkApiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname.endsWith('.workers.dev') || url.hostname === 'workers.dev')
  } catch {
    return false
  }
}

export function validateArtworkResponse(
  bytes: Uint8Array,
  contentType: string,
  expectedFormat: CoverArtFormat,
): string | null {
  if (bytes.byteLength === 0) return 'The image response was empty.'
  if (bytes.byteLength > MAX_COVER_ART_BYTES) return 'This image is larger than the 15 MiB download limit.'
  const mime = contentType.split(';')[0].trim().toLowerCase()
  const expectedMime = expectedFormat === 'jpeg' ? 'image/jpeg' : `image/${expectedFormat}`
  if (mime !== expectedMime) return 'The server returned an unexpected image format.'
  const isPng = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isWebp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!(expectedFormat === 'png' && isPng) && !(expectedFormat === 'jpeg' && isJpeg) && !(expectedFormat === 'webp' && isWebp)) {
    return 'The downloaded bytes do not match a supported image file.'
  }
  return null
}

export function isSaveDialogCancelled(path: string | null): boolean {
  return path === null || path.length === 0
}

export function artworkLoadErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'Could not reach the artwork service. Check your connection and try again.'
  return error instanceof Error ? error.message : 'Could not load artwork.'
}

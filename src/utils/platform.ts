import { convertFileSrc, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export function isDesktopApp(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}

export function toNativeAssetUrl(filePath: string): string {
  try {
    if (isDesktopApp()) {
      return convertFileSrc(filePath)
    }
  } catch (err) {
    console.warn('Failed to convert native file path to asset URL:', err)
  }
  return filePath
}

export async function pickNativeAudioFiles(): Promise<string[] | null> {
  try {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: 'Audio Files',
          extensions: [
            'mp3',
            'wav',
            'ogg',
            'flac',
            'm4a',
            'aac',
            'opus',
            'webm',
            'wma',
            'alac',
            'aiff',
          ],
        },
      ],
    })
    if (!selected) return null
    return Array.isArray(selected) ? selected : [selected]
  } catch (err) {
    console.warn('Native audio file picker failed:', err)
    return null
  }
}

export async function pickNativeFolder(): Promise<string | null> {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
    })
    if (!selected) return null
    return typeof selected === 'string' ? selected : selected[0] ?? null
  } catch (err) {
    console.warn('Native folder picker failed:', err)
    return null
  }
}

export async function pickNativeImageFile(): Promise<string | null> {
  try {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'Image Files',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'gif', 'svg'],
        },
      ],
    })
    if (!selected) return null
    return typeof selected === 'string' ? selected : selected[0] ?? null
  } catch (err) {
    console.warn('Native image picker failed:', err)
    return null
  }
}

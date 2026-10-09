import { isDesktopApp, toNativeAssetUrl } from './platform.ts'
import { saveCustomArtwork } from './artworkStorage.ts'
import type { Track } from '../types.ts'

export interface ProcessTrackEditParams {
  track: Track
  title: string
  artist: string
  album: string
  coverUrl?: string
  coverPath?: string
  pendingImageSource?: string
  isDesktop?: boolean
}

export interface ProcessTrackEditResult {
  success: boolean
  updates?: Partial<Track>
  errorMessage?: string
}

export async function processTrackEdit({
  track,
  title,
  artist,
  album,
  coverUrl,
  coverPath,
  pendingImageSource,
  isDesktop = isDesktopApp(),
}: ProcessTrackEditParams): Promise<ProcessTrackEditResult> {
  let finalCoverUrl = coverUrl
  let finalCoverPath = coverPath

  if (isDesktop && pendingImageSource) {
    try {
      const saved = await saveCustomArtwork(track.id, pendingImageSource)
      if (!saved) {
        return {
          success: false,
          errorMessage: 'Failed to save custom artwork. Please check disk permissions and try again.',
        }
      }
      finalCoverPath = saved
      finalCoverUrl = toNativeAssetUrl(saved)
    } catch (err) {
      console.warn('Failed to save custom artwork:', err)
      return {
        success: false,
        errorMessage: 'Failed to save custom artwork. Please try again.',
      }
    }
  }

  return {
    success: true,
    updates: {
      title: title.trim() || track.title,
      artist: artist.trim() || track.artist,
      album: album.trim() || track.album,
      coverUrl: finalCoverUrl,
      coverPath: finalCoverUrl ? finalCoverPath : undefined,
      coverSource: finalCoverUrl ? 'custom' : undefined,
    },
  }
}

/**
 * Central library utilities re-exporting focused modules:
 * - audioFiles: audio-file detection and audio parsing
 * - covers: cover-art discovery, matching, and extraction
 * - tracks: track creation, normalization, formatting, and deduplication
 */

export {
  audioExtensions,
  coverExtensions,
  getExtension,
  isAudioFile,
  isCoverFile,
  parseTrackName,
  readDuration,
} from './audioFiles.ts'

export {
  assignCoversToTracks,
  assignRandomCovers,
  attachCovers,
  buildCoverLookup,
  colorFromString,
  extractCovers,
  findDirectCoverMatch,
  getAverageColor,
  hslToRgb,
  normalizeName,
  syncTracksWithCovers,
} from './covers.ts'

export {
  cleanDisplayTitle,
  formatTime,
  tracksFromFiles,
  uniqueTracks,
} from './tracks.ts'

export type RepeatMode = 'off' | 'one' | 'all'

export type Track = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  fileName: string
  audioUrl: string
  coverUrl?: string
  accent: string
}

export type Playlist = {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

export type CoverLookup = Map<string, string>

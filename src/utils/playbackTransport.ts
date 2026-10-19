/** Execute a transport action against real audio, not the UI's optimistic state.
 * A missing/unloaded Howl is rebuilt before another playback attempt.
 */
export interface PlaybackHandle {
  playing(): boolean
  state(): string
  play(): unknown
}

export function startPlayback(handle: PlaybackHandle | null, rebuild: () => void): void {
  if (!handle || handle.state() === 'unloaded') {
    rebuild()
    return
  }
  if (!handle.playing()) handle.play()
}

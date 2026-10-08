/** Snapshot the user's playback queue independently of search and sidebar filters. */
export class PlaybackQueue {
  private ids: string[] = []
  private history: string[] = []
  private cursor = -1
  private remaining: string[] = []
  get size() { return this.ids.length }

  start(ids: string[], current: string): void {
    this.ids = Array.from(new Set(ids))
    if (!this.ids.includes(current)) this.ids.unshift(current)
    this.history = [current]
    this.cursor = 0
    this.remaining = this.ids.filter(id => id !== current)
  }

  next(current: string, shuffle: boolean, repeat: 'off' | 'one' | 'all', automatic = false, random = Math.random): string | undefined {
    if (!this.ids.length) return undefined
    if (automatic && repeat === 'one') return current
    if (shuffle) {
      if (this.cursor < this.history.length - 1) return this.history[++this.cursor]
      if (!this.remaining.length) {
        if (repeat !== 'all') return undefined
        this.remaining = this.ids.filter(id => id !== current)
        if (!this.remaining.length) this.remaining = [current]
      }
      const position = Math.min(this.remaining.length - 1, Math.floor(Math.max(0, random()) * this.remaining.length))
      const id = this.remaining.splice(position, 1)[0]
      this.history.push(id)
      this.cursor = this.history.length - 1
      return id
    }
    const index = this.ids.indexOf(current)
    const position = index < 0 ? 0 : index + 1
    if (position < this.ids.length) return this.ids[position]
    return repeat === 'all' ? this.ids[0] : undefined
  }

  previous(current: string, shuffle: boolean, repeat: 'off' | 'one' | 'all'): string | undefined {
    if (!this.ids.length) return undefined
    if (shuffle) {
      if (this.cursor > 0) return this.history[--this.cursor]
      return current
    }
    const position = this.ids.indexOf(current)
    if (position > 0) return this.ids[position - 1]
    return position === 0 && repeat === 'all' ? this.ids[this.ids.length - 1] : current
  }
}

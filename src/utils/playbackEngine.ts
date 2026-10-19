/**
 * One playback lifecycle for the bar, CD, keyboard, queue and song rows.
 * Permission setup, media loading and play intent are deliberately separate.
 * The UI reports "playing" only after the media emits onplay.
 */
export type PlaybackPhase = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'error'

export interface AudioHandle {
  state(): string
  playing(): boolean
  play(): unknown
  pause(): unknown
  stop(): unknown
  unload(): unknown
  seek(): number | unknown
  seek(position: number): unknown
  volume(level: number): unknown
  once(event: string, callback: () => void): unknown
}

export interface AudioEvents {
  onplay: () => void
  onpause: () => void
  onend: () => void
  onload: () => void
  onloaderror: (id: number, error: unknown) => void
  onplayerror: (id: number, error: unknown) => void
}

export interface PlaybackEngineOptions {
  source: string
  authorize: () => Promise<void>
  createAudio: (events: AudioEvents) => AudioHandle
  onPhase: (phase: PlaybackPhase) => void
  onError: (message: string, error?: unknown) => void
  onEnd: () => void
  maxRetries?: number
  deadlineMs?: number
  checkEveryMs?: number
}

export class PlaybackEngine {
  private sound: AudioHandle | null = null
  private desired = false
  private disposed = false
  private attempt = 0
  private nonce = 0
  private lastProgress = 0
  private lastProgressAt = Date.now()
  private playRequestedAt = 0
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private phase: PlaybackPhase = 'idle'

  private readonly options: PlaybackEngineOptions

  constructor(options: PlaybackEngineOptions) {
    this.options = options
    if (options.source) void this.prepare()
  }

  get status(): PlaybackPhase { return this.phase }
  get audio(): AudioHandle | null { return this.sound }

  private transition(phase: PlaybackPhase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.options.onPhase(phase)
  }

  private current(nonce: number, sound?: AudioHandle | null): boolean {
    return !this.disposed && nonce === this.nonce &&
      (sound === undefined || sound === this.sound)
  }

  private async prepare(): Promise<void> {
    const nonce = ++this.nonce
    this.transition('loading')
    try {
      // Do not create/load an asset:// media element until its permission has
      // been restored. First-launch Howler HTTP requests used to race this.
      await this.options.authorize()
      if (!this.current(nonce)) return

      let sound: AudioHandle | null = null
      const events: AudioEvents = {
        onplay: () => {
          if (!this.current(nonce, sound) || !this.desired) return
          this.lastProgress = this.position()
          this.lastProgressAt = Date.now()
          this.transition('playing')
        },
        onpause: () => {
          if (this.current(nonce, sound)) this.transition(this.desired ? 'buffering' : 'paused')
        },
        onend: () => {
          if (!this.current(nonce, sound)) return
          this.desired = false
          this.stopChecks()
          this.transition('ready')
          this.options.onEnd()
        },
        onload: () => {
          if (!this.current(nonce, sound)) return
          if (this.phase !== 'playing') this.transition('ready')
          // Howler queues play during loading; do not issue a second play
          // while a previous request remains pending.
        },
        onloaderror: (_id, error) => {
          if (this.current(nonce, sound)) this.recover('Could not load this audio file.', error)
        },
        onplayerror: (_id, error) => {
          if (!this.current(nonce, sound)) return
          // Keep the current sound alive for Howler's unlock event. Discarding
          // it before unlock makes the retry impossible. The watchdog gives
          // this path a deadline and then rebuilds or reports the error.
          console.warn('Audio play blocked, waiting for media unlock:', error)
          this.transition('buffering')
          sound?.once('unlock', () => {
            if (sound && this.current(nonce, sound) && this.desired) {
              this.playRequestedAt = Date.now()
              this.safePlay(sound)
            }
          })
        },
      }
      sound = this.options.createAudio(events)
      if (!this.current(nonce)) {
        sound.unload()
        return
      }
      this.sound = sound
      if (this.desired) this.safePlay(sound)
    } catch (error) {
      if (this.current(nonce)) this.recover('Could not authorize or open this audio file.', error)
    }
  }

  private safePlay(sound: AudioHandle): void {
    try {
      if (!sound.playing()) sound.play()
    } catch (error) {
      this.recover('Could not start audio playback.', error)
    }
  }

  private position(): number {
    const value = this.sound?.seek()
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }

  play(): void {
    if (this.disposed || !this.options.source) return
    this.desired = true
    this.playRequestedAt = Date.now()
    this.lastProgressAt = this.playRequestedAt
    this.lastProgress = this.position()
    const wasUnloaded = this.sound?.state() === 'unloaded'
    if (wasUnloaded) {
      // A previous failed load can leave a non-null but unusable Howl.
      this.sound?.unload()
      this.sound = null
    }
    if (this.sound) {
      this.safePlay(this.sound)
    } else if (wasUnloaded || this.phase !== 'loading') {
      // Distinguish an in-flight permission request (no sound yet) from
      // a player that reached "unloaded" while its phase was still loading.
      void this.prepare()
    }
    this.watch()
  }

  pause(): void {
    this.desired = false
    this.stopChecks()
    this.sound?.pause()
    this.transition('paused')
  }

  seek(position: number): void {
    this.sound?.seek(position)
    this.lastProgress = position
    this.lastProgressAt = Date.now()
  }

  setVolume(value: number): void {
    this.sound?.volume(value)
  }

  private watch(): void {
    if (this.checkTimer !== null) return
    this.checkTimer = setInterval(() => {
      if (!this.desired || this.disposed) return
      const now = Date.now()
      const deadline = this.options.deadlineMs ?? 10000
      if (this.phase === 'playing') {
        const position = this.position()
        if (position > this.lastProgress + 0.05) {
          this.lastProgress = position
          this.lastProgressAt = now
        } else if (now - this.lastProgressAt >= deadline) {
          this.recover('Playback stalled without advancing.', { phase: this.phase })
        }
      } else if (now - this.playRequestedAt >= deadline) {
        this.recover('The audio did not start before the timeout.', { phase: this.phase })
      }
    }, this.options.checkEveryMs ?? 1000)
  }

  private stopChecks(): void {
    if (this.checkTimer !== null) clearInterval(this.checkTimer)
    this.checkTimer = null
  }

  private recover(message: string, error: unknown): void {
    if (this.disposed) return
    if (this.attempt < (this.options.maxRetries ?? 1)) {
      this.attempt += 1
      this.playRequestedAt = Date.now()
      this.lastProgressAt = this.playRequestedAt
      this.lastProgress = 0
      const old = this.sound
      this.sound = null
      ++this.nonce
      old?.stop()
      old?.unload()
      this.transition('buffering')
      void this.prepare()
      return
    }
    this.desired = false
    this.stopChecks()
    ++this.nonce
    this.sound?.unload()
    this.sound = null
    this.transition('error')
    this.options.onError(message, error)
  }

  dispose(): void {
    this.disposed = true
    this.desired = false
    ++this.nonce
    this.stopChecks()
    this.sound?.stop()
    this.sound?.unload()
    this.sound = null
  }
}

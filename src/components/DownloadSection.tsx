import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Download, ExternalLink, FolderOpen, LoaderCircle, Music2 } from 'lucide-react'

type AudioFormat = 'best' | 'mp3' | 'm4a' | 'opus' | 'flac' | 'wav'

type DownloadSectionProps = {
  musicFolderPath?: string
  isDesktop: boolean
  onChooseMusicFolder: () => void
  onRefreshLibrary: () => Promise<unknown> | unknown
}

const formats: { value: AudioFormat; label: string; description: string }[] = [
  { value: 'best', label: 'Best available audio', description: 'Original audio stream · recommended' },
  { value: 'mp3', label: 'MP3', description: 'Compatible almost everywhere' },
  { value: 'm4a', label: 'M4A', description: 'AAC audio in an M4A file' },
  { value: 'opus', label: 'Opus', description: 'High quality at smaller sizes' },
  { value: 'flac', label: 'FLAC', description: 'Lossless when the source supports it' },
  { value: 'wav', label: 'WAV', description: 'Uncompressed audio · larger files' },
]

export function DownloadSection({
  musicFolderPath,
  isDesktop,
  onChooseMusicFolder,
  onRefreshLibrary,
}: DownloadSectionProps) {
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<AudioFormat>('best')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [lastDownloaded, setLastDownloaded] = useState('')

  const handleDownload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setMessage({ type: 'error', text: 'Paste a video or media URL first.' })
      return
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setMessage({ type: 'error', text: 'Enter a valid URL starting with http:// or https://.' })
      return
    }
    if (!isDesktop) {
      setMessage({ type: 'error', text: 'Downloads are available in the Resonance Windows desktop app.' })
      return
    }
    if (!musicFolderPath) {
      setMessage({ type: 'error', text: 'Choose your Music folder first. Downloads are saved there.' })
      return
    }

    setBusy(true)
    setMessage({ type: 'info', text: 'Preparing audio download…' })
    setLastDownloaded('')
    try {
      const savedPath = await invoke<string>('download_audio', {
        url: trimmedUrl,
        outputDir: musicFolderPath,
        format,
      })
      setLastDownloaded(savedPath)
      setUrl('')
      setMessage({ type: 'success', text: 'Download complete. Updating your library…' })
      await onRefreshLibrary()
      setMessage({ type: 'success', text: 'Downloaded and added to your Resonance library.' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: typeof error === 'string' ? error : 'Download failed. Check the URL and downloader setup, then try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="download-page">
      <header className="download-page-header">
        <div className="download-heading-icon"><Download size={22} /></div>
        <div>
          <p className="eyebrow">RESonance · DOWNLOADS</p>
          <h1>Download audio</h1>
          <p className="download-subtitle">Save audio from supported media URLs directly to your local library.</p>
        </div>
      </header>

      <form className="download-card" onSubmit={handleDownload}>
        <label className="download-field-label" htmlFor="download-url">Media URL</label>
        <div className="download-url-row">
          <input
            id="download-url"
            className="download-url-input"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a video or media link…"
            autoComplete="url"
            disabled={busy}
          />
          <button className="download-submit" type="submit" disabled={busy || !url.trim()}>
            {busy ? <LoaderCircle size={17} className="download-spinner" /> : <Download size={17} />}
            <span>{busy ? 'Downloading…' : 'Download'}</span>
          </button>
        </div>

        <label className="download-field-label" htmlFor="download-format">Audio format</label>
        <div className="download-format-wrap">
          <Music2 size={18} />
          <select id="download-format" value={format} onChange={(event) => setFormat(event.target.value as AudioFormat)} disabled={busy}>
            {formats.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <p className="download-format-description">{formats.find((option) => option.value === format)?.description}</p>

        <div className="download-destination">
          <FolderOpen size={19} />
          <div className="download-destination-copy">
            <strong>Save location</strong>
            <span title={musicFolderPath || 'No music folder selected'}>
              {musicFolderPath ? musicFolderPath : 'No Music folder selected'}
            </span>
          </div>
          <button type="button" className="download-change-folder" onClick={onChooseMusicFolder} disabled={busy}>
            Change
          </button>
        </div>

        {message && (
          <div className={`download-message download-message-${message.type}`} role="status">
            {message.text}
          </div>
        )}
        {lastDownloaded && (
          <div className="download-completed-file">
            <span>Saved file</span>
            <code title={lastDownloaded}>{lastDownloaded}</code>
          </div>
        )}
      </form>

      <div className="download-note">
        <strong>Powered by yt-dlp</strong>
        <p>Downloads run locally on your PC. The best-audio option keeps the source audio stream; MP3 and other converted formats require FFmpeg to be installed alongside yt-dlp.</p>
        <a href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noreferrer">
          yt-dlp setup instructions <ExternalLink size={13} />
        </a>
      </div>
    </section>
  )
}

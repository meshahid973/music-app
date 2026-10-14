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
  const [downloadedPaths, setDownloadedPaths] = useState<string[]>([])

  const handleDownload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Accept one URL per line, or URLs separated by whitespace.
    const links = url.split(/\s+/).map((item) => item.trim()).filter(Boolean)
    if (!links.length) {
      setMessage({ type: 'error', text: 'Paste one or more media URLs first.' })
      return
    }
    const invalid = links.find((link) => !/^https?:\/\//i.test(link))
    if (invalid) {
      setMessage({ type: 'error', text: `This doesn't look like a valid URL: ${invalid}` })
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
    setDownloadedPaths([])
    const savedPaths: string[] = []
    const failures: string[] = []
    try {
      for (let index = 0; index < links.length; index += 1) {
        setMessage({
          type: 'info',
          text: `Downloading ${index + 1} of ${links.length}… The first run may also set up yt-dlp automatically.`,
        })
        try {
          const savedPath = await invoke<string>('download_audio', {
            url: links[index],
            outputDir: musicFolderPath,
            format,
          })
          savedPaths.push(savedPath)
          setDownloadedPaths([...savedPaths])
        } catch (error) {
          failures.push(`Link ${index + 1}: ${typeof error === 'string' ? error : 'Download failed.'}`)
        }
      }

      if (savedPaths.length) {
        try {
          await onRefreshLibrary()
        } catch {
          // The files are already downloaded; keep their successful status visible.
        }
      }

      if (failures.length === 0) {
        setUrl('')
        setMessage({
          type: 'success',
          text: `All ${savedPaths.length} download${savedPaths.length === 1 ? '' : 's'} complete and added to your library.`,
        })
      } else {
        setMessage({
          type: 'error',
          text: `${savedPaths.length} of ${links.length} downloaded. ${failures.join(' · ')}`,
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const linkCount = url.trim() ? url.trim().split(/\s+/).filter(Boolean).length : 0

  return (
    <section className="download-page">
      <header className="download-page-header">
        <div className="download-heading-icon"><Download size={22} /></div>
        <div>
          <p className="eyebrow">RESONANCE · DOWNLOADS</p>
          <h1>Download audio</h1>
          <p className="download-subtitle">Paste one link or a whole list. Audio is saved directly to your local library.</p>
        </div>
      </header>

      <form className="download-card" onSubmit={handleDownload}>
        <div className="download-card-heading">
          <div className="download-card-heading-copy">
            <p className="download-card-eyebrow">DOWNLOAD SETUP</p>
            <h2>Queue up your audio</h2>
            <p>Add one source link or paste a whole batch. Files are saved straight into your Resonance library.</p>
          </div>
          <div className="download-queue-count" aria-live="polite">
            <strong>{linkCount}</strong>
            <span>{linkCount === 1 ? 'link queued' : 'links queued'}</span>
          </div>
        </div>

        <div className="download-workspace">
          <div className="download-links-panel">
            <div className="download-field-topline">
              <label className="download-field-label" htmlFor="download-url">Media URLs</label>
              <span>ONE PER LINE</span>
            </div>
            <textarea
              id="download-url"
              className="download-url-input download-url-textarea"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={'Paste one or more links here…\nhttps://…\nhttps://…'}
              autoComplete="off"
              rows={6}
              disabled={busy}
            />
            <div className="download-url-hint">Links are processed one at a time, in the order you add them.</div>
          </div>

          <div className="download-options-panel">
            <div className="download-option-group">
              <label className="download-field-label" htmlFor="download-format">Audio format</label>
              <div className="download-format-wrap">
                <Music2 size={18} />
                <select id="download-format" value={format} onChange={(event) => setFormat(event.target.value as AudioFormat)} disabled={busy}>
                  {formats.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <p className="download-format-description">{formats.find((option) => option.value === format)?.description}</p>
            </div>

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

            <button className="download-submit download-submit-full" type="submit" disabled={busy || !url.trim()}>
              {busy ? <LoaderCircle size={17} className="download-spinner" /> : <Download size={17} />}
              <span>{busy ? 'Downloading queue…' : `Download ${linkCount} link${linkCount === 1 ? '' : 's'}`}</span>
            </button>
          </div>
        </div>

        {message && (
          <div className={`download-message download-message-${message.type}`} role="status" aria-live="polite">
            {message.text}
          </div>
        )}
        {downloadedPaths.length > 0 && (
          <div className="download-completed-file">
            <span>Downloaded files ({downloadedPaths.length})</span>
            {downloadedPaths.map((path) => <code key={path} title={path}>{path}</code>)}
          </div>
        )}
      </form>

      <div className="download-note">
        <strong>Powered by yt-dlp</strong>
        <p>Resonance sets up yt-dlp automatically the first time you download. The best-audio option keeps the source audio stream; MP3 and other converted formats require FFmpeg to be installed separately.</p>
        <a href="https://github.com/yt-dlp/yt-dlp#installation" target="_blank" rel="noreferrer">
          yt-dlp project and setup instructions <ExternalLink size={13} />
        </a>
      </div>
    </section>
  )
}

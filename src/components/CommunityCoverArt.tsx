import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { Download, ExternalLink, ImageOff, LoaderCircle, RefreshCw, Shuffle } from 'lucide-react'
import {
  isCommunityArtwork,
  isAllowedArtworkApiUrl,
  artworkLoadErrorMessage,
  isSaveDialogCancelled,
  sanitizeArtworkFilename,
  type CommunityArtwork,
  type CoverArtCategory,
} from '../utils/communityCoverArt'
import './CommunityCoverArt.css'

const API_URL = (import.meta.env.VITE_COVER_ART_API_URL || '').trim().replace(/\/+$/, '')
type GalleryResponse = { items: CommunityArtwork[]; page: number; total: number; hasMore: boolean }
type Status = { kind: 'info' | 'success' | 'error'; text: string } | null

export function CommunityCoverArt({ isDesktop }: { isDesktop: boolean }) {
  const [category, setCategory] = useState<CoverArtCategory | 'all'>('all')
  const [artwork, setArtwork] = useState<CommunityArtwork | null>(null)
  const [items, setItems] = useState<CommunityArtwork[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [error, setError] = useState<string | null>(null)
  const configured = isAllowedArtworkApiUrl(API_URL)

  const categoryParam = category === 'all' ? '' : `&category=${category}`
  const endpoint = API_URL

  const loadCatalogue = useCallback(async (nextPage: number, replace = false) => {
    if (!configured) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${endpoint}/api/artworks?page=${nextPage}&limit=12${categoryParam}`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(response.status === 404 ? 'No artwork is available in this category yet.' : `Artwork service returned HTTP ${response.status}.`)
      const data = await response.json() as GalleryResponse
      if (!Array.isArray(data.items)) throw new Error('The artwork service returned an invalid catalogue.')
      const safeItems = data.items.filter((item) => isCommunityArtwork(item, endpoint))
      setItems((current) => replace ? safeItems : [...current, ...safeItems.filter((item) => !current.some((old) => old.id === item.id))])
      setPage(nextPage)
      setHasMore(Boolean(data.hasMore))
    } catch (cause) {
      setError(artworkLoadErrorMessage(cause))
      if (replace) setItems([])
    } finally {
      setLoading(false)
    }
  }, [categoryParam, configured, endpoint])

  const chooseRandom = useCallback(async () => {
    if (!configured) return
    setLoading(true)
    setStatus(null)
    setError(null)
    try {
      const suffix = category === 'all' ? '' : `?category=${category}`
      const response = await fetch(`${endpoint}/api/random${suffix}`, { headers: { accept: 'application/json' } })
      if (response.status === 404) { setArtwork(null); setError(null); return }
      if (!response.ok) throw new Error(`Artwork service returned HTTP ${response.status}.`)
      const data = await response.json() as { artwork?: CommunityArtwork }
      const next = data.artwork
      if (!isCommunityArtwork(next, endpoint)) {
        throw new Error('The artwork service returned invalid artwork metadata.')
      }
      setArtwork(next)
    } catch (cause) {
      setError(artworkLoadErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [category, configured, endpoint])

  useEffect(() => {
    setArtwork(null)
    setItems([])
    setPage(1)
    setHasMore(false)
    setStatus(null)
    void loadCatalogue(1, true)
    void chooseRandom()
  }, [category, chooseRandom, loadCatalogue])

  const downloadArtwork = async () => {
    if (!artwork || downloading) return
    if (!isDesktop) {
      setStatus({ kind: 'error', text: 'Downloading artwork is available in the installed Resonance desktop app.' })
      return
    }
    setDownloading(true)
    setStatus({ kind: 'info', text: 'Choose where to save the original image…' })
    try {
      const path = await save({
        title: 'Save community cover art',
        defaultPath: sanitizeArtworkFilename(artwork.title, artwork.format),
        filters: [{ name: 'Image', extensions: [artwork.format === 'jpeg' ? 'jpg' : artwork.format] }],
      })
      if (isSaveDialogCancelled(path)) {
        setStatus(null)
        return
      }
      setStatus({ kind: 'info', text: 'Downloading and validating the original image…' })
      const savedPath = await invoke<string>('save_community_artwork', {
        apiUrl: endpoint,
        artworkId: artwork.id,
        destination: path,
        expectedFormat: artwork.format,
      })
      setStatus({ kind: 'success', text: `Saved artwork to ${savedPath}` })
    } catch (cause) {
      setStatus({ kind: 'error', text: typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'The artwork could not be saved.' })
    } finally {
      setDownloading(false)
    }
  }

  const label = (value: string) => value === 'community' ? 'Community Artwork' : 'Album Cover'
  const creator = artwork?.creator || artwork?.artist || 'Creator not provided'

  return (
    <section className="community-art-page" aria-labelledby="community-art-heading">
      <header className="community-art-header">
        <div className="community-art-heading-icon"><ImageOff size={21} /></div>
        <div>
          <p className="eyebrow">RESONANCE · DISCOVER</p>
          <h1 id="community-art-heading">Community Cover Art</h1>
          <p>Discover artwork to save locally. Downloads never change your songs or their existing covers.</p>
        </div>
      </header>

      <div className="community-art-filters" role="group" aria-label="Artwork category">
        {([{ value: 'all', label: 'All artwork' }, { value: 'community', label: 'Community Artwork' }, { value: 'album', label: 'Album Covers' }] as const).map((option) => (
          <button key={option.value} type="button" className={category === option.value ? 'selected' : ''} aria-pressed={category === option.value} onClick={() => setCategory(option.value)}>{option.label}</button>
        ))}
      </div>

      {!configured && <div className="community-art-message" role="status">The gallery is not configured yet. Set <code>VITE_COVER_ART_API_URL</code> to your deployed Cloudflare Worker URL, then rebuild Resonance.</div>}
      {error && <div className="community-art-message error" role="alert">{error} <button type="button" onClick={() => { void loadCatalogue(1, true); void chooseRandom() }}>Retry</button></div>}

      <div className="community-art-layout">
        <section className="community-art-feature" aria-label="Featured artwork">
          <div className="community-art-preview">
            {artwork ? <img src={artwork.imageUrl} alt={artwork.title} onError={() => setError('This image could not be loaded. The service may be offline or the image may be missing.')} /> :
              <div className="community-art-placeholder">{loading ? <LoaderCircle className="community-art-spinner" size={28} /> : <ImageOff size={34} />}<span>{loading ? 'Finding artwork…' : 'No featured artwork'}</span></div>}
          </div>
          <div className="community-art-feature-actions">
            <button type="button" className="community-art-primary" onClick={() => void chooseRandom()} disabled={!configured || loading}><Shuffle size={16} /> Random Cover</button>
            <button type="button" onClick={() => void chooseRandom()} disabled={!configured || loading}><RefreshCw size={15} /> Try Another</button>
          </div>
        </section>

        <section className="community-art-details" aria-label="Artwork details">
          {artwork ? <>
            <span className="community-art-category">{label(artwork.category)}</span>
            <h2>{artwork.title}</h2>
            <p className="community-art-creator">{creator}</p>
            <dl>
              <div><dt>Licence</dt><dd>{artwork.licence || 'Licence details not provided'}</dd></div>
              <div><dt>Attribution</dt><dd>{artwork.attributionRequired === true ? (artwork.attribution || 'Attribution required; details unavailable') : artwork.attributionRequired === false ? 'Not required by the supplied metadata' : 'Attribution status not specified'}</dd></div>
              <div><dt>Source</dt><dd>{artwork.source || 'Source not provided'}</dd></div>
              {artwork.width && artwork.height && <div><dt>Dimensions</dt><dd>{artwork.width} × {artwork.height}</dd></div>}
              {artwork.fileSize && <div><dt>File size</dt><dd>{(artwork.fileSize / 1024 / 1024).toFixed(2)} MiB</dd></div>}
            </dl>
            <button type="button" className="community-art-download" onClick={() => void downloadArtwork()} disabled={downloading || !isDesktop}><Download size={16} />{downloading ? 'Saving…' : 'Download original'}</button>
            {!isDesktop && <p className="community-art-note">Use the installed desktop app to save original artwork.</p>}
            {status && <p className={`community-art-status ${status.kind}`} role="status">{status.text}</p>}
            <p className="community-art-note"><ExternalLink size={13} /> Saved images remain separate from your music library.</p>
          </> : <div className="community-art-empty-details"><h2>Find your next cover</h2><p>Choose a category and request a random image to explore the gallery.</p>{!loading && !error && configured && <button type="button" onClick={() => void chooseRandom()}>Explore artwork</button>}</div>}
        </section>
      </div>

      <section className="community-art-catalogue">
        <div className="community-art-catalogue-heading"><div><h2>Browse the catalogue</h2><p>{items.length ? `${items.length} loaded` : 'Artwork available to explore'}</p></div></div>
        {loading && items.length === 0 ? <div className="community-art-catalogue-empty"><LoaderCircle className="community-art-spinner" size={20} /> Loading catalogue…</div> :
          items.length ? <div className="community-art-grid">{items.map((item) => <button type="button" key={item.id} className={artwork?.id === item.id ? 'community-art-tile selected' : 'community-art-tile'} onClick={() => { setArtwork(item); setStatus(null); setError(null) }}><img src={item.imageUrl} alt="" loading="lazy" /><span>{item.title}</span><small>{label(item.category)}</small></button>)}</div> :
            <div className="community-art-catalogue-empty"><ImageOff size={22} /><span>{configured && !loading && !error ? 'No artwork has been published yet.' : 'The catalogue will appear here when available.'}</span></div>}
        {hasMore && <button type="button" className="community-art-load-more" disabled={loading} onClick={() => void loadCatalogue(page + 1)}>{loading ? 'Loading…' : 'Load more'}</button>}
      </section>
    </section>
  )
}

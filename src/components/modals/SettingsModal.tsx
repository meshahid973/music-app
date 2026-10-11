import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CloseFilled,
  PaletteFilled,
  SettingsFilled,
  SparklesFilled,
} from '../icons'
import { useMusicStore } from '../../store/useMusicStore'
import type { ThemePreset } from '../../types'

export type SettingsModalProps = {
  onClose: () => void
}

type SettingsTab = 'looks' | 'shortcuts'

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('looks')
  const { themePreset, setThemePreset, accentColor, setAccentColor, tracks, playlists } = useMusicStore()

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <motion.div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="modal-card settings-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: 'spring', damping: 26, stiffness: 380 }}
      >
        <header className="modal-header">
          <div className="settings-modal-title-group">
            <div className="settings-modal-icon-badge">
              <SettingsFilled size={20} />
            </div>
            <div>
              <h3 id="settings-modal-title">Settings</h3>
              <p className="settings-modal-subtitle">Configure application look and playback preferences</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close settings dialog"
            title="Close"
          >
            <CloseFilled size={18} />
          </button>
        </header>

        {/* Settings Tab Navigation */}
        <div className="settings-tabs-bar" role="tablist" aria-label="Settings categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'looks'}
            aria-controls="settings-panel-looks"
            id="settings-tab-looks"
            className={`settings-tab-btn ${activeTab === 'looks' ? 'active' : ''}`}
            onClick={() => setActiveTab('looks')}
          >
            <PaletteFilled size={16} />
            <span>Looks</span>
            <span className="settings-tab-indicator" />
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shortcuts'}
            aria-controls="settings-panel-shortcuts"
            id="settings-tab-shortcuts"
            className={`settings-tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            <SparklesFilled size={16} />
            <span>Shortcuts & Info</span>
            <span className="settings-tab-indicator" />
          </button>
        </div>

        {/* Tab Content Panels */}
        <div className="settings-tab-content">
          {activeTab === 'looks' && (
            <div
              id="settings-panel-looks"
              role="tabpanel"
              aria-labelledby="settings-tab-looks"
              className="settings-panel looks-panel"
            >
              <div className="settings-section-header">
                <span className="settings-eyebrow">Appearance</span>
                <p className="settings-section-desc">
                  Customize the interface palette. The player artwork uses its own soft acrylic blur.
                </p>
              </div>

              <div className="theme-customization-section">
                <div className="settings-section-header">
                  <span className="settings-eyebrow">Color palette</span>
                  <p className="settings-section-desc">
                    Choose a surface palette and customize the interface accent. Your choices are saved with your library.
                  </p>
                </div>
                <div className="theme-customization-controls">
                  <label className="theme-control-field">
                    <span>Preset</span>
                    <select
                      value={themePreset}
                      onChange={(event) => setThemePreset(event.target.value as ThemePreset)}
                      aria-label="Theme preset"
                    >
                      <option value="midnight">Midnight</option>
                      <option value="ocean">Ocean</option>
                      <option value="violet">Violet</option>
                      <option value="forest">Forest</option>
                    </select>
                  </label>
                  <label className="theme-control-field theme-accent-field">
                    <span>Accent color</span>
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(event) => setAccentColor(event.target.value)}
                      aria-label="Accent color"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div
              id="settings-panel-shortcuts"
              role="tabpanel"
              aria-labelledby="settings-tab-shortcuts"
              className="settings-panel shortcuts-panel"
            >
              <div className="settings-section-header">
                <span className="settings-eyebrow">Keyboard Shortcuts</span>
                <p className="settings-section-desc">Quick key controls for seamless playback without reaching for the mouse.</p>
              </div>

              <div className="shortcuts-list">
                <div className="shortcut-row">
                  <span className="shortcut-action">Play / Pause</span>
                  <kbd className="shortcut-kbd">Space</kbd>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-action">Seek Backward 5s</span>
                  <kbd className="shortcut-kbd">←</kbd>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-action">Seek Forward 5s</span>
                  <kbd className="shortcut-kbd">→</kbd>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-action">Volume Up / Down</span>
                  <kbd className="shortcut-kbd">↑ / ↓</kbd>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-action">Toggle Mute</span>
                  <kbd className="shortcut-kbd">M</kbd>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-action">Toggle Shuffle</span>
                  <kbd className="shortcut-kbd">S</kbd>
                </div>
                <div className="shortcut-row">
                  <span className="shortcut-action">Cycle Repeat Mode</span>
                  <kbd className="shortcut-kbd">R</kbd>
                </div>
              </div>

              <div className="app-info-footer">
                <div>
                  <strong>Resonance</strong>
                  <span>Local High-Fidelity Audio Player</span>
                </div>
                <div className="app-stats">
                  <span>{tracks.length} tracks</span>
                  <span>•</span>
                  <span>{playlists.length} playlists</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="settings-modal-footer">
          <button type="button" className="action-btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

export default SettingsModal

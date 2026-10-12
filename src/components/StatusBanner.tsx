import type { ReactNode } from 'react'

export type StatusBannerVariant = 'success' | 'error' | 'warning' | 'info'

export type StatusBannerProps = {
  title: string
  description?: string
  variant?: StatusBannerVariant
  icon?: ReactNode
  className?: string
}

/** Reusable inline status message for setup flows, dialogs, and settings. */
export function StatusBanner({
  title,
  description,
  variant = 'info',
  icon,
  className,
}: StatusBannerProps) {
  const classes = ['status-banner', `status-banner-${variant}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      {icon && <span className="status-banner-icon" aria-hidden="true">{icon}</span>}
      <div className="status-banner-content">
        <strong className="status-banner-title">{title}</strong>
        {description && <span className="status-banner-description">{description}</span>}
      </div>
    </div>
  )
}

export default StatusBanner

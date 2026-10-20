import React from 'react'
import Link from 'next/link'

export type MetricColor = 'blue' | 'emerald' | 'amber' | 'purple' | 'rose' | 'red' | 'default'

const iconBgStyles: Record<MetricColor, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-300 border-blue-100 dark:border-blue-900/50',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-300 border-amber-100 dark:border-amber-900/50',
  purple: 'bg-purple-50 text-purple-600 dark:bg-purple-950/70 dark:text-purple-300 border-purple-100 dark:border-purple-900/50',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/70 dark:text-rose-300 border-rose-100 dark:border-rose-900/50',
  red: 'bg-red-50 text-red-600 dark:bg-red-950/70 dark:text-red-300 border-red-100 dark:border-red-900/50',
  default: 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
}

const selectedStyles: Record<MetricColor, string> = {
  blue: 'ring-2 ring-blue-500/90 border-blue-500 bg-blue-50/25 dark:bg-blue-950/30 dark:border-blue-500 shadow-sm',
  emerald: 'ring-2 ring-emerald-500/90 border-emerald-500 bg-emerald-50/25 dark:bg-emerald-950/30 dark:border-emerald-500 shadow-sm',
  amber: 'ring-2 ring-amber-500/90 border-amber-500 bg-amber-50/25 dark:bg-amber-950/30 dark:border-amber-500 shadow-sm',
  purple: 'ring-2 ring-purple-500/90 border-purple-500 bg-purple-50/25 dark:bg-purple-950/30 dark:border-purple-500 shadow-sm',
  rose: 'ring-2 ring-rose-500/90 border-rose-500 bg-rose-50/25 dark:bg-rose-950/30 dark:border-rose-500 shadow-sm',
  red: 'ring-2 ring-red-500/90 border-red-500 bg-red-50/25 dark:bg-red-950/30 dark:border-red-500 shadow-sm',
  default: 'ring-2 ring-slate-500/90 border-slate-500 bg-slate-50/40 dark:bg-slate-800/40 dark:border-slate-400 shadow-sm',
}

interface SummaryMetricCardProps {
  label: string
  value: string | number
  helper?: string
  icon: React.ReactNode
  className?: string
  variant?: MetricColor
  color?: MetricColor
  onClick?: () => void
  href?: string
  isSelected?: boolean
  clickable?: boolean
}

export default function SummaryMetricCard({
  label,
  value,
  helper,
  icon,
  className = '',
  variant,
  color,
  onClick,
  href,
  isSelected = false,
  clickable,
}: SummaryMetricCardProps) {
  const selectedVariant = variant || color || 'default'
  const iconStyle = iconBgStyles[selectedVariant] || iconBgStyles.default
  const isInteractive = Boolean(onClick || href || clickable)

  const activeHighlight = isSelected
    ? selectedStyles[selectedVariant] || selectedStyles.default
    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'

  const interactiveClasses = isInteractive
    ? 'cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600 active:translate-y-0 select-none group'
    : ''

  const cardContent = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p className="mt-2 text-3xl font-bold leading-tight tracking-[-0.04em] text-slate-950 dark:text-slate-100">
          {value || value === 0 ? value : '--'}
        </p>
        {helper ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {helper}
          </p>
        ) : null}
      </div>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${iconStyle} transition-transform group-hover:scale-105`}>
        {icon}
      </div>
    </div>
  )

  const fullClassName = `relative rounded-2xl border px-4 py-4 shadow-sm ${activeHighlight} ${interactiveClasses} ${className}`.trim()

  if (href) {
    return (
      <Link
        href={href}
        className={fullClassName}
        role="link"
        aria-label={`${label}: ${value}`}
      >
        {cardContent}
      </Link>
    )
  }

  if (onClick) {
    return (
      <article
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        tabIndex={0}
        role="button"
        aria-pressed={isSelected}
        aria-label={`${label}: ${value}${isSelected ? ' (active filter, click to reset)' : ''}`}
        className={fullClassName}
      >
        {cardContent}
      </article>
    )
  }

  return (
    <article className={fullClassName}>
      {cardContent}
    </article>
  )
}


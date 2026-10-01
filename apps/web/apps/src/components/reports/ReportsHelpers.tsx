'use client'

import React, { useState } from 'react'
import { type ReportDistributionRow } from '@/lib/api'
import SelectDropdown from '@/components/ui/SelectDropdown'

// ─── Helpers ────────────────────────────────────────────────

export function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function downloadCSV(rows: ReportDistributionRow[], filename: string) {
  const headers = [
    'Date', 'Barangay', 'Assigned Barangays', 'Registered Households',
    'Claimed', 'Unclaimed', 'Claim Rate (%)', 'Status',
  ]
  const csvRows = rows.map((r) => [
    formatDate(r.scheduled || r.createdAt),
    r.barangay,
    (r.assignedBarangays || []).join('; '),
    r.registeredHouseholds,
    r.claimedHouseholds,
    r.unclaimedHouseholds,
    r.claimRate,
    r.status,
  ])

  const csv = [
    headers.join(','),
    ...csvRows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    ),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Quick date preset range calculator */
export function getDatePresetRange(preset: 'today' | '7d' | '30d' | 'month' | 'ytd' | 'all'): { start: string; end: string } {
  const now = new Date()
  const formatDateStr = (d: Date) => d.toISOString().split('T')[0]

  if (preset === 'today') {
    const todayStr = formatDateStr(now)
    return { start: todayStr, end: todayStr }
  }
  if (preset === '7d') {
    const start = new Date(now)
    start.setDate(now.getDate() - 7)
    return { start: formatDateStr(start), end: formatDateStr(now) }
  }
  if (preset === '30d') {
    const start = new Date(now)
    start.setDate(now.getDate() - 30)
    return { start: formatDateStr(start), end: formatDateStr(now) }
  }
  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: formatDateStr(start), end: formatDateStr(now) }
  }
  if (preset === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1)
    return { start: formatDateStr(start), end: formatDateStr(now) }
  }
  return { start: '', end: '' }
}

// ─── Components ─────────────────────────────────────────────

export type DropdownItem = { value: string; label: string }

export function Dropdown({
  value,
  items,
  onChange,
  buttonLabel,
  widthClass = 'min-w-[200px]',
}: {
  value: string
  items: DropdownItem[]
  onChange: (v: string) => void
  buttonLabel: string
  widthClass?: string
}) {
  return (
    <SelectDropdown
      value={value}
      options={items}
      onChange={onChange}
      placeholder={buttonLabel}
      className={widthClass}
      buttonClassName="!h-[38px] !px-3.5 !py-2 !text-xs sm:!text-sm !font-medium"
      menuClassName="!rounded-2xl"
    />
  )
}

export function StatCard({
  icon,
  title,
  value,
  subtitle,
  variant = 'emerald',
}: {
  icon: React.ReactNode
  title: string
  value: string
  subtitle?: string
  variant?: 'emerald' | 'blue' | 'amber' | 'purple'
}) {
  const variantStyles = {
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/50',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200/60 dark:border-blue-900/50',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200/60 dark:border-amber-900/50',
    purple: 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border-purple-200/60 dark:border-purple-900/50',
  }

  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${variantStyles[variant]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
          {value}
        </div>
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
          {title}
        </div>
        {subtitle && (
          <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const isClaimed = status === 'Claimed' || status === 'Completed'
  const isActive = status === 'Partially Claimed' || status === 'Active'

  const cls = isClaimed
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40'
    : isActive
    ? 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40'
    : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'

  const label = isClaimed ? 'Completed' : isActive ? 'Active' : 'Scheduled'

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isClaimed ? 'bg-emerald-500' : isActive ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'}`} />
      {label}
    </span>
  )
}

export function ClaimRateBar({ rate }: { rate: number }) {
  const color =
    rate >= 80 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : rate >= 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' : rate > 0 ? 'bg-gradient-to-r from-orange-500 to-rose-400' : 'bg-slate-300'
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-bold text-slate-700 dark:text-slate-300">{rate}%</span>
    </div>
  )
}

export function Donut({
  segments,
}: {
  segments: { label: string; value: number; stroke: string }[]
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  const radius = 48
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-5 select-none">
      <div className="relative w-32 h-32 shrink-0">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" strokeWidth="12" className="text-slate-100 dark:text-slate-800" />
          {segments.map((seg, idx) => {
            const dash = (seg.value / total) * circumference
            const gap = circumference - dash
            const dashArray = `${dash} ${gap}`
            const dashOffset = -offset
            offset += dash
            return (
              <circle
                key={idx}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={seg.stroke}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                className="transition-all duration-500"
              />
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-extrabold text-slate-900 dark:text-slate-100">{total}</span>
          <span className="text-[9px] font-semibold text-slate-400 uppercase">Distributions</span>
        </div>
      </div>

      <div className="flex-1 space-y-2 max-h-36 overflow-y-auto pr-1 w-full">
        {segments.map((s) => {
          const pct = Math.round((s.value / total) * 100)
          return (
            <div key={s.label} className="flex items-center justify-between gap-2 text-xs p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.stroke }} />
                <span className="text-slate-700 dark:text-slate-300 font-medium truncate">{s.label}</span>
              </div>
              <span className="text-slate-900 dark:text-slate-100 font-bold shrink-0">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function MiniBarChart({
  labels,
  seriesA,
  seriesB,
  legendA,
  legendB,
}: {
  labels: string[]
  seriesA: number[]
  seriesB: number[]
  legendA: string
  legendB: string
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const max = Math.max(...seriesA, ...seriesB, 1)

  return (
    <div className="w-full select-none">
      {/* Legend & Hover Info */}
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4 text-slate-500 dark:text-slate-400 font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> {legendA}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> {legendB}
          </span>
        </div>
        {hoverIndex !== null && (
          <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
            {labels[hoverIndex]}: <span className="text-blue-500">{seriesA[hoverIndex]}</span> vs <span className="text-emerald-500">{seriesB[hoverIndex]}</span>
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 sm:gap-3 h-36 pt-4 border-b border-slate-100 dark:border-slate-800">
        {labels.map((m, i) => {
          const a = (seriesA[i] / max) * 100
          const b = (seriesB[i] / max) * 100
          const isHovered = hoverIndex === i

          return (
            <div
              key={m}
              className="flex-1 flex flex-col items-center gap-1 cursor-pointer"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <div className="flex items-end justify-center gap-1 w-full h-28">
                <div
                  className={`w-2.5 sm:w-3.5 rounded-t-md bg-gradient-to-t from-blue-600 to-blue-400 transition-all duration-300 ${isHovered ? 'scale-105 brightness-110' : 'opacity-90'}`}
                  style={{ height: `${a}%`, minHeight: seriesA[i] > 0 ? '4px' : '0px' }}
                />
                <div
                  className={`w-2.5 sm:w-3.5 rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-300 ${isHovered ? 'scale-105 brightness-110' : 'opacity-90'}`}
                  style={{ height: `${b}%`, minHeight: seriesB[i] > 0 ? '4px' : '0px' }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        {labels.map((m, i) => (
          <span
            key={m}
            className={`w-full text-center cursor-pointer transition-colors ${hoverIndex === i ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}`}
            onMouseEnter={() => setHoverIndex(i)}
          >
            {m}
          </span>
        ))}
      </div>
    </div>
  )
}

export function SummaryCell({
  label,
  value,
  valueClass = 'text-slate-900 dark:text-slate-100',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/70">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight ${valueClass}`}>{value}</div>
    </div>
  )
}

export function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      <span className="text-slate-500 dark:text-slate-400">{icon}</span>
      {label}
    </button>
  )
}

export function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-9 w-9 animate-spin rounded-full border-3 border-slate-200 border-t-emerald-600 dark:border-slate-700 dark:border-t-emerald-400" />
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-3">Compiling report analytics...</span>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
      <DocIcon className="w-10 h-10 mb-2.5 text-slate-300 dark:text-slate-600" />
      <p className="text-xs font-medium">{message}</p>
    </div>
  )
}

// ─── Icons ──────────────────────────────────────────────────

export function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
export function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  )
}
export function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L14 13.414V19a1 1 0 01-1.447.894l-4-2A1 1 0 018 17v-3.586L3.293 6.707A1 1 0 013 6V4z" />
    </svg>
  )
}
export function BoltIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}
export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 10l5 5 5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15V3" />
    </svg>
  )
}
export function ClearIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
export function DocIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 11h10M7 15h6" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 3h8l4 4v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  )
}
export function CubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 8l-9-5-9 5 9 5 9-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8v8l9 5 9-5V8" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 13v8" />
    </svg>
  )
}
export function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}
export function TrendIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 7h7v7" />
    </svg>
  )
}
export function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  )
}
export function UnclaimedIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  )
}
export function DotsIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
    </svg>
  )
}
export function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}
export function QRIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 14h3v3h-3zM14 20h7M20 14v3" />
    </svg>
  )
}
export function FaceIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth={3} strokeLinecap="round" />
      <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}
export function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}

// ─── Pagination Component ───────────────────────────────────

export { default as Pagination } from '@/components/ui/Pagination'
export type { PaginationProps } from '@/components/ui/Pagination'



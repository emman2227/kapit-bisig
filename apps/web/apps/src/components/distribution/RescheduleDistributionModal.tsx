'use client'

import React, { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { DistributionRow } from './DistributionsTable'

interface RescheduleDistributionModalProps {
  open: boolean
  distribution: DistributionRow | null
  onClose: () => void
  onSuccess: () => void
}

const OPERATING_HOUR_START = 6
const OPERATING_HOUR_END = 20

function formatCurrentScheduled(dateString?: string | null): string {
  if (!dateString) return '--'
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return String(dateString)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default function RescheduleDistributionModal({
  open,
  distribution,
  onClose,
  onSuccess,
}: RescheduleDistributionModalProps) {
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize date/time defaults when modal opens
  useEffect(() => {
    if (!open || !distribution) return
    setError(null)
    setReason('')

    const now = new Date()
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const yyyy = tomorrow.getFullYear()
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const dd = String(tomorrow.getDate()).padStart(2, '0')
    setScheduledDate(`${yyyy}-${mm}-${dd}`)
    setScheduledTime('09:00')
  }, [open, distribution])

  if (!open || !distribution) return null

  const validate = (): string | null => {
    if (!scheduledDate || !scheduledTime) {
      return 'Please choose both a new date and time.'
    }

    const scheduledDateObj = new Date(`${scheduledDate}T${scheduledTime}`)
    if (isNaN(scheduledDateObj.getTime())) {
      return 'Selected date and time is invalid.'
    }

    const now = new Date()
    const minAllowed = new Date(now.getTime() + 5 * 60 * 1000)
    if (scheduledDateObj.getTime() < minAllowed.getTime()) {
      return 'New schedule must be at least 5 minutes from now.'
    }

    const hour = scheduledDateObj.getHours()
    const minute = scheduledDateObj.getMinutes()
    if (hour < OPERATING_HOUR_START || hour > OPERATING_HOUR_END || (hour === OPERATING_HOUR_END && minute > 0)) {
      return `Operating hours are 6:00 AM to 8:00 PM.`
    }

    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const scheduledIso = new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
      const res = await api.rescheduleDistribution(distribution.id, {
        scheduled: scheduledIso,
        reason: reason.trim() || undefined,
      })

      if (res.success) {
        showToast.success(`Distribution for ${distribution.barangay} rescheduled.`)
        onSuccess()
        onClose()
      } else {
        setError(res.message || 'Failed to reschedule distribution.')
      }
    } catch (err: any) {
      console.error('Failed to reschedule distribution:', err)
      const serverMessage =
        err?.response?.message || err?.message || 'Failed to reschedule distribution.'
      setError(serverMessage)
    } finally {
      setLoading(false)
    }
  }

  const now = new Date()
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full px-4 py-6 sm:py-10 flex items-center justify-center">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm" onClick={loading ? undefined : onClose} />

        {/* Modal Container */}
        <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-100 dark:border-slate-800">
          {/* Top Accent Bar */}
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
            <div className="h-full bg-gradient-to-r from-amber-500 via-emerald-500 to-[#0F533A] shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
          </div>

          {/* Header */}
          <div className="border-b border-gray-100 dark:border-slate-800 px-6 pt-5 pb-4 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 text-[11px] font-bold uppercase tracking-wider border border-amber-200/60 dark:border-amber-800/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Delay / Postponement • {distribution.barangay}
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                  Reschedule Distribution
                </h3>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  Update scheduled relief dispatch timing and notify assigned field personnel.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
            {/* Current schedule info */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Current Schedule</p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{formatCurrentScheduled(distribution.scheduled)}</span>
              </p>
            </div>

            {/* New Date & Time */}
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                New Date & Time
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
                  <input
                    type="date"
                    min={todayYmd}
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Time (06:00 - 20:00)</label>
                  <input
                    type="time"
                    min="06:00"
                    max="20:00"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">Allowed distribution operations window: 6:00 AM – 8:00 PM</p>
            </div>

            {/* Reason / Notes */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Reason for Rescheduling / Delay Notes <span className="font-normal lowercase text-slate-400">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Severe rainfall and flooding; moving relief operation to tomorrow morning."
                maxLength={500}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 shadow-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
              />
            </div>

            {/* Error notice */}
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/40 p-3.5 text-xs font-semibold text-rose-700 dark:text-rose-400">
                {error}
              </div>
            )}

            {/* Action buttons */}
            <div className="border-t border-gray-100 dark:border-slate-800 pt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={loading}
                onClick={onClose}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors shadow-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <SpinnerIcon className="h-4 w-4" />
                    <span>Rescheduling…</span>
                  </>
                ) : (
                  'Confirm Reschedule'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function CalendarIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function XIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SpinnerIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" className="opacity-20" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

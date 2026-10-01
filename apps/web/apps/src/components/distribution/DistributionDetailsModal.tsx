'use client'

import React from 'react'
import { api } from '@/lib/api'
import type { DistributionRow } from './DistributionsTable'
import { formatScheduledDate } from './DistributionsTable'

export default function DistributionDetailsModal({
  open,
  onClose,
  distribution,
  onMarkClaimed,
}: {
  open: boolean
  onClose: () => void
  distribution: DistributionRow | null
  onMarkClaimed?: (id: string) => void
}) {
  const [staffNames, setStaffNames] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!open || !distribution || !distribution.assignedStaffIds?.length) {
      setStaffNames([])
      return
    }

    let cancelled = false
    const loadStaff = async () => {
      try {
        const res = await api.getStaffUsers({ status: 'active' })
        if (!cancelled && res.success && res.data) {
          const idSet = new Set(distribution.assignedStaffIds)
          const matched = res.data
            .filter((s) => idSet.has(s.id))
            .map((s) => `${s.firstName || ''} ${s.lastName || ''}`.trim() || s.fullName || 'Staff')
          setStaffNames(matched)
        }
      } catch (err) {
        console.error('Failed to load staff for details:', err)
      }
    }
    void loadStaff()

    return () => {
      cancelled = true
    }
  }, [open, distribution])

  if (!open || !distribution) return null

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full px-4 py-6 sm:py-10 flex items-center justify-center">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />

        {/* Modal Container */}
        <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-100 dark:border-slate-800">
          {/* Top Emerald Accent Bar */}
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
            <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A] shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
          </div>

          {/* Header */}
          <div className="border-b border-gray-100 dark:border-slate-800 px-6 pt-5 pb-4 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[#0F533A] dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider border border-emerald-200/60 dark:border-emerald-800/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Distribution Run • {distribution.barangay}
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl sm:text-2xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                  Distribution Operation Details
                </h3>
                <p className="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-slate-400">
                  Operational specifications, scheduled dispatch timing, and staff coverage.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                aria-label="Close"
              >
                <XIcon />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
            {/* Scope & Venue Banner */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Target Barangay & Venue
                  </p>
                  <h4 className="mt-0.5 text-base font-bold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
                    <MapPinIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{distribution.barangay}</span>
                    {distribution.location && (
                      <span className="text-slate-500 dark:text-slate-400 font-normal">
                        · {distribution.location}
                      </span>
                    )}
                  </h4>
                </div>

                <div>
                  {distribution.requiresBeneficiaryApproval ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Targeted (Proof Required)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      General Relief (Open to all)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Schedule & Lifecycle Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Scheduled Date */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
                  <CalendarIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Scheduled Timing</span>
                </div>
                <div className="text-base font-bold text-gray-900 dark:text-slate-100">
                  {formatScheduledDate(distribution.scheduled)}
                </div>
                {distribution.endsAt ? (
                  <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <ClockIcon className="w-3.5 h-3.5" />
                    <span>
                      Ends {new Date(distribution.endsAt).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                ) : null}
              </div>

              {/* Lifecycle & Claim Status */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
                  <ClockIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Operation Status</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <LifecyclePill status={distribution.lifecycleStatus} />
                  <ClaimProgressPill status={distribution.status} />
                </div>
              </div>
            </div>

            {/* Household Coverage Card */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <UsersIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>{distribution.requiresBeneficiaryApproval ? 'Eligible Beneficiaries Target' : 'Covered Households Target'}</span>
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-black text-[#0F533A] dark:text-emerald-400">
                    {distribution.households}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {distribution.requiresBeneficiaryApproval ? 'approved residents' : 'registered households'}
                  </span>
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <UsersIcon className="w-6 h-6" />
              </div>
            </div>

            {/* Covered Barangays (if multi-scope) */}
            {!!distribution.assignedBarangays?.length && (
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  Assigned Barangays Coverage ({distribution.assignedBarangays.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {distribution.assignedBarangays.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Assigned Staff */}
            {!!distribution.assignedStaffIds?.length && (
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  <UsersIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Assigned Field Staff & Volunteers ({distribution.assignedStaffIds.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {staffNames.length > 0 ? (
                    staffNames.map((name, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {name}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">
                      {distribution.assignedStaffIds.length} staff member{distribution.assignedStaffIds.length === 1 ? '' : 's'} assigned
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Notes if any */}
            {distribution.notes && (
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                  <FileTextIcon className="w-4 h-4 text-slate-400" />
                  <span>Operational Coordination Notes</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {distribution.notes}
                </p>
              </div>
            )}

            {/* Claimed/Completed details if claimed */}
            {distribution.claimedAt && (
              <div className="rounded-2xl border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    Completed Operation
                  </div>
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mt-0.5">
                    Marked completed on {new Date(distribution.claimedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <CheckCircleIcon className="w-5 h-5" />
                </div>
              </div>
            )}

            {/* Archive details if archived */}
            {distribution.archivedAt && (
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Archive Details
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Archived on {new Date(distribution.archivedAt).toLocaleString('en-PH')}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Archived by {distribution.archivedBy || 'Super admin'}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              Close
            </button>
            {distribution.status === 'Unclaimed' && distribution.lifecycleStatus === 'Active' && onMarkClaimed && (
              <button
                type="button"
                onClick={() => {
                  onMarkClaimed(distribution.id)
                  onClose()
                }}
                className="rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white px-5 py-2.5 text-sm font-bold shadow-md shadow-emerald-900/20 hover:shadow-lg transition-all flex items-center justify-center gap-2"
              >
                <CheckCircleIcon className="w-4 h-4" />
                <span>Mark as Completed</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----- Status Pill ----- */

function LifecyclePill({ status }: { status: 'Upcoming' | 'Active' | 'Completed' | 'Archived' }) {
  const styles = {
    Upcoming: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300',
    Active: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-300',
    Completed: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300',
    Archived: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  }[status]

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${styles}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function ClaimProgressPill({ status }: { status: 'Claimed' | 'Unclaimed' | 'Partially Claimed' }) {
  const isUnclaimed = status === 'Unclaimed'
  const isPartial = status === 'Partially Claimed'

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
        isUnclaimed
          ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300'
          : isPartial
          ? 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800/40 dark:bg-orange-950/30 dark:text-orange-300'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

/* ----- Icons ----- */

function XIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function CalendarIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function ClockIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function UsersIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function CheckCircleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function MapPinIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function FileTextIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

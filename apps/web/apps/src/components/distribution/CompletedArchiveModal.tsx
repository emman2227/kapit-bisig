'use client'

import React, { useMemo, useState } from 'react'
import SelectDropdown, { type SelectDropdownOption } from '@/components/ui/SelectDropdown'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'
import type { DistributionRow } from './DistributionsTable'

interface CompletedArchiveModalProps {
  open: boolean
  onClose: () => void
  rows: DistributionRow[]
  onSelectDetails: (distribution: DistributionRow) => void
  onSelectHouseholds: (distribution: DistributionRow) => void
}

function formatDate(dateString?: string | null): string {
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

export default function CompletedArchiveModal({
  open,
  onClose,
  rows,
  onSelectDetails,
  onSelectHouseholds,
}: CompletedArchiveModalProps) {
  const [query, setQuery] = useState('')
  const [sanitizedNotice, setSanitizedNotice] = useState(false)
  const [selectedBarangay, setSelectedBarangay] = useState('All')

  const handleQueryChange = (val: string) => {
    const sanitized = sanitizeSearchQuery(val)
    if (val.length > 0 && sanitized.length < val.length && val.length <= MAX_SEARCH_LENGTH) {
      setSanitizedNotice(true)
    } else {
      setSanitizedNotice(false)
    }
    setQuery(sanitized)
  }

  const handleClearQuery = () => {
    setQuery('')
    setSanitizedNotice(false)
  }

  const completedRows = useMemo(() => {
    return rows.filter((r) => r.status === 'Claimed')
  }, [rows])

  const barangayDropdownOptions: SelectDropdownOption[] = useMemo(() => {
    const unique = Array.from(new Set(completedRows.map((r) => r.barangay))).sort()
    return [{ value: 'All', label: 'All Barangays' }, ...unique.map((b) => ({ value: b, label: b }))]
  }, [completedRows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return completedRows.filter((r) => {
      const matchesQuery =
        !q ||
        r.barangay.toLowerCase().includes(q) ||
        (r.notes && r.notes.toLowerCase().includes(q))
      const matchesBarangay = selectedBarangay === 'All' || r.barangay === selectedBarangay
      return matchesQuery && matchesBarangay
    })
  }, [completedRows, query, selectedBarangay])

  const totalReliefDistributed = useMemo(() => {
    return completedRows.reduce((sum, r) => sum + (r.claimedHouseholds || r.households || 0), 0)
  }, [completedRows])

  const uniqueBarangaysCovered = useMemo(() => {
    return new Set(completedRows.map((r) => r.barangay)).size
  }, [completedRows])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[92vh]">
        {/* Top Emerald Accent Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
          <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A] shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
        </div>

        {/* Header */}
        <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-6 py-5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ArchiveIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Historical Records
                </p>
                <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Completed Distributions Archive
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
              aria-label="Close"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Quick Stats Banner */}
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 p-3.5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Completed Operations</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                {completedRows.length}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 p-3.5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Families Served</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                {totalReliefDistributed.toLocaleString()}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 p-3.5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Barangays Covered</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                {uniqueBarangaysCovered}
              </p>
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3.5 shrink-0 relative z-20">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* Search Input with Validation & 60 Character Limit */}
            <div className="relative w-full sm:flex-1">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  value={query}
                  maxLength={MAX_SEARCH_LENGTH}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search archived distributions or notes..."
                  className={[
                    'w-full h-11 rounded-xl border py-2 pl-9 pr-20 text-xs sm:text-sm placeholder-slate-400 outline-none transition-colors',
                    sanitizedNotice
                      ? 'border-amber-400 bg-amber-50/40 text-slate-800 dark:border-amber-500/80 dark:bg-amber-950/20 dark:text-slate-100'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800',
                  ].join(' ')}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  {query && (
                    <button
                      type="button"
                      onClick={handleClearQuery}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md"
                      aria-label="Clear search"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span
                    className={[
                      'text-[11px] font-mono tabular-nums select-none px-1.5 py-0.5 rounded border',
                      query.length >= MAX_SEARCH_LENGTH
                        ? 'font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700'
                        : 'text-slate-600 dark:text-slate-300 bg-slate-200/80 dark:bg-slate-700/80 border-slate-300 dark:border-slate-600',
                    ].join(' ')}
                    title={`Character limit: ${query.length}/${MAX_SEARCH_LENGTH}`}
                  >
                    {query.length}/{MAX_SEARCH_LENGTH}
                  </span>
                </div>
              </div>
              {sanitizedNotice && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 animate-fadeIn">
                  <WarningIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Special characters were automatically removed.</span>
                </div>
              )}
              {query.length >= MAX_SEARCH_LENGTH && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 animate-fadeIn">
                  <WarningIcon className="h-3.5 w-3.5 shrink-0" />
                  <span>Maximum limit of {MAX_SEARCH_LENGTH} characters reached.</span>
                </div>
              )}
            </div>

            <div className="w-full sm:w-56">
              <SelectDropdown
                value={selectedBarangay}
                onChange={setSelectedBarangay}
                options={barangayDropdownOptions}
                ariaLabel="Filter archived distributions by barangay"
                buttonClassName="h-11 text-xs sm:text-sm"
                menuClassName="w-60"
              />
            </div>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                <ArchiveIcon className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                No archived distributions found
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Completed relief operations will automatically appear here once marked as Claimed.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/60 p-4 sm:p-5 shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                          {item.barangay}
                        </h4>
                        {item.requiresBeneficiaryApproval && (
                          <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                            Verified Beneficiaries
                          </span>
                        )}
                      </div>

                      {/* Vertically Aligned Details List */}
                      <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                        <div className="flex items-center gap-2">
                          <span className="w-24 text-slate-400 dark:text-slate-400 font-semibold shrink-0">Scheduled:</span>
                          <span className="font-medium text-slate-700 dark:text-slate-200">{formatDate(item.scheduled)}</span>
                        </div>
                        {item.claimedAt && (
                          <div className="flex items-center gap-2">
                            <span className="w-24 text-slate-400 dark:text-slate-400 font-semibold shrink-0">Completed:</span>
                            <span className="font-medium text-slate-700 dark:text-slate-200">{formatDate(item.claimedAt)}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="w-24 text-slate-400 dark:text-slate-400 font-semibold shrink-0">Beneficiaries:</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {item.claimedHouseholds} / {item.registeredHouseholds || item.households} (100%)
                          </span>
                        </div>
                      </div>

                      {item.notes && (
                        <p className="text-xs italic text-slate-500 dark:text-slate-400 line-clamp-2 pt-1">
                          "{item.notes}"
                        </p>
                      )}
                    </div>

                    {/* Right Side: Status alongside View Households Action */}
                    <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 pt-2 sm:pt-0 shrink-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <CheckIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Completed
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          onSelectHouseholds(item)
                          onClose()
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 px-4 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-sm transition-all hover:scale-[1.02]"
                      >
                        <UsersIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        View Households
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 px-6 py-4 flex items-center justify-between shrink-0">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Showing {filtered.length} of {completedRows.length} completed operations
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Close Archive
          </button>
        </div>
      </div>
    </div>
  )
}

function ArchiveIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  )
}

function SearchIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function CloseIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function UsersIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function EyeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function WarningIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  )
}

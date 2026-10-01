'use client'

import React, { useEffect, useMemo, useState } from 'react'
import SelectDropdown, { type SelectDropdownOption } from '@/components/ui/SelectDropdown'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'
import type { DistributionOption } from './HouseholdsTable'

interface DistributionCycleModalProps {
  open: boolean
  onClose: () => void
  options: DistributionOption[]
  selectedId: string
  onSelect: (distributionId: string) => void
}

function formatTileDate(dateStr?: string) {
  if (!dateStr) return { month: 'DATE', day: '—', year: '', time: '' }
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return { month: 'DATE', day: '—', year: '', time: '' }

  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  const day = d.getDate().toString()
  const year = d.getFullYear().toString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })

  return { month, day, year, time }
}

function getGroupKey(dateStr?: string): { key: string; label: string; timestamp: number } {
  if (!dateStr) return { key: 'undated', label: 'Other Schedules', timestamp: 0 }
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return { key: 'undated', label: 'Other Schedules', timestamp: 0 }

  const year = d.getFullYear()
  const month = d.toLocaleDateString('en-US', { month: 'long' })
  const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const label = `${month} ${year}`
  const timestamp = new Date(year, d.getMonth(), 1).getTime()

  return { key, label, timestamp }
}

const LIFECYCLE_OPTIONS: SelectDropdownOption[] = [
  { value: 'All', label: 'All Statuses' },
  { value: 'Active', label: 'Active' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Archived', label: 'Archived' },
]

export default function DistributionCycleModal({
  open,
  onClose,
  options,
  selectedId,
  onSelect,
}: DistributionCycleModalProps) {
  const [query, setQuery] = useState('')
  const [sanitizedNotice, setSanitizedNotice] = useState(false)
  const [selectedBarangay, setSelectedBarangay] = useState<string>('All')
  const [lifecycleFilter, setLifecycleFilter] = useState<'All' | 'Active' | 'Completed' | 'Archived'>('All')

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

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Extract distinct barangays from the options list
  const barangayList = useMemo(() => {
    const set = new Set<string>()
    options.forEach((opt) => {
      if (opt.barangay) set.add(opt.barangay)
      if (opt.assignedBarangays) {
        opt.assignedBarangays.forEach((b) => set.add(b))
      }
    })
    return ['All', ...Array.from(set).sort()]
  }, [options])

  const barangayDropdownOptions: SelectDropdownOption[] = useMemo(() => {
    return barangayList.map((b) => ({
      value: b,
      label: b === 'All' ? 'All Barangays' : b,
    }))
  }, [barangayList])

  // Separate pinned options ("active" and "all") from specific distribution events
  const { activeQuickOption, lifetimeQuickOption, eventOptions } = useMemo(() => {
    let activeQuick: DistributionOption | undefined
    let lifetimeQuick: DistributionOption | undefined
    const events: DistributionOption[] = []

    options.forEach((opt) => {
      if (opt.value === 'active') {
        activeQuick = opt
      } else if (opt.value === 'all') {
        lifetimeQuick = opt
      } else {
        events.push(opt)
      }
    })

    return {
      activeQuickOption: activeQuick,
      lifetimeQuickOption: lifetimeQuick,
      eventOptions: events,
    }
  }, [options])

  // Filter historical distribution events
  const filteredEvents = useMemo(() => {
    const q = query.trim().toLowerCase()

    return eventOptions.filter((opt) => {
      // Barangay match
      if (selectedBarangay !== 'All') {
        const matchesHost = opt.barangay === selectedBarangay
        const matchesAssigned = opt.assignedBarangays?.includes(selectedBarangay)
        if (!matchesHost && !matchesAssigned) return false
      }

      // Lifecycle status filter
      if (lifecycleFilter !== 'All') {
        const itemStatus = (opt.lifecycleStatus || opt.status || '').toLowerCase()
        if (itemStatus !== lifecycleFilter.toLowerCase()) return false
      }

      // Text search match
      if (q) {
        const matchesLabel = opt.label.toLowerCase().includes(q)
        const matchesBarangay = opt.barangay?.toLowerCase().includes(q)
        const matchesNotes = opt.notes?.toLowerCase().includes(q)
        const matchesAssigned = opt.assignedBarangays?.some((b) => b.toLowerCase().includes(q))
        return Boolean(matchesLabel || matchesBarangay || matchesNotes || matchesAssigned)
      }

      return true
    })
  }, [eventOptions, query, selectedBarangay, lifecycleFilter])

  // Group filtered events chronologically (newest months first)
  const groupedEvents = useMemo(() => {
    const groups: Record<string, { label: string; timestamp: number; items: DistributionOption[] }> = {}

    filteredEvents.forEach((item) => {
      const { key, label, timestamp } = getGroupKey(item.scheduled)
      if (!groups[key]) {
        groups[key] = { label, timestamp, items: [] }
      }
      groups[key].items.push(item)
    })

    return Object.values(groups).sort((a, b) => b.timestamp - a.timestamp)
  }, [filteredEvents])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/45 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[92vh]">
        {/* Top Emerald Accent Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
          <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A] shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
        </div>

        {/* Header */}
        <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 px-5 sm:px-6 py-4 sm:py-5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CalendarHistoryIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
                  Relief Registry Scope
                </p>
                <h3 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Select Distribution Cycle
                </h3>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
              aria-label="Close dialog"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <p className="mt-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Choose an ongoing cycle or browse historical relief distributions to inspect household claim records.
          </p>
        </div>

        {/* Quick Selection Shortcuts (Pinned) */}
        <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-4 sm:p-5 shrink-0">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Quick Selections
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Active Cycle Card */}
            {activeQuickOption && (
              <button
                type="button"
                onClick={() => {
                  onSelect('active')
                  onClose()
                }}
                className={[
                  'flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all',
                  selectedId === 'active'
                    ? 'border-emerald-500 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-500 dark:border-emerald-500 dark:bg-emerald-950/40'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/80',
                ].join(' ')}
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/20 dark:text-emerald-300">
                  <ActivePulseIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                      Current / Active Cycle
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                    Inspect households in current ongoing distribution
                  </p>
                </div>
                {selectedId === 'active' && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </div>
                )}
              </button>
            )}

            {/* Lifetime / All Cycles Card */}
            {lifetimeQuickOption && (
              <button
                type="button"
                onClick={() => {
                  onSelect('all')
                  onClose()
                }}
                className={[
                  'flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all',
                  selectedId === 'all'
                    ? 'border-blue-500 bg-blue-50/80 shadow-sm ring-1 ring-blue-500 dark:border-blue-500 dark:bg-blue-950/40'
                    : 'border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50/80',
                ].join(' ')}
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/20 dark:text-blue-300">
                  <GlobeIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                      All Cycles (Lifetime Claimed)
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                    Aggregated history across all relief operations
                  </p>
                </div>
                {selectedId === 'all' && (
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
                    <CheckIcon className="h-3.5 w-3.5" />
                  </div>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 sm:px-6 py-3 shrink-0 relative z-20">
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
                  placeholder="Search past distribution by barangay, date, or notes..."
                  className={[
                    'w-full h-11 rounded-xl border py-2 pl-9 pr-20 text-xs sm:text-sm placeholder-slate-400 outline-none transition-colors',
                    sanitizedNotice
                      ? 'border-amber-400 bg-amber-50/40 text-slate-800 dark:border-amber-500/80 dark:bg-amber-950/20 dark:text-slate-100'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:bg-white dark:focus:bg-slate-800',
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

            {/* Barangay Filter (Using Global SelectDropdown) */}
            {barangayList.length > 2 && (
              <div className="w-full sm:w-48">
                <SelectDropdown
                  value={selectedBarangay}
                  onChange={setSelectedBarangay}
                  options={barangayDropdownOptions}
                  ariaLabel="Filter by barangay"
                  buttonClassName="h-11 text-xs sm:text-sm"
                  menuClassName="w-56"
                />
              </div>
            )}

            {/* Status Filter (Using Global SelectDropdown) */}
            <div className="w-full sm:w-40">
              <SelectDropdown
                value={lifecycleFilter}
                onChange={(val) => setLifecycleFilter(val as any)}
                options={LIFECYCLE_OPTIONS}
                ariaLabel="Filter by status"
                buttonClassName="h-11 text-xs sm:text-sm"
                menuClassName="w-48"
              />
            </div>
          </div>
        </div>

        {/* Scrollable Events Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {groupedEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                <CalendarHistoryIcon className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                No matching distribution events
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                No historical distribution records matched your search or filters.
              </p>
              {(query || selectedBarangay !== 'All' || lifecycleFilter !== 'All') && (
                <button
                  type="button"
                  onClick={() => {
                    handleClearQuery()
                    setSelectedBarangay('All')
                    setLifecycleFilter('All')
                  }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  Reset filters
                </button>
              )}
            </div>
          ) : (
            groupedEvents.map((group) => (
              <div key={group.label} className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <span>{group.label}</span>
                    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                      {group.items.length} {group.items.length === 1 ? 'event' : 'events'}
                    </span>
                  </h4>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {group.items.map((item) => {
                    const isSelected = item.value === selectedId
                    const tile = formatTileDate(item.scheduled)
                    const totalTarget = item.registeredHouseholds || item.households || 0
                    const claimed = item.claimedHouseholds || 0
                    const claimRate = totalTarget > 0 ? Math.min(100, Math.round((claimed / totalTarget) * 100)) : 0
                    const statusTag = item.lifecycleStatus || item.status || 'Completed'

                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          onSelect(item.value)
                          onClose()
                        }}
                        className={[
                          'group flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 rounded-2xl border p-3.5 text-left transition-all',
                          isSelected
                            ? 'border-blue-500 bg-blue-50/70 shadow-sm ring-1 ring-blue-500 dark:border-blue-500 dark:bg-blue-950/40'
                            : 'border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 hover:border-blue-300 dark:hover:border-slate-600 hover:bg-slate-50/70 dark:hover:bg-slate-800',
                        ].join(' ')}
                      >
                        {/* Left: Date Tile & Info */}
                        <div className="flex items-start gap-3.5 min-w-0">
                          {/* Calendar Tile */}
                          <div className="flex flex-col items-center justify-center h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-700/60 border border-slate-200/60 dark:border-slate-600/60 shrink-0 text-center">
                            <span className="text-[9px] font-extrabold text-blue-600 dark:text-blue-400 tracking-tight">
                              {tile.month}
                            </span>
                            <span className="text-base font-black text-slate-800 dark:text-slate-100 leading-none">
                              {tile.day}
                            </span>
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                {item.barangay || 'Relief Distribution'}
                              </span>
                              {item.assignedBarangays && item.assignedBarangays.length > 0 && (
                                <span className="rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                                  +{item.assignedBarangays.length} covered
                                </span>
                              )}
                              <span
                                className={[
                                  'rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase',
                                  statusTag.toLowerCase() === 'active'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                                    : statusTag.toLowerCase() === 'archived'
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
                                      : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
                                ].join(' ')}
                              >
                                {statusTag}
                              </span>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              {tile.time && (
                                <span className="flex items-center gap-1">
                                  <ClockIcon className="h-3 w-3 text-slate-400" />
                                  {tile.time}
                                </span>
                              )}
                              {item.notes && (
                                <span className="truncate max-w-[240px] text-slate-400 dark:text-slate-500 italic">
                                  • {item.notes}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Claim progress and selection indicator */}
                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/60 pt-2 sm:pt-0">
                          {totalTarget > 0 ? (
                            <div className="text-right">
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {claimed.toLocaleString()} / {totalTarget.toLocaleString()}{' '}
                                <span className="text-[10px] text-slate-400 font-normal">claimed</span>
                              </p>
                              <div className="mt-1 flex items-center gap-1.5">
                                <div className="h-1.5 w-20 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                  <div
                                    className={[
                                      'h-full rounded-full transition-all',
                                      claimRate >= 80 ? 'bg-emerald-500' : claimRate >= 40 ? 'bg-amber-500' : 'bg-blue-500',
                                    ].join(' ')}
                                    style={{ width: `${claimRate}%` }}
                                  />
                                </div>
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                  {claimRate}%
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">No claim stats</span>
                          )}

                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                              <CheckIcon className="h-3 w-3" />
                              Selected
                            </span>
                          ) : (
                            <span className="hidden sm:inline-block text-[11px] font-semibold text-blue-600 dark:text-blue-400 group-hover:underline">
                              Select Cycle →
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 px-5 sm:px-6 py-3.5 shrink-0 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            {filteredEvents.length} past {filteredEvents.length === 1 ? 'event' : 'events'} available
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function CalendarHistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  )
}

function ActivePulseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" strokeWidth={2} />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function WarningIcon({ className }: { className?: string }) {
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

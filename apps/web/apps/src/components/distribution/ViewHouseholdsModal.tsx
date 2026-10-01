'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api, DistributionHouseholdsData } from '../../lib/api'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '../../lib/inputValidation'
import Pagination from '@/components/ui/Pagination'
import type { DistributionRow } from './DistributionsTable'

const HOUSEHOLDS_PER_PAGE = 8

function getInitials(name: string): string {
  if (!name) return 'H'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function ViewHouseholdsModal({
  open,
  onClose,
  distribution,
}: {
  open: boolean
  onClose: () => void
  distribution: DistributionRow | null
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DistributionHouseholdsData | null>(null)
  const [activeTab, setActiveTab] = useState<'claimed' | 'notYetClaimed'>('notYetClaimed')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [newClaimCount, setNewClaimCount] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const knownClaimIdsRef = useRef<Set<string>>(new Set())
  const hasLoadedRef = useRef(false)

  const fetchData = useCallback(async (distributionId: string, silent = false) => {
    if (silent) setIsRefreshing(true)
    else setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await api.getDistributionHouseholds(distributionId)
      if (res.success && res.data) {
        const nextIds = new Set(res.data.claimed.map((claim) => claim.claimId || claim.householdId))
        if (hasLoadedRef.current) {
          const newlyDetected = [...nextIds].filter((id) => !knownClaimIdsRef.current.has(id)).length
          if (newlyDetected > 0) setNewClaimCount((count) => count + newlyDetected)
        }
        knownClaimIdsRef.current = nextIds
        hasLoadedRef.current = true
        setData(res.data)
        setLastUpdated(new Date())
      } else if (!silent) setError(res.message || 'Failed to load households')
    } catch (err: unknown) {
      console.error('Failed to load households:', err)
      if (!silent) setError('Failed to load households. Please try again.')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  const distributionId = distribution?.id

  useEffect(() => {
    if (open && distributionId) {
      setSearch('')
      setActiveTab('notYetClaimed')
      setPage(1)
      setData(null)
      setNewClaimCount(0)
      setLastUpdated(null)
      knownClaimIdsRef.current = new Set()
      hasLoadedRef.current = false
      fetchData(distributionId)
    }
  }, [open, distributionId, fetchData])

  useEffect(() => {
    setPage(1)
  }, [activeTab, search])

  useEffect(() => {
    if (!open || !distributionId) return
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') fetchData(distributionId, true)
    }
    const intervalId = window.setInterval(refreshIfVisible, 4000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [open, distributionId, fetchData])

  if (!open || !distribution) return null

  const noRegistered = data && data.totals.registered === 0
  const populationLabel = data?.requiresBeneficiaryApproval ? 'Eligible' : 'Registered'
  const emptyPopulationLabel = data?.requiresBeneficiaryApproval ? 'approved beneficiary' : 'registered household'

  const filteredClaimed = data?.claimed.filter((h) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      h.householdName.toLowerCase().includes(q) ||
      (h.householdCode || '').toLowerCase().includes(q) ||
      h.barangay.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q)
    )
  }) ?? []

  const filteredNotYetClaimed = data?.notYetClaimed.filter((h) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      h.householdName.toLowerCase().includes(q) ||
      (h.householdCode || '').toLowerCase().includes(q) ||
      h.barangay.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q)
    )
  }) ?? []

  const activeItemsCount = activeTab === 'claimed' ? filteredClaimed.length : filteredNotYetClaimed.length
  const totalPages = Math.max(1, Math.ceil(activeItemsCount / HOUSEHOLDS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const rangeStart = (currentPage - 1) * HOUSEHOLDS_PER_PAGE
  const rangeEnd = currentPage * HOUSEHOLDS_PER_PAGE
  const paginatedClaimed = filteredClaimed.slice(rangeStart, rangeEnd)
  const paginatedNotYetClaimed = filteredNotYetClaimed.slice(
    (currentPage - 1) * HOUSEHOLDS_PER_PAGE,
    currentPage * HOUSEHOLDS_PER_PAGE,
  )

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full px-4 py-6 sm:py-10 flex items-center justify-center">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />

        {/* Modal Container */}
        <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-100 dark:border-slate-800">
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
                    Live Telemetry • Host: {distribution.barangay}
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl sm:text-2xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                  Covered Households
                </h3>
                <p className="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-slate-400">
                  Real-time relief claim status and household coverage for this distribution cycle.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => fetchData(distribution.id, true)}
                  disabled={isRefreshing}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 shadow-sm"
                  title="Refresh households"
                >
                  <RefreshIcon className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-600' : 'text-slate-500'}`} />
                  <span className="hidden sm:inline">{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
                </button>

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
          </div>

          {/* Modal Body */}
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Loading households data…</p>
              </div>
            )}

            {/* Error state */}
            {error && !loading && (
              <div className="rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/80 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300 text-center flex items-center justify-center gap-2">
                <AlertCircleIcon className="w-5 h-5 text-red-500 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* No registered households */}
            {!loading && !error && noRegistered && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3 text-slate-400">
                  <UsersEmptyIcon />
                </div>
                <h4 className="text-base font-bold text-gray-900 dark:text-slate-100">No {emptyPopulationLabel}</h4>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 max-w-sm">
                  There are no {emptyPopulationLabel}s assigned or registered for {distribution.barangay} in this distribution run.
                </p>
              </div>
            )}

            {/* Has registered households */}
            {!loading && !error && data && !noRegistered && (
              <div className="space-y-4">
                {/* New claim alert if any */}
                {newClaimCount > 0 && (
                  <button
                    type="button"
                    onClick={() => { setActiveTab('claimed'); setNewClaimCount(0) }}
                    className="w-full flex items-center justify-between rounded-2xl border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/80 dark:bg-emerald-950/40 px-4 py-3 text-left text-xs sm:text-sm font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 transition-all shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                      <span>New claim recorded ({newClaimCount}). View Claimed tab →</span>
                    </div>
                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 underline">Switch tab</span>
                  </button>
                )}

                {/* Live update status chip */}
                {lastUpdated && (
                  <div className="flex items-center justify-end gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Live telemetry updated {lastUpdated.toLocaleTimeString('en-PH')}</span>
                  </div>
                )}

                {/* 3 Metric Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <SummaryCard
                    label={populationLabel}
                    value={data.totals.registered}
                    color="text-slate-900 dark:text-slate-100"
                    bg="bg-slate-50/80 dark:bg-slate-800/50"
                    border="border-slate-200/80 dark:border-slate-700/80"
                    icon={<UsersIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" />}
                  />
                  <SummaryCard
                    label="Claimed"
                    value={data.totals.claimed}
                    color="text-emerald-600 dark:text-emerald-400"
                    bg="bg-emerald-50/50 dark:bg-emerald-950/20"
                    border="border-emerald-200/80 dark:border-emerald-800/50"
                    icon={<CheckCircleIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
                  />
                  <SummaryCard
                    label="Not Yet Claimed"
                    value={data.totals.notYetClaimed}
                    color="text-amber-600 dark:text-amber-400"
                    bg="bg-amber-50/50 dark:bg-amber-950/20"
                    border="border-amber-200/80 dark:border-amber-800/50"
                    icon={<ClockIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
                  />
                </div>

                {/* Search Bar */}
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                    <SearchIcon />
                  </span>
                  <input
                    value={search}
                    onChange={(e) => setSearch(sanitizeSearchQuery(e.target.value))}
                    maxLength={MAX_SEARCH_LENGTH}
                    placeholder="Search by household name, registry code, or address…"
                    className="w-full pl-10 pr-10 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60 text-slate-800 dark:text-slate-200 placeholder-slate-400 text-sm focus:outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Tab Switcher */}
                <div className="flex rounded-2xl bg-slate-100 dark:bg-slate-800/80 p-1.5 border border-slate-200/60 dark:border-slate-700/60">
                  <TabButton
                    active={activeTab === 'notYetClaimed'}
                    label="Not Yet Claimed"
                    count={data.totals.notYetClaimed}
                    onClick={() => setActiveTab('notYetClaimed')}
                  />
                  <TabButton
                    active={activeTab === 'claimed'}
                    label="Claimed"
                    count={data.totals.claimed}
                    onClick={() => setActiveTab('claimed')}
                  />
                </div>

                {/* Lists */}
                {activeTab === 'notYetClaimed' && (
                  <div className="space-y-2.5">
                    {filteredNotYetClaimed.length === 0 ? (
                      <EmptyList message={search ? 'No unclaimed households match your search query.' : 'All registered households have received aid!'} />
                    ) : (
                      paginatedNotYetClaimed.map((h) => (
                        <div
                          key={h.householdId}
                          className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-800/40 p-3.5 sm:p-4 hover:border-emerald-500/40 hover:bg-emerald-50/10 dark:hover:bg-emerald-950/10 transition-all flex items-start justify-between gap-3 shadow-sm"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 font-bold shrink-0 border border-slate-200/60 dark:border-slate-700/60 text-xs">
                              {getInitials(h.householdName)}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">
                                {h.householdName}
                              </h4>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {h.householdCode || 'No code'}
                                </span>
                                <span className="text-xs text-slate-400 dark:text-slate-500">•</span>
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{h.barangay}</span>
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                                <MapPinIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{h.address}</span>
                              </p>
                            </div>
                          </div>

                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-400 shrink-0">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            Unclaimed
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'claimed' && (
                  <div className="space-y-2.5">
                    {filteredClaimed.length === 0 ? (
                      <EmptyList message={search ? 'No claimed households match your search query.' : 'No relief claims have been recorded yet.'} />
                    ) : (
                      paginatedClaimed.map((h) => (
                        <div
                          key={h.householdId}
                          className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-800/40 p-3.5 sm:p-4 hover:border-emerald-500/40 hover:bg-emerald-50/10 dark:hover:bg-emerald-950/10 transition-all shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold shrink-0 border border-emerald-200/60 dark:border-emerald-800/40 text-xs">
                                {getInitials(h.householdName)}
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-sm font-bold text-gray-900 dark:text-slate-100 truncate">
                                  {h.householdName}
                                </h4>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                    {h.householdCode || 'No code'}
                                  </span>
                                  <span className="text-xs text-slate-400 dark:text-slate-500">•</span>
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{h.barangay}</span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                                  <MapPinIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                  <span className="truncate">{h.address}</span>
                                </p>
                              </div>
                            </div>

                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400 shrink-0">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Claimed
                            </span>
                          </div>

                          {/* Claim Metadata Footer */}
                          <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <div className="flex items-center gap-2">
                              {h.claimedAt && (
                                <span>
                                  Claimed: {new Date(h.claimedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              )}
                              {h.scanner?.name && (
                                <span>• Scanned by {h.scanner.name}</span>
                              )}
                            </div>
                            {h.proofMethod && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {h.proofMethod}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Pagination */}
                {activeItemsCount > 0 && (
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={HOUSEHOLDS_PER_PAGE}
                    totalItems={activeItemsCount}
                    onPageChange={setPage}
                    variant="modal"
                    itemLabel="households"
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {data ? `Total ${data.totals.registered} ${populationLabel.toLowerCase()} households` : 'Households coverage'}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----- Sub-components ----- */

function SummaryCard({
  label,
  value,
  color,
  bg,
  border,
  icon,
}: {
  label: string
  value: number
  color: string
  bg: string
  border: string
  icon: React.ReactNode
}) {
  return (
    <div className={`p-4 rounded-2xl border ${border} ${bg} flex items-center justify-between transition-all shadow-sm`}>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`text-2xl font-black tracking-tight mt-0.5 ${color}`}>{value}</div>
      </div>
      <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center shrink-0 shadow-xs">
        {icon}
      </div>
    </div>
  )
}

function TabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
        active
          ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm'
          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
      }`}
    >
      <span>{label}</span>
      <span
        className={`px-2 py-0.5 rounded-full text-[11px] ${
          active
            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold'
            : 'bg-slate-200/70 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function EmptyList({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center">
      <p className="text-sm font-medium text-slate-400 dark:text-slate-500">{message}</p>
    </div>
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

function UsersIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function UsersEmptyIcon() {
  return (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function CheckCircleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ClockIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function RefreshIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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

function AlertCircleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

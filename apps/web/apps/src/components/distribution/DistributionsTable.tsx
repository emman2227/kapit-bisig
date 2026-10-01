'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import DistributionDetailsModal from './DistributionDetailsModal'
import ViewHouseholdsModal from './ViewHouseholdsModal'
import RescheduleDistributionModal from './RescheduleDistributionModal'
import CompletedArchiveModal from './CompletedArchiveModal'
import EditDistributionStaffModal from './EditDistributionStaffModal'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'

export type DistributionStatus = 'Unclaimed' | 'Partially Claimed' | 'Claimed'
export type DistributionLifecycleStatus = 'Upcoming' | 'Active' | 'Completed' | 'Archived'

export type DistributionRow = {
  id: string
  barangay: string
  location?: string
  assignedBarangays: string[]
  assignedStaffIds?: string[]
  scheduled: string
  endsAt?: string | null
  households: number
  registeredHouseholds: number
  claimedHouseholds: number
  notes?: string
  requiresBeneficiaryApproval?: boolean
  status: DistributionStatus
  claimedAt: string | null
  createdAt: string
  archivedAt?: string | null
  archivedBy?: string | null
  lifecycleStatus: DistributionLifecycleStatus
}

type BarangayFilter = 'All' | string
type StatusFilter = 'All' | DistributionStatus

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'All', label: 'All claim progress' },
  { value: 'Unclaimed', label: 'Unclaimed' },
  { value: 'Partially Claimed', label: 'Partially Claimed' },
  { value: 'Claimed', label: 'Claimed' },
]

export function formatScheduledDate(value?: string | null): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const hasTime = value.includes('T') || value.includes(':')
  if (hasTime) {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function DistributionsTable({
  rows,
  onOpenCreate,
  onMarkClaimed,
  onRefresh,
  canCreate = true,
  lifecycleView,
  canManageLifecycle = false,
  onArchive,
  onRestore,
}: {
  rows: DistributionRow[]
  onOpenCreate: () => void
  onMarkClaimed: (id: string) => void
  onRefresh?: () => void
  canCreate?: boolean
  lifecycleView: 'upcoming' | 'active' | 'completed' | 'archived'
  canManageLifecycle?: boolean
  onArchive?: (id: string) => void
  onRestore?: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [barangay, setBarangay] = useState<BarangayFilter>('All')
  const [status, setStatus] = useState<StatusFilter>('All')

  const PAGE_SIZE = 5
  const [currentPage, setCurrentPage] = useState(1)

  const [barangayOpen, setBarangayOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)

  const barangayBtnRef = useRef<HTMLButtonElement>(null)
  const barangayMenuRef = useRef<HTMLDivElement>(null)
  const statusBtnRef = useRef<HTMLButtonElement>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{
    top?: number
    bottom?: number
    left: number
    opensUp: boolean
    maxHeight: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const [selectedDistribution, setSelectedDistribution] = useState<DistributionRow | null>(null)
  const [householdsDistribution, setHouseholdsDistribution] = useState<DistributionRow | null>(null)
  const [rescheduleDistribution, setRescheduleDistribution] = useState<DistributionRow | null>(null)
  const [editStaffDistribution, setEditStaffDistribution] = useState<DistributionRow | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const completedCount = useMemo(() => rows.filter((r) => r.lifecycleStatus === 'Completed').length, [rows])

  const barangayOptions = useMemo(() => {
    const unique = Array.from(new Set(rows.map((r) => r.barangay))).sort()
    return [{ value: 'All', label: 'All Barangays' }, ...unique.map((b) => ({ value: b, label: b }))]
  }, [rows])

  const closeRowMenu = useCallback(() => {
    setActiveMenu(null)
    setMenuPos(null)
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [query, barangay, status])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    return rows.filter((r) => {
      const matchesQuery = !q || r.barangay.toLowerCase().includes(q)
      const matchesBarangay = barangay === 'All' || r.barangay === barangay
      const matchesStatus = status === 'All' || r.status === status
      return matchesQuery && matchesBarangay && matchesStatus
    })
  }, [rows, query, barangay, status])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    [filtered.length, PAGE_SIZE],
  )

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, currentPage, PAGE_SIZE])

  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filtered.length)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      const inBrgyBtn = barangayBtnRef.current?.contains(target)
      const inBrgyMenu = barangayMenuRef.current?.contains(target)
      if (!inBrgyBtn && !inBrgyMenu) setBarangayOpen(false)

      const inStatusBtn = statusBtnRef.current?.contains(target)
      const inStatusMenu = statusMenuRef.current?.contains(target)
      if (!inStatusBtn && !inStatusMenu) setStatusOpen(false)

      const inRowMenuBtn = target.closest('[data-row-menu]')
      const inPortalMenu = menuRef.current?.contains(target)
      if (!inRowMenuBtn && !inPortalMenu) closeRowMenu()
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [closeRowMenu])

  useEffect(() => {
    if (!activeMenu) return
    const close = () => closeRowMenu()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [activeMenu, closeRowMenu])


  const toggleRowMenu = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (activeMenu === id) {
      closeRowMenu()
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const menuWidth = 224
    const estimatedMenuHeight = 290
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const opensUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow

    const left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12))

    setMenuPos({
      top: opensUp ? undefined : rect.bottom + 8,
      bottom: opensUp ? window.innerHeight - rect.top + 8 : undefined,
      left,
      opensUp,
      maxHeight: Math.min(opensUp ? spaceAbove : spaceBelow, 360),
    })
    setActiveMenu(id)
    setBarangayOpen(false)
    setStatusOpen(false)
  }

  const barangayLabel = barangay === 'All' ? 'All Barangays' : barangay
  const statusLabel = status === 'All' ? 'All claim progress' : status

  return (
    <>
      <DistributionDetailsModal
        open={selectedDistribution !== null}
        onClose={() => setSelectedDistribution(null)}
        distribution={
          selectedDistribution
            ? rows.find((r) => r.id === selectedDistribution.id) || selectedDistribution
            : null
        }
        onMarkClaimed={onMarkClaimed}
      />

      <ViewHouseholdsModal
        open={householdsDistribution !== null}
        onClose={() => setHouseholdsDistribution(null)}
        distribution={
          householdsDistribution
            ? rows.find((r) => r.id === householdsDistribution.id) || householdsDistribution
            : null
        }
      />

      <div className="mb-12 overflow-hidden rounded-[28px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
        <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Distribution Directory</p>
              <h3 className="mt-2 text-xl font-bold tracking-[-0.03em] text-slate-950 dark:text-slate-100">
                {lifecycleView.charAt(0).toUpperCase() + lifecycleView.slice(1)} distributions
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {filtered.length} visible distribution{filtered.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {barangay !== 'All' ? (
                <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Barangay: {barangayLabel}
                </span>
              ) : null}
              {status !== 'All' ? (
                <span className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Status: {statusLabel}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-md">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                <SearchIcon />
              </span>
              <input
                type="text"
                maxLength={MAX_SEARCH_LENGTH}
                value={query}
                onChange={(e) => setQuery(sanitizeSearchQuery(e.target.value))}
                placeholder="Search distributions..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2.5 pl-10 pr-20 text-sm text-slate-800 dark:text-slate-200 placeholder-slate-400 shadow-sm outline-none transition-colors focus:border-slate-400 dark:focus:border-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-0"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-md"
                    aria-label="Clear search"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
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

            <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
              <div className="relative min-w-[180px]">
                <button
                  ref={barangayBtnRef}
                  type="button"
                  onClick={() => {
                    setBarangayOpen((v) => !v)
                    setStatusOpen(false)
                    setActiveMenu(null)
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 shadow-sm transition-colors hover:bg-white dark:hover:bg-slate-700"
                >
                  <span className="truncate">{barangayLabel}</span>
                  <ChevronDownIcon />
                </button>
                {barangayOpen ? (
                  <DropdownMenu
                    menuRef={barangayMenuRef}
                    items={barangayOptions}
                    selected={barangay}
                    onSelect={(value) => {
                      setBarangay(value)
                      setBarangayOpen(false)
                    }}
                  />
                ) : null}
              </div>

              <div className="relative min-w-[190px]">
                <button
                  ref={statusBtnRef}
                  type="button"
                  onClick={() => {
                    setStatusOpen((v) => !v)
                    setBarangayOpen(false)
                    setActiveMenu(null)
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 shadow-sm transition-colors hover:bg-white dark:hover:bg-slate-700"
                >
                  <span className="truncate">{statusLabel}</span>
                  <ChevronDownIcon />
                </button>
                {statusOpen ? (
                  <DropdownMenu
                    menuRef={statusMenuRef}
                    items={statusOptions}
                    selected={status}
                    onSelect={(value) => {
                      setStatus(value)
                      setStatusOpen(false)
                    }}
                  />
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => setArchiveOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm transition-all hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <ArchiveIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <span>Archive</span>
                {completedCount > 0 && (
                  <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 text-xs font-bold">
                    {completedCount}
                  </span>
                )}
              </button>

              {canCreate ? (
                <button
                  type="button"
                  onClick={onOpenCreate}
                  className="ml-1 inline-flex items-center justify-center whitespace-nowrap gap-2 rounded-xl bg-[#0F533A] px-5 py-2.5 text-sm font-bold text-white shadow-[0_2px_10px_rgba(0,0,0,0.10)] transition-all duration-300 hover:bg-[#0a3f2c] hover:scale-[1.02] hover:shadow-[0_4px_14px_rgba(0,0,0,0.15)]"
                >
                  + New Distribution
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-transparent text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-6 py-4">Barangay</th>
                <th className="px-6 py-4">Registered Households</th>
                <th className="px-6 py-4">Claims</th>
                <th className="px-6 py-4">Scheduled For</th>
                <th className="px-6 py-4">Lifecycle / Claim Progress</th>
                <th className="px-6 py-4">Claimed On</th>
                <th className="px-6 py-4 text-right pr-6">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-transparent">
              {pagedRows.length ? (
                pagedRows.map((row) => (
                  <tr key={row.id} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300">
                          {row.barangay.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-slate-100">{row.barangay}</div>
                          {row.location ? (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]" title={row.location}>
                              📍 {row.location}
                            </div>
                          ) : null}
                          <div className="mt-0.5">
                            {row.requiresBeneficiaryApproval ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Targeted (Proof Required)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                General Relief
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        <UsersMiniIcon />
                        {row.registeredHouseholds > 0 ? row.registeredHouseholds : '--'}
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {row.claimedHouseholds > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-100 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                            <CheckMiniIcon />
                            {row.claimedHouseholds}
                          </span>
                        ) : (
                          <span className="text-sm font-medium text-slate-400 dark:text-slate-500">0</span>
                        )}
                        {row.registeredHouseholds > 0 ? (
                          <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">/ {row.registeredHouseholds}</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-sm font-medium text-slate-700 dark:text-slate-300">{formatScheduledDate(row.scheduled)}</td>

                    <td className="px-6 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <LifecyclePill status={row.lifecycleStatus} />
                        <StatusPill status={row.status} />
                      </div>
                    </td>

                    <td className="px-6 py-4 text-sm font-medium text-slate-600 dark:text-slate-400">
                      {row.claimedAt
                        ? new Date(row.claimedAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '--'}
                    </td>

                    <td className="px-6 py-4 text-right pr-6">
                      <div className="inline-block" data-row-menu>
                        <button
                          onClick={(e) => toggleRowMenu(row.id, e)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition-all duration-300 hover:border-[#004A1C]/30 hover:bg-slate-50 hover:text-[#004A1C] focus:outline-none focus:ring-2 focus:ring-[#004A1C]/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-[#ECC323]/50 dark:hover:bg-slate-800/50 dark:hover:text-[#ECC323] dark:focus:ring-[#ECC323]/20"
                        >
                          Manage <ChevronDownIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <p className="font-medium text-slate-500">No distributions found matching your filter criteria.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-gray-100 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
              Showing {rangeStart}-{rangeEnd} of {filtered.length}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage <= 1}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Previous
              </button>

              <span className="min-w-[88px] text-center text-xs font-semibold text-gray-600 dark:text-slate-300">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {activeMenu && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                top: menuPos.top,
                bottom: menuPos.bottom,
                left: menuPos.left,
                maxHeight: menuPos.maxHeight,
              }}
              className="z-[9999] w-56 overflow-y-auto rounded-2xl border border-[#DCDCDC] bg-[#ECECEC] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.14)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
            >
              <div className="flex flex-col gap-1">
                {(() => {
                  const row = filtered.find((item) => item.id === activeMenu)
                  if (!row) return null

                  return (
                    <>
                      <MenuItem
                        icon={<EyeIcon />}
                        label="View Details"
                        onClick={() => {
                          setSelectedDistribution(row)
                          closeRowMenu()
                        }}
                      />
                      <MenuItem
                        icon={<HouseholdsIcon />}
                        label="View Households"
                        onClick={() => {
                          setHouseholdsDistribution(row)
                          closeRowMenu()
                        }}
                      />
                      {canManageLifecycle && row.status !== 'Claimed' && row.lifecycleStatus !== 'Archived' ? (
                        <MenuItem
                          icon={<CalendarIcon />}
                          label="Reschedule"
                          tone="warning"
                          onClick={() => {
                            setRescheduleDistribution(row)
                            closeRowMenu()
                          }}
                        />
                      ) : null}
                      {canManageLifecycle && row.status !== 'Claimed' && row.lifecycleStatus !== 'Archived' ? (
                        <MenuItem
                          icon={<UsersStaffIcon />}
                          label="Edit Assigned Staff"
                          onClick={() => {
                            setEditStaffDistribution(row)
                            closeRowMenu()
                          }}
                        />
                      ) : null}
                      {row.status !== 'Claimed' && row.lifecycleStatus === 'Active' ? (
                        <MenuItem
                          icon={<CheckGreenIcon />}
                          label="Mark claim progress complete"
                          tone="success"
                          onClick={() => {
                            onMarkClaimed(row.id)
                            closeRowMenu()
                          }}
                        />
                      ) : null}
                      {canManageLifecycle && (row.lifecycleStatus === 'Completed' || row.status === 'Claimed') && row.lifecycleStatus !== 'Archived' && onArchive ? (
                        <MenuItem
                          icon={<ArchiveIcon className="h-4 w-4" />}
                          label="Archive distribution"
                          onClick={() => {
                            onArchive(row.id)
                            closeRowMenu()
                          }}
                        />
                      ) : null}
                      {canManageLifecycle && row.lifecycleStatus === 'Archived' && onRestore ? (
                        <MenuItem
                          icon={<ArchiveIcon className="h-4 w-4" />}
                          label="Restore distribution"
                          onClick={() => {
                            onRestore(row.id)
                            closeRowMenu()
                          }}
                        />
                      ) : null}
                    </>
                  )
                })()}
              </div>
            </div>,
            document.body,
          )
        : null}

      {rescheduleDistribution && (
        <RescheduleDistributionModal
          open={Boolean(rescheduleDistribution)}
          distribution={rescheduleDistribution}
          onClose={() => setRescheduleDistribution(null)}
          onSuccess={() => {
            onRefresh?.()
          }}
        />
      )}

      {editStaffDistribution && (
        <EditDistributionStaffModal
          open={Boolean(editStaffDistribution)}
          distribution={editStaffDistribution}
          onClose={() => setEditStaffDistribution(null)}
          onSuccess={() => {
            onRefresh?.()
          }}
        />
      )}

      <CompletedArchiveModal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        rows={rows}
        onSelectDetails={(d) => {
          setSelectedDistribution(d)
        }}
        onSelectHouseholds={(d) => {
          setHouseholdsDistribution(d)
        }}
      />
    </>
  )
}

function DropdownMenu({
  menuRef,
  items,
  selected,
  onSelect,
}: {
  menuRef: React.RefObject<HTMLDivElement>
  items: { value: string; label: string }[]
  selected: string
  onSelect: (value: any) => void
}) {
  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-full z-50 mt-2 min-w-full w-max rounded-2xl border border-[#DCDCDC] bg-[#ECECEC] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.14)] dark:border-slate-700 dark:bg-slate-800 dark:shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
    >
      {items.map((option) => {
        const isSelected = option.value === selected
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className={[
              'w-full flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors whitespace-nowrap',
              isSelected ? 'bg-[#EAB308] text-gray-900 font-medium' : 'text-slate-700 hover:bg-white/70 dark:text-slate-200 dark:hover:bg-slate-700 font-medium',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              <span className="flex w-5 items-center justify-center shrink-0">{isSelected ? <CheckIcon /> : null}</span>
              <span className="whitespace-nowrap">{option.label}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function LifecyclePill({ status }: { status: DistributionLifecycleStatus }) {
  const classes = {
    Upcoming: 'border-amber-200 bg-amber-50 text-amber-700',
    Active: 'border-blue-200 bg-blue-50 text-blue-700',
    Completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Archived: 'border-slate-300 bg-slate-100 text-slate-600',
  }[status]

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${classes}`}>
      {status}
    </span>
  )
}

function StatusPill({ status }: { status: DistributionStatus }) {
  const classes =
    status === 'Claimed'
      ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
      : status === 'Partially Claimed'
        ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
        : 'border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'

  const dotClass =
    status === 'Claimed'
      ? 'bg-emerald-500 dark:bg-emerald-400'
      : status === 'Partially Claimed'
        ? 'bg-blue-500 dark:bg-blue-400'
        : 'bg-amber-500 dark:bg-amber-400'

  const label = status

  return (
    <span className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${classes}`}>
      <span className={`mr-2 h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  tone?: 'default' | 'success' | 'warning'
}) {
  const classes =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
        : 'text-slate-700 hover:bg-white/70 dark:text-slate-200 dark:hover:bg-slate-700'
  const iconClass =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-slate-500 dark:text-slate-400'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${classes}`}
    >
      <span className={iconClass}>{icon}</span>
      {label}
    </button>
  )
}

function CalendarIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function UsersMiniIcon() {
  return (
    <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}


function CheckGreenIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function CheckMiniIcon() {
  return (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function HouseholdsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function ArchiveIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  )
}

function UsersStaffIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}


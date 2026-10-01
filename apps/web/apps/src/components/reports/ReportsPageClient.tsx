'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import api, { getScopedBarangays, type ReportSummaryData, type ReportDistributionRow } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { DetailModal } from './DetailModal'
import SectionHeader from '@/components/ui/SectionHeader'
import { 
  formatDate, Dropdown, StatCard, StatusPill, ClaimRateBar, 
  Donut, MiniBarChart, SummaryCell, MenuItem, LoadingSpinner, EmptyState,
  FilterIcon, BoltIcon, DownloadIcon, ClearIcon, DocIcon, CubeIcon, UsersIcon, TrendIcon, UnclaimedIcon, DotsIcon, EyeIcon, QRIcon, FaceIcon, QuestionIcon, downloadCSV, DropdownItem, AlertIcon,
  getDatePresetRange, Pagination
} from './ReportsHelpers'

type ReportType = 'distribution' | 'barangay'

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'distribution', label: 'Distribution Summary' },
  { value: 'barangay', label: 'Barangay Summary' },
]

const DONUT_COLORS = [
  '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#06B6D4',
  '#EC4899', '#F97316', '#14B8A6', '#6366F1', '#84CC16',
]

// ─── Main Component ─────────────────────────────────────────

export default function ReportsPageClient() {
  const { user } = useAuth()
  const scopedBarangays = useMemo(
    () => getScopedBarangays(user?.role, user?.assignedBarangays),
    [user?.role, user?.assignedBarangays],
  )

  const [reportType, setReportType] = useState<ReportType>('distribution')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [barangay, setBarangay] = useState('All')
  const [activePreset, setActivePreset] = useState<string>('all')

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [brgyCurrentPage, setBrgyCurrentPage] = useState(1)
  const [brgyPageSize, setBrgyPageSize] = useState(10)

  const [data, setData] = useState<ReportSummaryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generated, setGenerated] = useState(false)

  // detail modal
  const [detailRow, setDetailRow] = useState<ReportDistributionRow | null>(null)

  // row menu
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{
    top?: number
    bottom?: number
    left: number
    maxHeight: number
  } | null>(null)
  const rowMenuWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rowMenuWrapRef.current && !rowMenuWrapRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
        setMenuPos(null)
      }
    }
    const onWindowChange = () => {
      setActiveMenu(null)
      setMenuPos(null)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onWindowChange, true)
    window.addEventListener('resize', onWindowChange)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onWindowChange, true)
      window.removeEventListener('resize', onWindowChange)
    }
  }, [])

  const fetchReport = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError('')
    }
    try {
      const res = await api.getReportSummary({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        barangay: barangay !== 'All' ? barangay : undefined,
        reportType,
      })
      if (res.success && res.data) {
        setData(res.data)
        setGenerated(true)
      } else if (!silent) {
        setError(res.message || 'Failed to generate report')
      }
    } catch (err: unknown) {
      console.error('Failed to generate report:', err)
      if (!silent) {
        setError('Failed to generate report. Please try again.')
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [startDate, endDate, barangay, reportType])

  // Auto-fetch on first load
  useEffect(() => {
    fetchReport(false)
  }, [fetchReport])

  // Live data hook: silently poll for report summary updates when page is visible
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchReport(true)
      }
    }

    const intervalId = window.setInterval(refreshIfVisible, 6000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [fetchReport])

  const overview = data?.overview
  const distributions = data?.distributions ?? []
  const monthlyTrends = data?.monthlyTrends ?? []
  const barangayBreakdown = data?.barangayBreakdown ?? []
  const verification = data?.verificationMethods

  // Pagination for Distribution Activity Log
  const totalPages = Math.max(1, Math.ceil(distributions.length / pageSize))
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages)
  const distStartIndex = (safeCurrentPage - 1) * pageSize
  const distEndIndex = Math.min(distributions.length, distStartIndex + pageSize)
  const paginatedDistributions = useMemo(() => {
    return distributions.slice(distStartIndex, distEndIndex)
  }, [distributions, distStartIndex, distEndIndex])

  const applyDatePreset = (preset: 'today' | '7d' | '30d' | 'month' | 'ytd' | 'all') => {
    setActivePreset(preset)
    const { start, end } = getDatePresetRange(preset)
    setStartDate(start)
    setEndDate(end)
    setCurrentPage(1)
    setBrgyCurrentPage(1)
  }

  // Barangay summary aggregation (for barangay report type)
  const barangaySummaryRows = useMemo(() => {
    if (reportType !== 'barangay' || !distributions.length) return []
    const map = new Map<string, {
      barangay: string
      distributions: number
      registered: number
      claimed: number
      unclaimed: number
    }>()
    for (const d of distributions) {
      const existing = map.get(d.barangay) || {
        barangay: d.barangay,
        distributions: 0,
        registered: 0,
        claimed: 0,
        unclaimed: 0,
      }
      existing.distributions++
      existing.registered += d.registeredHouseholds
      existing.claimed += d.claimedHouseholds
      existing.unclaimed += d.unclaimedHouseholds
      map.set(d.barangay, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.distributions - a.distributions)
  }, [reportType, distributions])

  // Pagination for Barangay Summary
  const brgyTotalPages = Math.max(1, Math.ceil(barangaySummaryRows.length / brgyPageSize))
  const brgySafeCurrentPage = Math.min(Math.max(1, brgyCurrentPage), brgyTotalPages)
  const brgyStartIndex = (brgySafeCurrentPage - 1) * brgyPageSize
  const brgyEndIndex = Math.min(barangaySummaryRows.length, brgyStartIndex + brgyPageSize)
  const paginatedBarangayRows = useMemo(() => {
    return barangaySummaryRows.slice(brgyStartIndex, brgyEndIndex)
  }, [barangaySummaryRows, brgyStartIndex, brgyEndIndex])

  const barangayItems: DropdownItem[] = useMemo(() => [
    { value: 'All', label: 'All Barangays' },
    ...scopedBarangays.map((b) => ({ value: b, label: b })),
  ], [scopedBarangays])

  const onToggleMenu = (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (activeMenu === id) {
      setActiveMenu(null)
      setMenuPos(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const menuWidth = 192
    const estimatedHeight = 110
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const opensUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow

    const left = Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12))

    setMenuPos({
      top: opensUp ? undefined : rect.bottom + 6,
      bottom: opensUp ? window.innerHeight - rect.top + 6 : undefined,
      left,
      maxHeight: Math.min(opensUp ? spaceAbove : spaceBelow, 280),
    })
    setActiveMenu(id)
  }

  const handleExportCSV = () => {
    if (!distributions.length) return
    const dateRange = startDate && endDate ? `${startDate}_to_${endDate}` : 'all'
    downloadCSV(distributions, `distribution_report_${dateRange}.csv`)
  }

  const handleExportRowCSV = (row: ReportDistributionRow) => {
    downloadCSV([row], `distribution_${row.barangay}_${row.id}.csv`)
    setActiveMenu(null)
  }

  // Date range label for the table header
  const dateRangeLabel = useMemo(() => {
    if (startDate && endDate) {
      return `${formatDate(startDate)} — ${formatDate(endDate)}`
    }
    if (startDate) return `From ${formatDate(startDate)}`
    if (endDate) return `Until ${formatDate(endDate)}`
    return 'All Time'
  }, [startDate, endDate])

  return (
    <div className="space-y-6">
      {/* ── High-Density Filter Toolbar ──────────────────── */}
      <div className="print:hidden overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
        <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
          <SectionHeader
            eyebrow="Reporting & Analytics"
            title="Distribution report generator"
            subtitle="Configure report types, date ranges, and sector filters to generate municipal distribution summaries"
            rightAccessory={
              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1 dark:bg-slate-900 text-xs font-semibold border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'today', label: 'Today' },
                  { id: '7d', label: '7 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'month', label: 'This Month' },
                  { id: 'ytd', label: 'YTD' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyDatePreset(p.id as any)}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      activePreset === p.id
                        ? 'bg-slate-900 text-white shadow-sm dark:bg-slate-700 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            }
          />
        </div>

        <div className="p-5 sm:p-6">
          {/* Inputs Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
              Report Type
            </label>
            <Dropdown
              value={reportType}
              buttonLabel="Distribution Summary"
              items={REPORT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
              onChange={(v) => setReportType(v as ReportType)}
              widthClass="w-full"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setActivePreset('custom') }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm text-slate-700 shadow-sm transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setActivePreset('custom') }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm text-slate-700 shadow-sm transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
              Sector / Barangay
            </label>
            <Dropdown
              value={barangay}
              buttonLabel="All Barangays"
              items={barangayItems}
              onChange={setBarangay}
              widthClass="w-full"
            />
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => fetchReport(false)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60 text-white text-xs sm:text-sm font-bold shadow-sm transition-all duration-200 hover:shadow-md"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <BoltIcon className="w-4 h-4" />
              )}
              {loading ? 'Compiling...' : 'Generate Report'}
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <DocIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Print
            </button>
            
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!distributions.length}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <DownloadIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              Export CSV
            </button>
          </div>

          {(startDate || endDate || barangay !== 'All' || activePreset !== 'all') && (
            <button
              type="button"
              onClick={() => { setStartDate(''); setEndDate(''); setBarangay('All'); setReportType('distribution'); setActivePreset('all') }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400 px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            >
              <ClearIcon className="h-3.5 w-3.5" />
              Reset Filters
            </button>
          )}
        </div>
      </div>
    </div>

      {/* ── Error Banner ──────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
          <AlertIcon className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold text-red-800 dark:text-red-300">Error generating report</div>
            <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">{error}</div>
          </div>
        </div>
      )}

      {/* ── Stats Deck ────────────────────────────────────── */}
      {generated && overview && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<CubeIcon className="w-5 h-5" />}
            title="Total Distributions"
            value={`${overview.totalDistributions.toLocaleString()}`}
            subtitle="Scheduled cycles"
            variant="blue"
          />
          <StatCard
            icon={<UsersIcon className="w-5 h-5" />}
            title="Households Served"
            value={`${overview.totalClaimedHouseholds.toLocaleString()}`}
            subtitle="Verified recipients"
            variant="emerald"
          />
          <StatCard
            icon={<TrendIcon className="w-5 h-5" />}
            title="Overall Claim Rate"
            value={`${overview.claimRate}%`}
            subtitle="Distribution coverage"
            variant="purple"
          />
          <StatCard
            icon={<UnclaimedIcon className="w-5 h-5" />}
            title="Unclaimed Packages"
            value={`${overview.totalUnclaimedHouseholds.toLocaleString()}`}
            subtitle="Pending follow-up"
            variant="amber"
          />
        </div>
      )}

      {/* ── Loading Spinner ───────────────────────────────── */}
      {loading && <LoadingSpinner />}

      {/* ── Distribution Summary Table ────────────────────── */}
      {generated && !loading && reportType === 'distribution' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
          <div className="border-b border-slate-200/80 bg-slate-50/90 p-4 sm:p-5 dark:border-slate-700/80 dark:bg-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                <DocIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span>Distribution Activity Log</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Filtered period: <strong className="text-slate-700 dark:text-slate-300">{dateRangeLabel}</strong>
              </div>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              {distributions.length} records found
            </span>
          </div>

          {distributions.length === 0 ? (
            <EmptyState message="No distributions found matching the selected filter criteria." />
          ) : (
            <>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse table-fixed min-w-[900px]">
                  <thead className="bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/80 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5 w-[14%]">Scheduled Date</th>
                      <th className="px-4 py-3.5 w-[16%]">Barangay Sector</th>
                      <th className="px-4 py-3.5 w-[12%] text-right">Registered</th>
                      <th className="px-4 py-3.5 w-[12%] text-right">Claimed</th>
                      <th className="px-4 py-3.5 w-[12%] text-right">Unclaimed</th>
                      <th className="px-4 py-3.5 w-[18%]">Turnout Rate</th>
                      <th className="px-4 py-3.5 w-[11%] text-center">Status</th>
                      <th className="px-4 py-3.5 w-[5%]"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm dark:divide-slate-800">
                    {paginatedDistributions.map((r, idx) => (
                      <tr key={r.id} className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/30 dark:bg-slate-800/20' : ''}`}>
                        <td className="px-4 py-3.5 font-medium text-slate-600 dark:text-slate-300">
                          {formatDate(r.scheduled || r.createdAt)}
                        </td>
                        <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-slate-100">
                          {r.barangay}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium text-slate-700 dark:text-slate-300">
                          {r.registeredHouseholds.toLocaleString()}
                        </td>
                        <td className="px-4 py-3.5 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {r.claimedHouseholds.toLocaleString()}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-amber-600 dark:text-amber-400">
                          {r.unclaimedHouseholds.toLocaleString()}
                        </td>
                        <td className="px-4 py-3.5">
                          <ClaimRateBar rate={r.claimRate} />
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right relative">
                          <button
                            onClick={(e) => onToggleMenu(r.id, e)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                          >
                            <DotsIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {activeMenu && menuPos && typeof document !== 'undefined'
                ? createPortal(
                    <div
                      ref={rowMenuWrapRef}
                      style={{
                        position: 'fixed',
                        top: menuPos.top,
                        bottom: menuPos.bottom,
                        left: menuPos.left,
                        maxHeight: menuPos.maxHeight,
                        zIndex: 9999,
                      }}
                      className="w-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                    >
                      {(() => {
                        const targetRow = distributions.find((d) => d.id === activeMenu)
                        if (!targetRow) return null
                        return (
                          <>
                            <MenuItem
                              icon={<EyeIcon />}
                              label="View Details"
                              onClick={() => {
                                setDetailRow(targetRow)
                                setActiveMenu(null)
                                setMenuPos(null)
                              }}
                            />
                            <MenuItem
                              icon={<DownloadIcon className="w-4 h-4" />}
                              label="Export Row CSV"
                              onClick={() => {
                                handleExportRowCSV(targetRow)
                                setMenuPos(null)
                              }}
                            />
                          </>
                        )
                      })()}
                    </div>,
                    document.body,
                  )
                : null}

              {/* Pagination Controls */}
              <Pagination
                currentPage={safeCurrentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={distributions.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={(newSize) => {
                  setPageSize(newSize)
                  setCurrentPage(1)
                }}
                itemLabel="distributions"
              />

              {/* High-density summary strip */}
              <div className="border-t border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <SummaryCell label="Total Batches" value={`${overview?.totalDistributions ?? 0}`} />
                  <SummaryCell label="Mapped Households" value={`${overview?.totalRegisteredHouseholds?.toLocaleString() ?? 0}`} />
                  <SummaryCell label="Claimed Packages" value={`${overview?.totalClaimedHouseholds?.toLocaleString() ?? 0}`} valueClass="text-emerald-600 dark:text-emerald-400" />
                  <SummaryCell label="Unclaimed Packages" value={`${overview?.totalUnclaimedHouseholds?.toLocaleString() ?? 0}`} valueClass="text-amber-600 dark:text-amber-400" />
                  <SummaryCell label="Average Turnout" value={`${overview?.claimRate ?? 0}%`} valueClass="text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Barangay Summary Table ────────────────────────── */}
      {generated && !loading && reportType === 'barangay' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
          <div className="border-b border-slate-200/80 bg-slate-50/90 p-4 sm:p-5 dark:border-slate-700/80 dark:bg-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                <DocIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <span>Sector / Barangay Aggregated Summary</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Performance grouped across barangay jurisdictions
              </div>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              {barangaySummaryRows.length} sectors active
            </span>
          </div>

          {barangaySummaryRows.length === 0 ? (
            <EmptyState message="No data found for the selected filters." />
          ) : (
            <>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse table-fixed min-w-[700px]">
                  <thead className="bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/80 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-3.5 w-[22%]">Barangay Sector</th>
                      <th className="px-4 py-3.5 w-[14%] text-right">Distributions</th>
                      <th className="px-4 py-3.5 w-[16%] text-right">Registered</th>
                      <th className="px-4 py-3.5 w-[16%] text-right">Claimed</th>
                      <th className="px-4 py-3.5 w-[14%] text-right">Unclaimed</th>
                      <th className="px-4 py-3.5 w-[18%]">Turnout Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm dark:divide-slate-800">
                    {paginatedBarangayRows.map((r, idx) => {
                      const rate = r.registered > 0 ? Math.round((r.claimed / r.registered) * 100) : 0
                      return (
                        <tr key={r.barangay} className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/30 dark:bg-slate-800/20' : ''}`}>
                          <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-slate-100">{r.barangay}</td>
                          <td className="px-4 py-3.5 text-right font-medium text-slate-700 dark:text-slate-300">{r.distributions}</td>
                          <td className="px-4 py-3.5 text-right font-medium text-slate-700 dark:text-slate-300">{r.registered.toLocaleString()}</td>
                          <td className="px-4 py-3.5 text-right font-bold text-emerald-600 dark:text-emerald-400">{r.claimed.toLocaleString()}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-amber-600 dark:text-amber-400">{r.unclaimed.toLocaleString()}</td>
                          <td className="px-4 py-3.5"><ClaimRateBar rate={rate} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls for Barangay Table */}
              <Pagination
                currentPage={brgySafeCurrentPage}
                totalPages={brgyTotalPages}
                pageSize={brgyPageSize}
                totalItems={barangaySummaryRows.length}
                onPageChange={setBrgyCurrentPage}
                onPageSizeChange={(newSize) => {
                  setBrgyPageSize(newSize)
                  setBrgyCurrentPage(1)
                }}
                itemLabel="barangay records"
              />
            </>
          )}
        </div>
      )}

      {/* ── Visual Analytics Row ──────────────────────────── */}
      {generated && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Monthly Trend */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)] flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Monthly Volume Comparison</h3>
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Distributions planned vs actual claims fulfilled</p>
            </div>
            {monthlyTrends.length > 0 ? (
              <MiniBarChart
                labels={monthlyTrends.map((t) => t.month.split(' ')[0])}
                seriesA={monthlyTrends.map((t) => t.distributions)}
                seriesB={monthlyTrends.map((t) => t.claimed)}
                legendA="Distributions"
                legendB="Claims"
              />
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">No trend data available</div>
            )}
          </div>

          {/* Barangay Donut */}
          <div className="lg:col-span-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)] flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Sector Allocation Share</h3>
              <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Distribution events share by barangay</p>
            </div>
            {barangayBreakdown.length > 0 ? (
              <Donut
                segments={barangayBreakdown.map((b, i) => ({
                  label: b.barangay,
                  value: b.distributions,
                  stroke: DONUT_COLORS[i % DONUT_COLORS.length],
                }))}
              />
            ) : (
              <div className="py-10 text-center text-xs text-slate-400">No sector data available</div>
            )}
          </div>
        </div>
      )}

      {/* ── Verification Methods Analytics Card ───────────── */}
      {generated && !loading && verification && (verification.qr > 0 || verification.face > 0) && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Verification Method Distribution</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Breakdown of authentication modalities employed for claims</p>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40">
              Multi-factor Enabled
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-3.5 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/40 rounded-xl p-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                <QRIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{verification.qr.toLocaleString()}</div>
                <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">QR Code Scans</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 bg-purple-50/70 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900/40 rounded-xl p-4">
              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                <FaceIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{verification.face.toLocaleString()}</div>
                <div className="text-xs font-semibold text-purple-700 dark:text-purple-300">Biometric Face Recognition</div>
              </div>
            </div>

            {verification.unknown > 0 && (
              <div className="flex items-center gap-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-4">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                  <QuestionIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-extrabold text-slate-900 dark:text-slate-100">{verification.unknown.toLocaleString()}</div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Manual / Override Claims</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Uninitialized / Empty Filter State ───────────── */}
      {!generated && !loading && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <EmptyState message="Select desired filters and click Generate Report to compile analytics." />
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────── */}
      {detailRow && <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  )
}



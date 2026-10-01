'use client'

import React from 'react'
import type { CodeStatus, GeneratedCodeRow, BatchSummary } from './types'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'

type Props = {
  rows: GeneratedCodeRow[]
  search: string
  setSearch: (value: string) => void
  statusFilter: 'ALL' | CodeStatus
  setStatusFilter: (value: 'ALL' | CodeStatus) => void
  onCopyRow: (code: string) => void
  summary: BatchSummary | null
  errorBanner: string
  downloadActions: React.ReactNode
  viewMode?: 'BATCH' | 'REGISTRY'
  onSwitchMode?: (mode: 'BATCH' | 'REGISTRY') => void
  onClearActiveBatch?: () => void
  batchTitle?: string
  hasActiveBatch?: boolean
  selectedBarangay?: string
  onRefresh?: () => void
  isRefreshing?: boolean
}

function StatusBadge({ status }: { status: CodeStatus }) {
  const badgeConfig = {
    USED: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500' },
    EXPIRED: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-300', dot: 'bg-slate-400' },
    LOCKED: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500' },
    UNUSED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  }

  const conf = badgeConfig[status] || badgeConfig['UNUSED']

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${conf.bg} ${conf.text} ${conf.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${conf.dot}`} />
      {status}
    </span>
  )
}

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'UNUSED', label: 'UNUSED' },
  { value: 'USED', label: 'USED' },
  { value: 'LOCKED', label: 'LOCKED' },
  { value: 'EXPIRED', label: 'EXPIRED' },
] as const

export default function GeneratedCodesTable({
  rows,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onCopyRow,
  summary,
  errorBanner,
  downloadActions,
  viewMode = 'BATCH',
  onSwitchMode,
  onClearActiveBatch,
  batchTitle,
  hasActiveBatch,
  selectedBarangay,
  onRefresh,
  isRefreshing = false,
}: Props) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm flex flex-col">
      {/* Integrated Toolbar */}
      <div className="p-5 border-b border-slate-200/80 bg-slate-50/90 dark:border-slate-700/80 dark:bg-slate-800/80 flex flex-col lg:flex-row gap-4 justify-between items-center sm:items-start lg:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 tracking-wide uppercase">
              {viewMode === 'REGISTRY' ? `Barangay Token Registry (${selectedBarangay || 'All'})` : batchTitle || 'Generated Codes Batch'}
            </h3>
            {onSwitchMode && (
              <div className="inline-flex rounded-xl p-0.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                <button
                  type="button"
                  onClick={() => onSwitchMode('BATCH')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                    viewMode === 'BATCH'
                      ? 'bg-slate-900 text-white dark:bg-slate-700 dark:text-white shadow-sm font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Active Batch {hasActiveBatch ? '●' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchMode('REGISTRY')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                    viewMode === 'REGISTRY'
                      ? 'bg-slate-900 text-white dark:bg-slate-700 dark:text-white shadow-sm font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Barangay Registry
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {viewMode === 'REGISTRY'
              ? 'Real-time database records for this barangay. Filter by status to track redemptions and expirations.'
              : 'Plain-text codes available for copy or CSV/PDF download in this session.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-10 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-gray-200 dark:border-slate-700 rounded-xl bg-white/80 dark:bg-slate-800/80 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
              title="Refresh status of codes from server"
              aria-label="Refresh code statuses"
            >
              <svg className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>
          )}
          {viewMode === 'BATCH' && hasActiveBatch && onClearActiveBatch && (
            <button
              type="button"
              onClick={onClearActiveBatch}
              className="h-10 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 border border-gray-200 dark:border-slate-700 rounded-xl bg-white/60 dark:bg-slate-800/60 hover:border-rose-300 dark:hover:border-rose-800 transition-colors"
              title="Clear current batch from view"
            >
              Clear View
            </button>
          )}
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(sanitizeSearchQuery(event.target.value))}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder="Search code"
            aria-label="Search generated codes"
            className="h-10 w-44 rounded-xl border border-gray-300 dark:border-slate-700 px-3 text-sm text-gray-900 dark:text-white bg-white/80 dark:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-800 focus:border-[#004A1C] dark:focus:border-[#ECC323] focus:outline-none focus:ring-2 focus:ring-[#004A1C]/20 dark:focus:ring-[#ECC323]/20 shadow-inner transition-all"
          />
          <SelectDropdown
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'ALL' | CodeStatus)}
            options={STATUS_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            ariaLabel="Filter by status"
            className="min-w-[130px]"
            buttonClassName="h-10"
          />
        </div>
      </div>

      {(summary || errorBanner) && (
        <div className="p-4 bg-white/50 dark:bg-slate-900/50 flex flex-col gap-3">
          {summary ? (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                {viewMode === 'REGISTRY' ? 'Total Tokens:' : 'Batch Count:'} {summary.generatedCount}
              </span>
              {summary.failedCount > 0 && (
                <span className="rounded-full bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">Failed: {summary.failedCount}</span>
              )}
              {typeof summary.resolveTimeMs === 'number' ? (
                <span className="rounded-full bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Generation time: {summary.resolveTimeMs}ms
                </span>
              ) : null}
            </div>
          ) : null}

          {errorBanner ? (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-400">{errorBanner}</div>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto w-full">
        <table className="w-full text-left border-collapse table-fixed min-w-[800px] lg:min-w-0">
          <thead className="bg-white/50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700 text-[11px] font-bold text-gray-400 dark:text-slate-400 uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4 w-[22%]">Code</th>
              <th className="px-6 py-4 w-[20%]">Barangay</th>
              <th className="px-6 py-4 w-[16%]">Status</th>
              <th className="px-6 py-4 w-[25%]">Expiry</th>
              <th className="px-6 py-4 w-[17%] text-right pr-6">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50 text-sm">
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={`${row.code}-${index}`} className="hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors group border-l-[3px] border-l-transparent hover:border-l-[#004A1C] dark:hover:border-l-[#ECC323]">
                  <td className="px-6 py-4 font-mono font-bold text-gray-900 dark:text-gray-100 tracking-wider text-[13px]">{row.code}</td>
                  <td className="px-6 py-4 font-medium text-gray-700 dark:text-gray-300">{row.barangay}</td>
                  <td className="px-6 py-4">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-500 dark:text-slate-400 whitespace-normal">
                    {row.expiry}
                  </td>
                  <td className="px-6 py-4 text-right pr-6">
                    <button
                      type="button"
                      onClick={() => onCopyRow(row.code)}
                      className="rounded-lg border-[1.5px] border-gray-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 px-3 py-1.5 text-xs font-bold text-gray-500 dark:text-gray-300 transition-all hover:bg-gray-50 dark:hover:bg-slate-700 hover:border-gray-300 dark:hover:border-slate-600 hover:text-gray-900 dark:hover:text-white"
                      aria-label={`Copy code ${row.code}`}
                    >
                      Copy
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
                  <div className="mx-auto max-w-md space-y-1">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {viewMode === 'REGISTRY' ? 'No tokens found in registry' : 'No active generated batch'}
                    </p>
                    <p className="text-gray-500 dark:text-gray-400 text-xs">
                      {viewMode === 'REGISTRY'
                        ? 'Try changing the status filter or select a different barangay.'
                        : 'Generate a new batch above to produce downloadable registration codes, or toggle to Barangay Registry.'}
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-gray-50/40 dark:bg-slate-800/40 border-t border-gray-100 dark:border-slate-800 p-4 flex justify-between items-center w-full">
         <p className="text-[11px] font-bold text-gray-400 dark:text-slate-500 tracking-wider uppercase hidden sm:block">Total Actions</p>
         <div className="dark:text-white">
           {downloadActions}
         </div>
      </div>
    </section>
  )
}


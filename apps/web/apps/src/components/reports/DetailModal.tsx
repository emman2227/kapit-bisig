import React, { useEffect } from 'react';
import { type ReportDistributionRow } from '@/lib/api';
import { formatDate, StatusPill, ClaimRateBar } from './ReportsHelpers';

export function DetailModal({
  row,
  onClose,
}: {
  row: ReportDistributionRow
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
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
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Report Audit • {row.barangay}
                </span>
              </div>
              <h3 className="mt-1.5 text-xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                Distribution Details
              </h3>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                Audited distribution run metrics and claim rates for this cycle.
              </p>
            </div>

            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Operation Date</div>
              <div className="text-sm font-bold text-gray-900 dark:text-slate-100 mt-1">{formatDate(row.scheduled || row.createdAt)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Host Barangay</div>
              <div className="text-sm font-bold text-gray-900 dark:text-slate-100 mt-1">{row.barangay}</div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Assigned Barangays</div>
              <div className="text-sm font-bold text-gray-900 dark:text-slate-100 mt-1">
                {row.assignedBarangays?.length ? row.assignedBarangays.join(', ') : 'None'}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Status</div>
              <div className="mt-1"><StatusPill status={row.status} /></div>
            </div>
          </div>

          {/* Household Statistics Banner */}
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Household Relief Statistics
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/70 text-center">
                <div className="text-xl font-black text-gray-900 dark:text-slate-100">{row.registeredHouseholds}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">Registered</div>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200/70 dark:border-emerald-800/70 text-center">
                <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">{row.claimedHouseholds}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">Claimed</div>
              </div>
              <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/70 dark:border-amber-800/70 text-center">
                <div className="text-xl font-black text-amber-600 dark:text-amber-400">{row.unclaimedHouseholds}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">Unclaimed</div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60">
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
                <span>Claim Rate Efficiency</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">{row.claimRate}%</span>
              </div>
              <ClaimRateBar rate={row.claimRate} />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardLayout, Header } from '@/components/layout'
import api, { getScopedBarangays, ResidentRecord } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import FilterDropdown from '@/components/ui/FilterDropdown'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import SectionHeader from '@/components/ui/SectionHeader'
import { isHighMatchResident } from '@/components/residents/ResidentTableBadges'
import ResidentReviewModal from '@/components/residents/ResidentReviewModal'

function getVerifiedTimestamp(record: ResidentRecord): string | undefined {
  return record.verifiedAt || record.createdAt
}

function formatVerifiedTimestamp(value?: string): string {
  if (!value) return 'Verification date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function VerifiedResidentsPage() {
  const PAGE_SIZE = 5
  const { user, loading } = useAuth()
  const router = useRouter()

  const [rows, setRows] = useState<ResidentRecord[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewResidentId, setReviewResidentId] = useState<string | null>(null)
  const [reviewResident, setReviewResident] = useState<ResidentRecord | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const [barangay, setBarangay] = useState('All Barangays')
  const [currentPage, setCurrentPage] = useState(1)

  const barangayOptions = useMemo(
    () => ['All Barangays', ...getScopedBarangays(user?.role, user?.assignedBarangays)],
    [user?.role, user?.assignedBarangays],
  )

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
    } else if (user.role !== 'SUPERADMIN' && user.role !== 'LGU_STAFF') {
      router.replace('/dashboard')
    }
  }, [loading, user, router])

  const fetchResidents = useCallback(async () => {
    setFetching(true)
    setError(null)
    try {
      const response = await api.getResidents({
        status: 'Approved',
        barangay,
        page: 1,
        limit: 100,
      })
      if (!response.success || !Array.isArray(response.data)) {
        throw new Error(response.message || 'Failed to load verified residents.')
      }
      setRows(response.data)
      setCurrentPage(1)
    } catch (e) {
      console.error('Failed to fetch verified residents:', e)
      setError('Failed to load verified residents. Please try again.')
      setRows([])
    } finally {
      setFetching(false)
    }
  }, [barangay])

  useEffect(() => {
    if (!user) return
    fetchResidents()
  }, [user, fetchResidents])

  const closeReview = useCallback(() => {
    setReviewResidentId(null)
    setReviewResident(null)
    setReviewLoading(false)
    setReviewError(null)
  }, [])

  const openReview = useCallback(async (residentId: string) => {
    setReviewResidentId(residentId)
    setReviewResident(null)
    setReviewError(null)
    setReviewLoading(true)

    try {
      const response = await api.getResident(residentId)
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load verified resident details.')
      }
      setReviewResident(response.data)
    } catch (e) {
      console.error('Failed to load verified resident details:', e)
      setReviewError('Failed to load verified resident details. Please try again.')
    } finally {
      setReviewLoading(false)
    }
  }, [])

  const uniqueBarangayCount = useMemo(
    () => new Set(rows.map((r) => (r.barangay || '').trim()).filter(Boolean)).size,
    [rows],
  )
  const withHighMatch = useMemo(
    () => rows.filter((r) => isHighMatchResident(r)).length,
    [rows],
  )
  const verifiedLast7Days = useMemo(() => {
    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    return rows.filter((r) => {
      const timestamp = getVerifiedTimestamp(r)
      if (!timestamp) return false
      const t = new Date(timestamp).getTime()
      return Number.isFinite(t) && now - t <= sevenDaysMs
    }).length
  }, [rows])
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    [rows.length, PAGE_SIZE],
  )
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return rows.slice(start, start + PAGE_SIZE)
  }, [rows, currentPage, PAGE_SIZE])
  const pageNumbers = useMemo(
    () => Array.from({ length: totalPages }, (_, i) => i + 1),
    [totalPages],
  )

  if (loading || !user || (user.role !== 'SUPERADMIN' && user.role !== 'LGU_STAFF')) return null

  return (
    <DashboardLayout>
      <Header
        title="Verified Residents"
        subtitle="Residents approved from the registration review flow"
      />

      <section className="mb-6 overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
        <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
          <SectionHeader
            eyebrow="Verification Overview"
            title="Verified resident summary"
            subtitle="Directory of verified and screened residents eligible for disaster relief distribution"
            rightAccessory={
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                Last 7 days {verifiedLast7Days}
              </div>
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
          <SummaryMetricCard
            label="Verified"
            value={rows.length}
            helper="Verified registrations"
            variant="emerald"
            icon={<CheckCircleIcon className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Barangays"
            value={uniqueBarangayCount}
            helper="Covered barangays"
            variant="blue"
            icon={<MapIcon className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="High AI Match"
            value={withHighMatch}
            helper="Strong confidence records"
            variant="purple"
            icon={<SparklesIcon className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Recent"
            value={verifiedLast7Days}
            helper="Verified in 7 days"
            variant="amber"
            icon={<RefreshIcon className="h-5 w-5" />}
          />
        </div>
      </section>

      <section className="mb-12 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_2px_14px_rgba(0,0,0,0.05)] dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-gray-100 bg-gradient-to-r from-white via-slate-50 to-white px-4 py-3 dark:border-slate-700 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] uppercase text-gray-500 dark:text-slate-400">Verified Directory</p>
              <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">
                {fetching ? 'Loading verified residents...' : `${rows.length} verified resident(s)`}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Use the record button to open the full approved resident information.
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-gray-100 bg-gray-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/70 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:w-[260px]">
              <FilterDropdown
                value={barangay}
                onChange={(v) => setBarangay(v)}
                options={barangayOptions.map((item) => ({ value: item, label: item }))}
              />
            </div>
            <button
              onClick={fetchResidents}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-gray-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <RefreshIcon className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto w-full">
          {error ? (
            <div className="p-10 text-center">
              <p className="text-sm font-semibold text-red-600">{error}</p>
            </div>
          ) : (
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead className="bg-white dark:bg-transparent border-b border-gray-200 dark:border-slate-700 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Barangay</th>
                  <th className="px-6 py-4 text-right pr-6">Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700 bg-white dark:bg-transparent text-sm">
                {fetching ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-16 text-center">
                      <div className="inline-flex flex-col items-center">
                        <SpinnerIcon className="h-8 w-8 text-gray-700 dark:text-slate-300" />
                        <span className="mt-2 text-xs font-medium text-gray-500 dark:text-slate-400">Fetching verified residents...</span>
                      </div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-6 py-16 text-center text-gray-500 dark:text-slate-400 font-medium" colSpan={3}>
                      No verified residents found filtering by {barangay}.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((r) => {
                    const id = r._id || r.id || ''
                    const verifiedTimestamp = getVerifiedTimestamp(r)
                    const residentName = r.fullName?.trim() || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Unnamed Resident'
                    return (
                      <tr key={id} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="px-6 py-4 whitespace-normal break-words">
                          <div className="flex items-center gap-3">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                              <RowCheckIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-bold text-gray-900 dark:text-slate-100">{residentName}</p>
                              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                                Verified {formatVerifiedTimestamp(verifiedTimestamp)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-600 dark:text-slate-300 font-medium">{r.barangay}</td>
                        <td className="px-6 py-4 text-right pr-6">
                          <button
                            type="button"
                            onClick={() => id && openReview(id)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white"
                          >
                            <EyeIcon className="h-4 w-4" />
                            View Record
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > 0 && !fetching && !error && (
          <div className="bg-gray-50/50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-700 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-bold text-gray-500 dark:text-slate-400 tracking-wide uppercase">
              Page {currentPage} of {totalPages} <span className="text-gray-400 dark:text-slate-500 mx-1">|</span> {rows.length} Total
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Prev
              </button>
              {pageNumbers.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors ${
                    page === currentPage
                      ? 'bg-gray-900 text-white border border-gray-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                      : 'border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <ResidentReviewModal
        isOpen={Boolean(reviewResidentId)}
        resident={reviewResident}
        loading={reviewLoading}
        error={reviewError}
        onClose={closeReview}
        readOnly
        approvedLabel="Verified"
        titleEyebrow="Verified Resident"
        description="Review the approved registration details, uploaded proof, and screening notes from the registration process."
      />
    </DashboardLayout>
  )
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" className="opacity-20" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function CheckCircleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function MapIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  )
}

function SparklesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  )
}

function RowCheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.8} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function EyeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M2.458 12C3.732 7.943 7.523 5 12 5s8.268 2.943 9.542 7c-1.274 4.057-5.065 7-9.542 7S3.732 16.057 2.458 12z" />
      <circle cx="12" cy="12" r="3" strokeWidth={2.2} />
    </svg>
  )
}

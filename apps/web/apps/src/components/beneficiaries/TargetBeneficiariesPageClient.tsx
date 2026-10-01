'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  BeneficiaryProofQueueSummary,
  BeneficiaryReviewNotificationDelivery,
  BeneficiaryProofSubmissionRecord,
  getScopedBarangays,
} from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { showToast } from '@/lib/toast'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import SectionHeader from '@/components/ui/SectionHeader'
import FilterDropdown from '@/components/ui/FilterDropdown'
import Pagination from '@/components/ui/Pagination'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'
import BeneficiaryProofReviewModal from './BeneficiaryProofReviewModal'
import {
  Search,
  RotateCcw,
  RefreshCw,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
  MapPin,
  ImageIcon,
  Sparkles,
} from 'lucide-react'

const ALL_STATUSES = '__ALL_STATUSES__'
const ALL_BARANGAYS = 'All Barangays'
const PAGE_SIZE = 10
const PENDING_STATUS = 'Pending Verification'

const INITIAL_PROOF_SUMMARY: BeneficiaryProofQueueSummary = {
  total: 0,
  pendingVerification: 0,
  approved: 0,
  rejected: 0,
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL?.trim() || '/api').replace(/\/api\/?$/, '')

function getProofId(submission: BeneficiaryProofSubmissionRecord): string {
  return String(submission.id || submission._id || '')
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '-'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function resolveProofAssetUrl(value: string): string {
  const raw = String(value || '').trim()
  if (!raw) return '#'
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith('/')) {
    return API_BASE ? `${API_BASE}${raw}` : raw
  }
  return raw
}

function getProofUrls(submission: BeneficiaryProofSubmissionRecord): string[] {
  const list = [
    ...(Array.isArray(submission.photoProofUrls) ? submission.photoProofUrls : []),
    submission.photoProofUrl,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map(resolveProofAssetUrl)

  return Array.from(new Set(list))
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Pending Verification':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50'
    case 'Approved':
    case 'Eligible':
    case 'Active':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50'
    case 'Rejected':
    case 'Not Eligible':
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50'
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800'
  }
}

function getProofStatusLabel(status: BeneficiaryProofSubmissionRecord['status']): string {
  return status === 'Rejected' ? 'Needs Revision' : status
}

function getReviewDeliveryMessage(delivery?: BeneficiaryReviewNotificationDelivery): string {
  const smsDelivered = delivery?.sms.status === 'sent_successfully'
  if (smsDelivered) {
    return ' Resident was notified via SMS and in-app.'
  }
  return ' Resident was notified in-app.'
}

export default function TargetBeneficiariesPageClient() {
  const { user, loading } = useAuth()

  const scopedBarangays = useMemo(
    () => getScopedBarangays(user?.role, user?.assignedBarangays),
    [user?.role, user?.assignedBarangays],
  )

  const [proofRows, setProofRows] = useState<BeneficiaryProofSubmissionRecord[]>([])
  const [proofSummary, setProofSummary] = useState<BeneficiaryProofQueueSummary>(INITIAL_PROOF_SUMMARY)
  const [proofLoading, setProofLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalDocs, setTotalDocs] = useState<number | undefined>(undefined)
  const [selectedStatus, setSelectedStatus] = useState<string>(PENDING_STATUS)
  const [selectedBarangay, setSelectedBarangay] = useState<string>(ALL_BARANGAYS)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Review Modal state
  const [activeReviewRecord, setActiveReviewRecord] = useState<BeneficiaryProofSubmissionRecord | null>(null)

  const fetchProofQueue = useCallback(async () => {
    if (!user) return

    try {
      setProofLoading(true)
      setError(null)
      const response = await api.getBeneficiaryProofSubmissions({
        status:
          selectedStatus !== ALL_STATUSES
            ? (selectedStatus as 'Pending Verification' | 'Approved' | 'Rejected')
            : undefined,
        barangay: selectedBarangay !== ALL_BARANGAYS ? selectedBarangay : undefined,
        search: appliedSearch || undefined,
        page,
        limit: PAGE_SIZE,
      })

      const rawRows = Array.isArray(response.data) ? response.data : []
      setProofRows(rawRows)
      setProofSummary(response.summary || INITIAL_PROOF_SUMMARY)
      setTotalPages(response.pagination?.totalPages || 1)
      setTotalDocs(response.pagination?.totalDocs)
    } catch (err: any) {
      console.error('Failed to load beneficiary proofs:', err)
      setError(err?.message || 'Failed to load proof submissions.')
      setProofRows([])
      setProofSummary(INITIAL_PROOF_SUMMARY)
      setTotalPages(1)
      setTotalDocs(undefined)
    } finally {
      setProofLoading(false)
    }
  }, [appliedSearch, page, selectedBarangay, selectedStatus, user])

  useEffect(() => {
    if (loading || !user) return
    void fetchProofQueue()
  }, [fetchProofQueue, loading, user])

  const handleApplySearch = useCallback(() => {
    setPage(1)
    setAppliedSearch(searchInput.trim())
  }, [searchInput])

  const handleClearFilters = useCallback(() => {
    setSelectedStatus(PENDING_STATUS)
    setSelectedBarangay(ALL_BARANGAYS)
    setSearchInput('')
    setAppliedSearch('')
    setPage(1)
  }, [])

  const handleApprove = useCallback(
    async (submissionId: string) => {
      const response = await api.reviewBeneficiaryProofSubmission(submissionId, {
        decision: 'Approved',
      })
      const baseMessage = response.message || 'Proof submission approved.'
      showToast.success(`${baseMessage}${getReviewDeliveryMessage(response.data?.notificationDelivery)}`)
      await fetchProofQueue()
    },
    [fetchProofQueue],
  )

  const handleReject = useCallback(
    async (submissionId: string, reason: string) => {
      const response = await api.reviewBeneficiaryProofSubmission(submissionId, {
        decision: 'Rejected',
        rejectionReason: reason,
      })
      const baseMessage = response.message || 'Proof submission returned for revision.'
      showToast.info(`${baseMessage}${getReviewDeliveryMessage(response.data?.notificationDelivery)}`)
      await fetchProofQueue()
    },
    [fetchProofQueue],
  )

  return (
    <div className="space-y-6">
      {/* 1. Top Metrics Section */}
      <section className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_2px_14px_rgba(0,0,0,0.05)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <div className="border-b border-slate-200/80 bg-slate-50/90 px-6 py-5 dark:border-slate-800 dark:bg-slate-950/60">
          <SectionHeader
            eyebrow="Target Beneficiary Review"
            title="Event-scoped damage proof verification"
            subtitle="Review resident damage proof uploads, verify calamity eligibility, or return incomplete submissions for revision"
            rightAccessory={
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                Pending Review: {proofSummary.pendingVerification}
              </div>
            }
          />
        </div>

        <div className="p-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetricCard
            label="Total Submissions"
            value={String(proofSummary.total)}
            helper="Across current scope"
            variant="blue"
            icon={<FileText className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Pending Verification"
            value={String(proofSummary.pendingVerification)}
            helper="Awaiting staff decision"
            variant="amber"
            icon={<Clock className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Approved Beneficiaries"
            value={String(proofSummary.approved)}
            helper="Eligible for aid pack"
            variant="emerald"
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Needs Revision"
            value={String(proofSummary.rejected)}
            helper="Returned for missing proof"
            variant="rose"
            icon={<RotateCcw className="h-5 w-5" />}
          />
        </div>
      </section>

      {/* 2. Main Verification Table Container */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_2px_14px_rgba(0,0,0,0.05)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        {/* Controls Toolbar */}
        <div className="border-b border-slate-100 bg-slate-50/50 p-5 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_220px_220px_auto]">
              {/* Search Bar */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchInput}
                    onChange={(event) => setSearchInput(sanitizeSearchQuery(event.target.value))}
                    maxLength={MAX_SEARCH_LENGTH}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleApplySearch()
                      }
                    }}
                    placeholder="Search resident name or code..."
                    className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition-colors focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplySearch}
                  className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  Search
                </button>
              </div>

              {/* Status Filter */}
              <FilterDropdown
                value={selectedStatus}
                options={[
                  { value: PENDING_STATUS, label: 'Pending Verification' },
                  { value: ALL_STATUSES, label: 'All Statuses' },
                  { value: 'Approved', label: 'Approved' },
                  { value: 'Rejected', label: 'Needs Revision' },
                ]}
                onChange={(val) => {
                  setSelectedStatus(val)
                  setPage(1)
                }}
              />

              {/* Barangay Filter */}
              <FilterDropdown
                value={selectedBarangay}
                options={[
                  { value: ALL_BARANGAYS, label: ALL_BARANGAYS },
                  ...scopedBarangays.map((b) => ({ value: b, label: b })),
                ]}
                onChange={(val) => {
                  setSelectedBarangay(val)
                  setPage(1)
                }}
              />

              {/* Refresh / Reset actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchProofQueue()}
                  title="Refresh Queue"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors shadow-sm"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                {(appliedSearch || selectedBarangay !== ALL_BARANGAYS || selectedStatus !== PENDING_STATUS) && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Filter Summary Breadcrumb */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Showing {proofRows.length} of {proofSummary.total} proof submission{proofSummary.total === 1 ? '' : 's'}
              </span>
              {appliedSearch && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Search: &ldquo;{appliedSearch}&rdquo;
                </span>
              )}
              {selectedBarangay !== ALL_BARANGAYS && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Barangay: {selectedBarangay}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {error ? (
            <div className="p-12 text-center">
              <div className="mx-auto max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
                <p className="font-semibold text-sm">{error}</p>
                <button
                  type="button"
                  onClick={() => void fetchProofQueue()}
                  className="mt-3 text-xs font-bold underline"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : proofLoading ? (
            <div className="p-20 text-center">
              <div className="inline-flex flex-col items-center gap-3 text-slate-400">
                <RefreshCw className="h-8 w-8 animate-spin" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Loading proof submissions...</span>
              </div>
            </div>
          ) : proofRows.length === 0 ? (
            <div className="p-20 text-center">
              <div className="mx-auto max-w-sm">
                <CheckCircle2 className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-700" />
                <h4 className="mt-3 text-base font-bold text-slate-800 dark:text-slate-200">No submissions found</h4>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {selectedStatus === PENDING_STATUS
                    ? 'All pending submissions have been reviewed for this scope.'
                    : 'No proof records match your current filter parameters.'}
                </p>
                {(appliedSearch || selectedBarangay !== ALL_BARANGAYS) && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="mt-4 text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    Clear active filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="py-3.5 px-6">Resident Applicant</th>
                  <th className="py-3.5 px-4">Barangay</th>
                  <th className="py-3.5 px-4">Disaster Event</th>
                  <th className="py-3.5 px-4">Damage Type</th>
                  <th className="py-3.5 px-4">Evidence</th>
                  <th className="py-3.5 px-4">Submitted</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {proofRows.map((row) => {
                  const proofId = getProofId(row)
                  const urls = getProofUrls(row)
                  const isPending = row.status === 'Pending Verification'

                  return (
                    <tr
                      key={proofId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer group"
                      onClick={() => setActiveReviewRecord(row)}
                    >
                      {/* 1. Resident Applicant */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {row.resident?.fullName?.charAt(0) || 'R'}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                              {row.resident?.fullName}
                            </p>
                            <span className="text-[11px] font-mono font-medium text-slate-400 dark:text-slate-500 uppercase">
                              {row.resident?.residentCode || '-'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Barangay */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                          <MapPin className="h-3 w-3 text-slate-400" />
                          {row.resident?.barangay || '-'}
                        </span>
                      </td>

                      {/* 3. Event */}
                      <td className="py-4 px-4">
                        <div className="min-w-0 max-w-[180px]">
                          <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                            {row.event?.name}
                          </p>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            {row.event?.disasterType || 'Calamity'}
                          </span>
                        </div>
                      </td>

                      {/* 4. Damage Type */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {row.damageType}
                        </span>
                      </td>

                      {/* 5. Evidence Photo Thumbnail */}
                      <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                        {urls.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setActiveReviewRecord(row)}
                            className="group/photo relative flex h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm dark:border-slate-800"
                            title="Click to view photos"
                          >
                            <img
                              src={urls[0]}
                              alt="Proof preview"
                              className="h-full w-full object-cover transition-transform group-hover/photo:scale-110"
                            />
                            {urls.length > 1 && (
                              <span className="absolute bottom-0 right-0 rounded-tl bg-black/75 px-1 text-[9px] font-bold text-white">
                                +{urls.length - 1}
                              </span>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 italic">None</span>
                        )}
                      </td>

                      {/* 6. Submitted Date */}
                      <td className="py-4 px-4 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                        {formatDateTime(row.dateSubmitted)}
                      </td>

                      {/* 7. Status */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadgeClass(
                            row.status,
                          )}`}
                        >
                          {getProofStatusLabel(row.status)}
                        </span>
                      </td>

                      {/* 8. Action Button */}
                      <td className="py-4 px-6 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setActiveReviewRecord(row)}
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-all shadow-sm ${
                            isPending
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
                          }`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {isPending ? 'Review Proof' : 'View Details'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        {!proofLoading && proofRows.length > 0 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalDocs}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="submissions"
          />
        )}
      </section>

      {/* 3. Dedicated Proof Review Modal */}
      <BeneficiaryProofReviewModal
        isOpen={Boolean(activeReviewRecord)}
        submission={activeReviewRecord}
        onClose={() => setActiveReviewRecord(null)}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  )
}

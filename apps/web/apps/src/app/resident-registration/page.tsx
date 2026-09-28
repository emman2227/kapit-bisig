'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { DashboardLayout, Header } from '@/components/layout'
import api, { getScopedBarangays, ResidentRecord } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { showToast } from '@/lib/toast'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import SectionHeader from '@/components/ui/SectionHeader'
import ConfirmModal from '@/components/ui/ConfirmModal'

import ResidentReviewModal from '@/components/residents/ResidentReviewModal'
import FilterDropdown from '@/components/ui/FilterDropdown'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'

function getResidentId(record: ResidentRecord): string {
  return record._id || record.id || ''
}

function getResidentName(record: ResidentRecord): string {
  const raw =
    record.fullName?.trim() ||
    `${record.firstName || ''} ${record.lastName || ''}`.trim()
  return raw || 'Unknown Resident'
}

function maskMobileNumber(_mobile: string | undefined): string {
  return '09XXXXXXXXX'
}

function formatSubmittedAt(value?: string): { date: string; time: string } {
  if (!value) return { date: 'No date', time: 'No time' }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { date: value, time: 'Pending review' }
  }

  return {
    date: date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }),
  }
}

function getAddressLine(record: ResidentRecord): string {
  const parts = [record.streetAddress, record.city]
    .map((item) => item?.trim())
    .filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : 'Address details unavailable'
}

function getProofPackageCount(record: ResidentRecord): number {
  const imageReferences = [record.frontIdImage, record.backIdImage, record.faceImage]
  if (imageReferences.some((value) => value !== undefined)) {
    return imageReferences.filter(Boolean).length
  }

  return [
    record.proofUploads?.frontId,
    record.proofUploads?.backId,
    record.proofUploads?.face,
  ].filter(Boolean).length
}

function getIdLine(record: ResidentRecord): string {
  const idType = record.idType?.trim() || 'Missing ID type'
  const idNumber = record.idNumber?.trim()
  if (!idNumber) return idType

  return `${idType} ending in ${idNumber.slice(-4)}`
}

function matchesSearch(record: ResidentRecord, query: string): boolean {
  if (!query) return true

  const value = query.toLowerCase()
  const haystack = [
    getResidentName(record),
    record.mobileNumber,
    record.residentCode,
    record.barangay,
    record.streetAddress,
    record.city,
    record.idType,
    record.idNumber,
    record.verification?.detectedIdType,
    ...(record.verification?.reviewFlags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return haystack.includes(value)
}

function RevisionNoteModal({
  isOpen,
  loading,
  title,
  body,
  note,
  onNoteChange,
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  loading: boolean
  title: string
  body: string
  note: string
  onNoteChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}) {
  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={loading ? undefined : onClose} />

      <div className="relative w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 dark:shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Return Registration</p>
        <h3 className="mt-2 text-xl font-black text-gray-900 dark:text-slate-100">{title}</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">{body}</p>

        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={5}
          placeholder="Tell the resident what needs to be corrected or uploaded before approval."
          className="mt-5 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm outline-none transition-colors focus:border-gray-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-slate-500"
        />

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {loading ? <SpinnerIcon className="h-4 w-4" /> : null}
            Return for Revision
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function RegistrationRow({
  record,
  isSelected,
  isBusy,
  onSelect,
  onReview,
  onApprove,
  onReject,
}: {
  record: ResidentRecord
  isSelected: boolean
  isBusy: boolean
  onSelect: (checked: boolean) => void
  onReview: () => void
  onApprove: () => void
  onReject: () => void
}) {
  const id = getResidentId(record)
  const isPending = record.status === 'Pending'
  const submittedAt = formatSubmittedAt(record.createdAt)
  const proofPackageCount = getProofPackageCount(record)
  const confidence = record.verification?.screeningConfidence || 0

  const hasFlags = record.verification?.reviewFlags && record.verification.reviewFlags.length > 0
  const needsManualReview = record.verification?.idCheckRequiresManualReview

  let matchColor = 'text-emerald-600'
  if (confidence < 50) matchColor = 'text-rose-600'
  else if (confidence < 80) matchColor = 'text-amber-600'

  return (
    <article
      className={`group grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto] gap-x-6 gap-y-4 items-center bg-white px-6 py-4 transition-colors border-l-4 dark:bg-slate-900 ${
        isSelected
          ? 'border-l-indigo-500 bg-indigo-50/30 dark:bg-indigo-900/10'
          : 'border-l-transparent hover:bg-slate-50/50 dark:hover:bg-slate-800/50'
      }`}
    >
      {/* 1. Checkbox */}
      <div className="pt-0.5 sm:pt-0 self-start sm:self-center">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={!isPending || isBusy || !id}
          onChange={(event) => onSelect(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
        />
      </div>

      {/* 2. Identity Block */}
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2">
           {isPending && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="Pending" title="Pending Status" />}
           <button
             type="button"
             onClick={onReview}
             className="truncate text-base font-bold text-slate-900 outline-none transition-colors hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
           >
             {getResidentName(record)}
           </button>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
           <span className="font-medium text-slate-700 dark:text-slate-300">{getIdLine(record)}</span>
           <span className="text-slate-300 dark:text-slate-600">•</span>
           <span>{record.barangay}</span>
           <span className="text-slate-300 dark:text-slate-600">•</span>
           <span>Added {submittedAt.date}</span>
        </p>
        <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
           {getAddressLine(record)} • {maskMobileNumber(record.mobileNumber)}
        </p>
      </div>

      {/* 3. Verification Context */}
      <div className="flex flex-col min-w-0">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Match Confidence: <span className={matchColor}>{confidence}%</span>
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {proofPackageCount}/3 assets uploaded
        </p>
        {(hasFlags || needsManualReview) && (
          <p className="mt-1.5 text-[10px] font-bold text-amber-600 uppercase tracking-widest truncate">
            {needsManualReview ? 'Manual review required ' : ''}
            {hasFlags && `${needsManualReview ? '— ' : ''}(${record.verification!.reviewFlags!.join(', ').replace(/_/g, ' ')})`}
          </p>
        )}
      </div>

      {/* 4. Actions Block */}
      <div className="flex items-center gap-2 sm:justify-end mt-2 sm:mt-0">
        <button
          type="button"
          disabled={isBusy || !id}
          onClick={onReview}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Review File →
        </button>
        {isPending && (
          <>
            <button
              type="button"
              disabled={isBusy}
              onClick={onApprove}
              title="Quick Approve"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-emerald-900/50 dark:hover:bg-emerald-900/30"
            >
              {(isBusy && isBusy) ? (
                <SpinnerIcon className="h-4 w-4" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              )}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onReject}
              title="Return for Revision"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
               <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export default function ResidentRegistrationPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  const [rows, setRows] = useState<ResidentRecord[]>([])
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  
  const [reviewResidentId, setReviewResidentId] = useState<string | null>(null)
  const [reviewResident, setReviewResident] = useState<ResidentRecord | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [approveTargetId, setApproveTargetId] = useState<string | null>(null)
  const [revisionTargetId, setRevisionTargetId] = useState<string | null>(null)
  const [revisionNote, setRevisionNote] = useState('')
  
  const [barangay, setBarangay] = useState('All Barangays')
  const [searchQuery, setSearchQuery] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

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
        status: 'Pending',
        barangay,
        page: 1,
        limit: 50,
      })
      if (!response.success || !Array.isArray(response.data)) {
        throw new Error(response.message || 'Failed to load resident registrations.')
      }
      setRows(response.data)
      setSelectedIds([])
    } catch (e) {
      console.error('Failed to fetch resident registrations:', e)
      setError('Failed to load resident registrations. Please try again.')
      setRows([])
    } finally {
      setFetching(false)
    }
  }, [barangay])

  useEffect(() => {
    if (!user) return
    fetchResidents()
  }, [user, fetchResidents])

  const handleApplySearch = useCallback(() => {
    setAppliedSearch(searchQuery.trim())
  }, [searchQuery])

  const handleClearFilters = useCallback(() => {
    setBarangay('All Barangays')
    setSearchQuery('')
    setAppliedSearch('')
  }, [])

  const filteredRows = useMemo(() => {
    const query = appliedSearch.trim()
    return rows.filter((row) => matchesSearch(row, query))
  }, [rows, appliedSearch])

  const pendingRows = useMemo(
    () => filteredRows.filter((row) => row.status === 'Pending'),
    [filteredRows],
  )

  const pendingIds = useMemo(
    () => pendingRows.map((row) => getResidentId(row)).filter(Boolean),
    [pendingRows],
  )

  const allPendingSelected = useMemo(
    () => pendingIds.length > 0 && pendingIds.every((id) => selectedIds.includes(id)),
    [pendingIds, selectedIds],
  )

  const selectedPendingIds = useMemo(
    () => selectedIds.filter((id) => pendingIds.includes(id)),
    [selectedIds, pendingIds],
  )

  const queueMetrics = useMemo(() => {
    const manualReviewCount = filteredRows.filter((row) => {
      const decision = row.verification?.idCheckDecision
      return row.verification?.idCheckRequiresManualReview || decision === 'REVIEW'
    }).length

    const blockedCount = filteredRows.filter(
      (row) => row.verification?.idCheckDecision === 'BLOCK',
    ).length

    const passCount = filteredRows.filter((row) => row.verification?.idCheckDecision === 'PASS')
      .length

    const proofReadyCount = filteredRows.filter((row) => getProofPackageCount(row) >= 2).length

    return {
      total: filteredRows.length,
      manualReviewCount,
      blockedCount,
      passCount,
      proofReadyCount,
    }
  }, [filteredRows])

  const closeReview = useCallback(() => {
    setReviewResidentId(null)
    setReviewResident(null)
    setReviewLoading(false)
    setReviewError(null)
  }, [])

  const resolveActionTargetIds = useCallback((residentId: string) => {
    const isBulk = selectedPendingIds.length > 1 && selectedPendingIds.includes(residentId)
    return isBulk ? selectedPendingIds : [residentId]
  }, [selectedPendingIds])

  const closeApproveConfirm = useCallback(() => {
    setApproveTargetId(null)
  }, [])

  const openApproveConfirm = useCallback((residentId: string) => {
    setApproveTargetId(residentId)
  }, [])

  const closeRevisionModal = useCallback(() => {
    setRevisionTargetId(null)
    setRevisionNote('')
  }, [])

  const openRevisionModal = useCallback((residentId: string) => {
    const sourceRecord = reviewResidentId === residentId ? reviewResident : rows.find((row) => getResidentId(row) === residentId)
    setRevisionTargetId(residentId)
    setRevisionNote(sourceRecord?.rejectionReason || '')
  }, [reviewResident, reviewResidentId, rows])

  const openReview = useCallback(async (residentId: string) => {
    setReviewResidentId(residentId)
    setReviewResident(null)
    setReviewError(null)
    setReviewLoading(true)

    try {
      const response = await api.getResident(residentId)
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load resident review details.')
      }
      setReviewResident(response.data)
    } catch (e) {
      console.error('Failed to load resident review details:', e)
      setReviewError('Failed to load resident review details. Please try again.')
    } finally {
      setReviewLoading(false)
    }
  }, [])

  const confirmApprove = useCallback(
    async () => {
      if (!approveTargetId) return

      const targetIds = resolveActionTargetIds(approveTargetId)
      const isBulk = targetIds.length > 1

      if (isBulk) setBulkBusy(true)
      setBusyId(approveTargetId)
      try {
        const results = await Promise.allSettled(
          targetIds.map((id) => api.updateResidentStatus(id, { status: 'Approved' })),
        )

        const approvedIds: string[] = []
        let failedCount = 0
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') approvedIds.push(targetIds[index])
          else failedCount += 1
        })

        if (approvedIds.length > 0) {
          setRows((prev) => prev.filter((r) => !approvedIds.includes(getResidentId(r))))
          setSelectedIds((prev) => prev.filter((id) => !approvedIds.includes(id)))
          if (reviewResidentId && approvedIds.includes(reviewResidentId)) {
            closeReview()
          }
          closeApproveConfirm()
        }

        if (approvedIds.length > 0 && failedCount === 0) {
          showToast.success(
            isBulk
              ? `Approved ${approvedIds.length} registration(s).`
              : 'Registration approved.',
          )
        } else if (approvedIds.length > 0 && failedCount > 0) {
          showToast.error(`Approved ${approvedIds.length}, but ${failedCount} failed.`)
        } else {
          showToast.error(
            isBulk ? 'Failed to approve selected registrations.' : 'Failed to approve registration.',
          )
        }
      } catch (e) {
        console.error('Failed to approve registration:', e)
        showToast.error(
          isBulk
            ? 'Failed to approve selected registrations.'
            : 'Failed to approve registration.',
        )
      } finally {
        setBusyId(null)
        if (isBulk) setBulkBusy(false)
      }
    },
    [approveTargetId, closeApproveConfirm, closeReview, resolveActionTargetIds, reviewResidentId],
  )

  const submitRevision = useCallback(
    async () => {
      if (!revisionTargetId) return
      if (!revisionNote.trim()) {
        showToast.error('A revision note is required.')
        return
      }

      const targetIds = resolveActionTargetIds(revisionTargetId)
      const isBulk = targetIds.length > 1

      if (isBulk) setBulkBusy(true)
      setBusyId(revisionTargetId)
      try {
        const trimmedReason = revisionNote.trim()
        const results = await Promise.allSettled(
          targetIds.map((id) =>
            api.updateResidentStatus(id, {
              status: 'Needs Revision',
              rejectionReason: trimmedReason,
            }),
          ),
        )

        const revisedIds: string[] = []
        let failedCount = 0
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') revisedIds.push(targetIds[index])
          else failedCount += 1
        })

        if (revisedIds.length > 0) {
          setRows((prev) => prev.filter((r) => !revisedIds.includes(getResidentId(r))))
          setSelectedIds((prev) => prev.filter((id) => !revisedIds.includes(id)))
          if (reviewResidentId && revisedIds.includes(reviewResidentId)) {
            closeReview()
          }
          closeRevisionModal()
        }

        if (revisedIds.length > 0 && failedCount === 0) {
          showToast.success(
            isBulk
              ? `Returned ${revisedIds.length} registration(s) for revision.`
              : 'Registration returned for revision.',
          )
        } else if (revisedIds.length > 0 && failedCount > 0) {
          showToast.error(`Returned ${revisedIds.length}, but ${failedCount} failed.`)
        } else {
          showToast.error(
            isBulk ? 'Failed to return selected registrations.' : 'Failed to return registration.',
          )
        }
      } catch (e) {
        console.error('Failed to return registration for revision:', e)
        showToast.error(
          isBulk
            ? 'Failed to return selected registrations.'
            : 'Failed to return registration.',
        )
      } finally {
        setBusyId(null)
        if (isBulk) setBulkBusy(false)
      }
    },
    [closeReview, closeRevisionModal, resolveActionTargetIds, revisionNote, revisionTargetId, reviewResidentId],
  )

  const onApprove = useCallback((residentId: string) => {
    openApproveConfirm(residentId)
  }, [openApproveConfirm])

  const onReject = useCallback((residentId: string) => {
    openRevisionModal(residentId)
  }, [openRevisionModal])

  const approveTargetIds = useMemo(
    () => (approveTargetId ? resolveActionTargetIds(approveTargetId) : []),
    [approveTargetId, resolveActionTargetIds],
  )

  const revisionTargetIds = useMemo(
    () => (revisionTargetId ? resolveActionTargetIds(revisionTargetId) : []),
    [resolveActionTargetIds, revisionTargetId],
  )

  const toggleSelectRow = useCallback((residentId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.includes(residentId)) return prev
        return [...prev, residentId]
      }
      return prev.filter((id) => id !== residentId)
    })
  }, [])

  const toggleSelectAllPending = useCallback((checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        const merged = new Set([...prev, ...pendingIds])
        return Array.from(merged)
      }
      return prev.filter((id) => !pendingIds.includes(id))
    })
  }, [pendingIds])

  if (loading || !user || (user.role !== 'SUPERADMIN' && user.role !== 'LGU_STAFF')) return null

  return (
    <DashboardLayout>
      <Header
        title="Resident Registration"
        subtitle="Review proof uploads, screening signals, and residency details before approval"
      />
      <div className="space-y-6">
        
        {/* Top Level Control Section & Metrics */}
        <section className="overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_2px_14px_rgba(0,0,0,0.05)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-none">
          <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
            <SectionHeader
              eyebrow="Account Authentication"
              title="Review new registrations"
              subtitle="Screen newly submitted resident applications, proof uploads, and validation flags"
              rightAccessory={
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  Ready for review: {queueMetrics.manualReviewCount}
                </div>
              }
            />
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetricCard 
              label="Visible Queue" 
              value={queueMetrics.total} 
              helper="Total records loaded" 
              variant="blue"
              icon={<UsersIcon className="h-5 w-5" />} 
            />
            <SummaryMetricCard 
              label="Ready for Review" 
              value={queueMetrics.manualReviewCount} 
              helper="Awaiting staff confirmation" 
              variant="amber"
              icon={<ClipboardCheckIcon className="h-5 w-5" />} 
            />
            <SummaryMetricCard 
              label="Proof Ready" 
              value={queueMetrics.proofReadyCount} 
              helper="2+ assets detected" 
              variant="emerald"
              icon={<FileCheckIcon className="h-5 w-5" />} 
            />
            <SummaryMetricCard 
              label="Needs Attention" 
              value={queueMetrics.blockedCount} 
              helper="Review AI red flags" 
              variant="rose"
              icon={<AlertCircleIcon className="h-5 w-5" />} 
            />
          </div>
        </section>

        {/* Central Registration Queue Container */}
        <section className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_2px_14px_rgba(0,0,0,0.05)] dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          
          {/* Header & Controls */}
          <div className="border-b border-gray-100 px-5 py-4 dark:border-slate-800">
             <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px_auto]">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(sanitizeSearchQuery(event.target.value))}
                        maxLength={MAX_SEARCH_LENGTH}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            handleApplySearch()
                          }
                        }}
                        placeholder="Search resident, ID, or flag..."
                        className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-700 outline-none transition-colors focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-slate-500"
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

                  <FilterDropdown
                    value={barangay}
                    options={barangayOptions.map((item) => ({ value: item, label: item }))}
                    onChange={(val) => setBarangay(val)}
                  />

                  <button
                    type="button"
                    onClick={fetchResidents}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshIcon className="h-4 w-4" />
                  </button>
                </div>
             </div>

             <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-900 dark:text-slate-200">
                   {filteredRows.length} registration{filteredRows.length === 1 ? '' : 's'}
                </span>
                
                {(appliedSearch || barangay !== 'All Barangays') && (
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 underline decoration-slate-300 underline-offset-4 transition-colors"
                  >
                    Clear filters
                  </button>
                )}
             </div>
          </div>

          {/* Bulk Action Bar - Shows up contextually */}
          {selectedPendingIds.length > 0 && (
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-indigo-100 bg-indigo-50/95 px-5 py-3 backdrop-blur dark:border-indigo-900/30 dark:bg-indigo-950/90">
              <div className="flex items-center gap-3">
                 <input
                    type="checkbox"
                    checked={allPendingSelected}
                    disabled={pendingIds.length === 0 || bulkBusy}
                    onChange={(event) => toggleSelectAllPending(event.target.checked)}
                    className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-bold text-indigo-900 dark:text-indigo-100">
                      {selectedPendingIds.length} selected
                    </p>
                  </div>
              </div>
              <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => onReject(selectedPendingIds[0])}
                    className="rounded-lg border border-transparent px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200/70 hover:text-slate-900 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  >
                    Return Selected
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => onApprove(selectedPendingIds[0])}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    {bulkBusy && <SpinnerIcon className="h-3.5 w-3.5" />}
                    Approve Selected
                  </button>
              </div>
            </div>
          )}

          {/* List Area */}
          <div className="relative min-h-[400px]">
            {error ? (
              <div className="px-6 py-16 text-center">
                 <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 px-5 py-6">
                    <p className="text-sm font-medium text-rose-700">{error}</p>
                 </div>
              </div>
            ) : fetching ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm z-10 dark:bg-slate-900/60">
                 <div className="flex flex-col items-center gap-3">
                    <SpinnerIcon className="h-8 w-8 text-slate-400" />
                 </div>
              </div>
            ) : filteredRows.length === 0 ? (
               <div className="px-6 py-32 text-center">
                 <div className="mx-auto max-w-sm">
                    <ClipboardCheckIcon className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-700" />
                    <p className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">Queue is empty</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      No matching records found.
                    </p>
                 </div>
               </div>
            ) : (
               <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {filteredRows.map((record) => {
                    const id = getResidentId(record)
                    const isPending = record.status === 'Pending'
                    const isBusy = busyId === id || bulkBusy
                    const isSelected = selectedIds.includes(id)
                    const submittedAt = formatSubmittedAt(record.createdAt)
                    const proofPackageCount = getProofPackageCount(record)
                    const confidence = record.verification?.screeningConfidence || 0
                    
                    return (
                      <RegistrationRow
                        key={id}
                        record={record}
                        isSelected={isSelected}
                        isBusy={isBusy}
                        onSelect={(checked) => toggleSelectRow(id, checked)}
                        onReview={() => id && openReview(id)}
                        onApprove={() => id && onApprove(id)}
                        onReject={() => id && onReject(id)}
                      />
                    )
                  })}
               </div>
            )}
          </div>
        </section>
      </div>

      <ResidentReviewModal
        isOpen={Boolean(reviewResidentId)}
        resident={reviewResident}
        loading={reviewLoading}
        error={reviewError}
        busy={bulkBusy || (reviewResidentId !== null && busyId === reviewResidentId)}
        onClose={closeReview}
        onApprove={onApprove}
        onReject={onReject}
      />

      <ConfirmModal
        isOpen={Boolean(approveTargetId)}
        title="Approve Registration"
        body={
          approveTargetIds.length > 1
            ? `Approve ${approveTargetIds.length} selected registrations?`
            : 'Approve this registration?'
        }
        confirmLabel={
          bulkBusy || (approveTargetId !== null && busyId === approveTargetId)
            ? 'Approving...'
            : 'Approve Registration'
        }
        loading={bulkBusy || (approveTargetId !== null && busyId === approveTargetId)}
        onCancel={closeApproveConfirm}
        onConfirm={confirmApprove}
      />

      <RevisionNoteModal
        isOpen={Boolean(revisionTargetId)}
        loading={bulkBusy || (revisionTargetId !== null && busyId === revisionTargetId)}
        title={
          revisionTargetIds.length > 1
            ? `Return ${revisionTargetIds.length} registrations for revision`
            : 'Return registration for revision'
        }
        body={
          revisionTargetIds.length > 1
            ? 'Add one note that explains what all selected residents need to correct before approval.'
            : 'Add a note that clearly explains what this resident needs to correct or upload before approval.'
        }
        note={revisionNote}
        onNoteChange={setRevisionNote}
        onClose={closeRevisionModal}
        onSubmit={submitRevision}
      />
    </DashboardLayout>
  )
}

/* ── Inline Icons ── */

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={`${className || ''} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4v5h5M20 20v-5h-5M5.8 9A7 7 0 0118 6.3M18.2 15A7 7 0 016 17.7" />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M17 20h5V18a3 3 0 00-5.36-1.84M9 20H4V18a3 3 0 015.36-1.84M16 3.13a4 4 0 010 7.75" />
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 12a4 4 0 100-8 4 4 0 000 8zM16 20a4 4 0 00-8 0" />
      </svg>
  )
}

function ClipboardCheckIcon({ className }: { className?: string }) {
  return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
  )
}

function FileCheckIcon({ className }: { className?: string }) {
  return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
  )
}

function AlertCircleIcon({ className }: { className?: string }) {
  return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
          <path d="M12 8v4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
          <path d="M12 16h.01" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} />
      </svg>
  )
}

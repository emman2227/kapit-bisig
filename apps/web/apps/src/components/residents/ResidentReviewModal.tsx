'use client'

import React from 'react'
import type { ResidentRecord } from '@/lib/api'
import { ResidentStatusBadge } from './ResidentTableBadges'

interface ResidentReviewModalProps {
  isOpen: boolean
  resident: ResidentRecord | null
  loading?: boolean
  error?: string | null
  busy?: boolean
  onClose: () => void
  onApprove?: (residentId: string) => void
  onReject?: (residentId: string) => void
  readOnly?: boolean
  approvedLabel?: string
  titleEyebrow?: string
  description?: string
}

function formatDate(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateOnly(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function resolveAssetUrl(input?: string): string | null {
  const value = String(input || '').trim()
  if (!value) return null
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value
  }
  if (!value.startsWith('/')) {
    return value
  }

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.trim() || '/api'
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
    try {
      const origin = new URL(apiBase).origin
      return `${origin}${value}`
    } catch {
      return value
    }
  }

  return value
}

function getDisplayName(record: ResidentRecord | null): string {
  if (!record) return 'Resident review'
  const fullName =
    record.fullName?.trim() ||
    `${record.firstName || ''} ${record.lastName || ''}`.trim()
  return fullName || 'Unknown Resident'
}

function getAddressCompleteness(record: ResidentRecord): string {
  return record.streetAddress?.trim() && record.city?.trim()
    ? 'Address complete'
    : 'Needs address follow-up'
}

function getProofCount(record: ResidentRecord): number {
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

function ScreeningLog({ resident }: { resident: ResidentRecord }) {
  const warnings = resident.verification?.idCheckWarnings || []
  const reasons = resident.verification?.idCheckReasons || []
  const flags = resident.verification?.reviewFlags || []

  const hasWarnings = warnings.length > 0
  const hasReasons = reasons.length > 0
  const hasFlags = flags.length > 0

  if (!hasWarnings && !hasReasons && !hasFlags) return null

  return (
    <div className="mt-6 space-y-4 border-t border-gray-100 pt-5">
      {hasWarnings && (
        <div>
          <h5 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600">
            Alerts
          </h5>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-800">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      
      {hasReasons && (
        <div>
          <h5 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            System Notes
          </h5>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {hasFlags && (
        <div>
           <h5 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
             Active Flags
           </h5>
           <p className="text-sm font-medium tracking-wide text-slate-800 dark:text-slate-200">
             {flags.map((f) => f.replace(/_/g, ' ')).join(', ')}
           </p>
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-3 text-xl font-black text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">{hint}</p>
    </div>
  )
}

function ChecklistItem({
  label,
  checked,
}: {
  label: string
  checked: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {checked ? (
        <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
          Ready
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/30 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Missing
        </span>
      )}
    </div>
  )
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  const displayValue =
    value === null || value === undefined || value === '' ? '-' : value

  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">{label}</p>
      <div className={`text-sm font-medium text-gray-900 dark:text-slate-200 ${mono ? 'font-mono break-all' : 'break-words'}`}>
        {displayValue}
      </div>
    </div>
  )
}

function ImageCard({
  title,
  src,
}: {
  title: string
  src?: string
}) {
  const resolvedSrc = resolveAssetUrl(src)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div className="border-b border-gray-100 dark:border-slate-700 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">{title}</p>
      </div>
      <div className="bg-slate-50 dark:bg-slate-900/50 p-4">
        {resolvedSrc ? (
          <a href={resolvedSrc} target="_blank" rel="noreferrer" className="block">
            <img
              src={resolvedSrc}
              alt={title}
              className="h-56 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 object-contain"
            />
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Open full size
            </p>
          </a>
        ) : (
          <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-gray-400 dark:text-slate-500">
            No image uploaded
          </div>
        )}
      </div>
    </div>
  )
}

export default function ResidentReviewModal({
  isOpen,
  resident,
  loading = false,
  error = null,
  busy = false,
  onClose,
  onApprove,
  onReject,
  readOnly = false,
  approvedLabel = 'Approved',
  titleEyebrow,
  description,
}: ResidentReviewModalProps) {
  if (!isOpen) return null

  const residentId = resident?._id || resident?.id || ''
  const idCheckDecision = resident?.verification?.idCheckDecision || 'REVIEW'
  const proofCount = resident ? getProofCount(resident) : 0
  const eyebrow = titleEyebrow || (readOnly ? 'Verified Resident' : 'Resident Review')
  const modalDescription =
    description ||
    (readOnly
      ? 'Review the approved registration details, uploaded proof, and screening history.'
      : 'Review uploaded proof before approving or returning this resident registration.')

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="flex min-h-full items-start justify-center px-4 py-8">
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />

        <div className="relative flex max-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
          {/* Top Emerald Accent Bar */}
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
            <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A] shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
          </div>

          <div className="shrink-0 border-b border-gray-100 dark:border-slate-800 bg-gradient-to-r from-white via-slate-50 to-white dark:from-slate-900 dark:via-slate-800/30 dark:to-slate-900 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-400">{eyebrow}</p>
                <h2 className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">{getDisplayName(resident)}</h2>
                {resident ? (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {resident.residentCode || 'Resident code pending'} - {resident.barangay}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                  {modalDescription}
                </p>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                aria-label="Close resident review modal"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50/60 dark:bg-slate-900/50 px-6 py-6">
            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-gray-900 dark:border-slate-100" />
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-900/20 px-5 py-4 text-sm font-semibold text-rose-700 dark:text-rose-400">
                {error}
              </div>
            ) : resident ? (
              <div className="space-y-6">
                <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
                 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                     <div className="flex flex-wrap items-center gap-3">
                       <ResidentStatusBadge status={resident.status} approvedLabel={approvedLabel} />
                       {resident.registrationMethod === 'assisted' ? (
                         <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                           <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                           Assisted (Walk-In)
                         </span>
                       ) : (
                         <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                           <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                           Self-Registration
                         </span>
                       )}
                       
                       <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                          <span>System Confidence: <strong className="text-slate-900 dark:text-slate-100">{resident.verification?.screeningConfidence ?? 0}%</strong></span>
                          
                          {(resident.verification?.idCheckRequiresManualReview || idCheckDecision === 'BLOCK' || idCheckDecision === 'REVIEW') && (
                             <>
                               <span className="text-slate-300 dark:text-slate-600">•</span>
                               <span className="font-semibold text-amber-600 dark:text-amber-500">Manual Review Required</span>
                             </>
                          )}
                       </div>
                     </div>
                  </div>
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                    Automated screening provides a baseline by flagging inconsistencies, but human confirmation is strictly required for final official approval.
                  </p>
                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <SummaryCard
                      label="Submitted"
                      value={formatDate(resident.createdAt)}
                      hint="Time the registration first entered the queue."
                    />
                    <SummaryCard
                      label="Proof Package"
                      value={`${proofCount}/3 assets`}
                      hint="Front ID, back ID, and face capture uploads."
                    />
                    <SummaryCard
                      label="Address Profile"
                      value={getAddressCompleteness(resident)}
                      hint="Use this with the ID and barangay details."
                    />
                    <SummaryCard
                      label="Screening"
                      value={`${resident.verification?.screeningConfidence ?? 0}% confidence`}
                      hint="OCR and document consistency signal."
                    />
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="space-y-6">
                    <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
                      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">Resident Information</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <DetailItem label="Resident Code" value={resident.residentCode || 'Pending generation'} mono />
                        <DetailItem label="Submitted At" value={formatDate(resident.createdAt)} />
                        <DetailItem label="Mobile Number" value={resident.mobileNumber || '-'} mono />
                        <DetailItem label="Barangay" value={resident.barangay} />
                        <DetailItem label="Birth Date" value={formatDateOnly(resident.dateOfBirth)} />
                        <DetailItem label="Gender" value={resident.gender || '-'} />
                        <DetailItem label="City" value={resident.city || 'Labrador'} />
                        <DetailItem
                          label="Registration Mode"
                          value={
                            resident.registrationMethod === 'assisted'
                              ? `Assisted Walk-In${resident.assistedBy ? ` (Staff: ${resident.assistedBy})` : ''}`
                              : 'Self-Registration'
                          }
                        />
                        <DetailItem label="Household Size" value={String(resident.householdSize || 1)} />
                        <DetailItem label="Reviewed By" value={resident.verifiedBy || 'Pending review'} />
                        <DetailItem
                          label="Reviewed At"
                          value={resident.verifiedAt ? formatDate(resident.verifiedAt) : 'Pending review'}
                        />
                        <div className="sm:col-span-2">
                          <DetailItem label="Street Address" value={resident.streetAddress || '-'} />
                        </div>
                        <div className="sm:col-span-2">
                          <DetailItem
                            label="Vulnerable Members"
                            value={
                              resident.vulnerableMembers && resident.vulnerableMembers.length > 0
                                ? resident.vulnerableMembers
                                    .map((member) => {
                                      const count = resident.vulnerableCounts?.[member]
                                      return `${member}${count ? ` (${count})` : ''}`
                                    })
                                    .join(', ')
                                : 'None listed'
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
                      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">ID Screening</h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <DetailItem label="Selected ID Type" value={resident.idType || '-'} />
                        <DetailItem label="Detected ID Type" value={resident.verification?.detectedIdType || 'Not detected'} />
                        <DetailItem label="Entered ID Number" value={resident.idNumber || '-'} mono />
                        <DetailItem label="OCR Extracted ID" value={resident.verification?.extractedIdNumberMasked || 'Not readable'} mono />
                        <DetailItem label="Overall Match" value={`${resident.verification?.overallConfidence ?? 0}%`} />
                        <DetailItem label="Screening Confidence" value={`${resident.verification?.screeningConfidence ?? 0}%`} />
                        <DetailItem label="OCR Confidence" value={`${resident.verification?.ocrConfidence ?? 0}%`} />
                        <DetailItem label="Image Quality" value={`${resident.verification?.qualityScore ?? 0}%`} />
                        <DetailItem
                          label="Type Match"
                          value={
                            resident.verification?.typeMatch === true
                              ? 'Matched'
                              : resident.verification?.typeMatch === false
                                ? 'Mismatch'
                                : 'Not confirmed'
                          }
                        />
                        <DetailItem
                          label="ID Number Match"
                          value={
                            resident.verification?.idNumberMatch === true
                              ? 'Matched'
                              : resident.verification?.idNumberMatch === false
                                ? 'Mismatch'
                                : 'Not confirmed'
                          }
                        />
                      </div>
                      <ScreeningLog resident={resident} />

                      {resident.verification?.rawTextPreview ? (
                        <div className="mt-5 rounded-2xl border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">OCR Text Preview</p>
                          <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{resident.verification.rawTextPreview}</p>
                        </div>
                      ) : null}
                    </div>

                    {resident.rejectionReason ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                          {resident.status === 'Rejected' ? 'Rejection Reason' : 'Revision Note'}
                        </p>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{resident.rejectionReason}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
                      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">Review Checklist</h3>
                      <div className="space-y-3">
                        <ChecklistItem label="Front ID uploaded" checked={Boolean(resident.frontIdImage)} />
                        <ChecklistItem label="Back ID uploaded" checked={Boolean(resident.backIdImage)} />
                        <ChecklistItem label="Face capture uploaded" checked={Boolean(resident.faceImage)} />
                        <ChecklistItem label="Address on file" checked={Boolean(resident.streetAddress && resident.city)} />
                        <ChecklistItem label="Birth date on file" checked={Boolean(resident.dateOfBirth)} />
                        <ChecklistItem label="ID number on file" checked={Boolean(resident.idNumber)} />
                      </div>
                    </div>
                    <ImageCard title="Front ID" src={resident.frontIdImage} />
                    <ImageCard title="Back ID" src={resident.backIdImage} />
                    <ImageCard title="Selfie / Face Capture" src={resident.faceImage} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-8 text-sm font-medium text-gray-500 dark:text-slate-400">
                Select a registration to review.
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-medium text-gray-500 dark:text-slate-400">
                {readOnly
                  ? 'View the uploaded ID, selfie, and screening results for this approved resident record.'
                  : 'Review the uploaded ID, selfie, and screening results before approving or returning this registration.'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 transition-colors hover:bg-gray-50 dark:hover:bg-slate-800"
                >
                  Close
                </button>
                {!readOnly ? (
                  <>
                    <button
                      type="button"
                      disabled={!residentId || busy}
                      onClick={() => residentId && onReject?.(residentId)}
                      className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      Return for Revision
                    </button>
                    <button
                      type="button"
                      disabled={!residentId || busy}
                      onClick={() => residentId && onApprove?.(residentId)}
                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

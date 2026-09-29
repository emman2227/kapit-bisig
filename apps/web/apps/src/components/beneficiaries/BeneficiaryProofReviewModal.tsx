'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { BeneficiaryProofSubmissionRecord } from '@/lib/api'
import {
  X,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Calendar,
  MapPin,
  FileText,
  ShieldAlert,
  Clock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Sun,
} from 'lucide-react'

interface BeneficiaryProofReviewModalProps {
  isOpen: boolean
  submission: BeneficiaryProofSubmissionRecord | null
  loading?: boolean
  onClose: () => void
  onApprove: (submissionId: string) => Promise<void>
  onReject: (submissionId: string, reason: string) => Promise<void>
}

const PRESET_REVISION_REASONS = [
  'Please attach clearer and wider-angle photos of the damaged property or livelihood.',
  'Please upload a valid Barangay Certificate of Calamity Indigency.',
  'Please provide a clearer photo of your ID or proof of barangay residence.',
  'Please attach a certification from the local fisherfolk/farmers association if claiming livelihood loss.',
]

function formatDateTime(value?: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '-'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function resolveAssetUrl(input?: string | null): string | null {
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

function getProofUrls(submission: BeneficiaryProofSubmissionRecord | null): string[] {
  if (!submission) return []
  const list = [
    ...(Array.isArray(submission.photoProofUrls) ? submission.photoProofUrls : []),
    submission.photoProofUrl,
  ]
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return Array.from(new Set(list))
}

export default function BeneficiaryProofReviewModal({
  isOpen,
  submission,
  loading = false,
  onClose,
  onApprove,
  onReject,
}: BeneficiaryProofReviewModalProps) {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0)
  const [isZoomed, setIsZoomed] = useState(false)
  const [isEnhanced, setIsEnhanced] = useState(false)
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [revisionReason, setRevisionReason] = useState('')
  const [submittingAction, setSubmittingAction] = useState(false)

  const photos = getProofUrls(submission)
  const activePhoto = photos[selectedPhotoIndex] || photos[0] || null

  useEffect(() => {
    if (isOpen) {
      setSelectedPhotoIndex(0)
      setIsZoomed(false)
      setShowRevisionForm(false)
      setRevisionReason(submission?.rejectionReason || '')
    }
  }, [isOpen, submission])

  if (!isOpen || !submission || typeof document === 'undefined') return null

  const isPending = submission.status === 'Pending Verification'
  const isApproved = submission.status === 'Approved'
  const isRejected = submission.status === 'Rejected'
  const submissionId = String(submission.id || submission._id || '')

  const handleApprove = async () => {
    setSubmittingAction(true)
    try {
      await onApprove(submissionId)
      onClose()
    } finally {
      setSubmittingAction(false)
    }
  }

  const handleReject = async () => {
    if (!revisionReason.trim()) return
    setSubmittingAction(true)
    try {
      await onReject(submissionId, revisionReason.trim())
      onClose()
    } finally {
      setSubmittingAction(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm transition-opacity"
        onClick={submittingAction ? undefined : onClose}
      />

      {/* Main Dialog Modal */}
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/60 shrink-0">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Target Beneficiary Verification
              </span>
              <span
                className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                  isApproved
                    ? 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950 dark:text-emerald-300'
                    : isRejected
                    ? 'border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950 dark:text-rose-300'
                    : 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950 dark:text-amber-300'
                }`}
              >
                {isRejected ? 'Needs Revision' : submission.status}
              </span>
            </div>
            <h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white truncate">
              {submission.resident?.fullName || 'Resident Proof Review'}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold uppercase tracking-wider">{submission.resident?.residentCode}</span>
              <span className="inline-flex items-center gap-1 font-medium">
                <MapPin className="h-3 w-3 text-slate-400" />
                {submission.resident?.barangay}
              </span>
              <span>•</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">{submission.event?.name}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={submittingAction}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body - 2 Columns */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
          {/* Left: Evidence & Damage Photo Gallery */}
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Uploaded Evidence ({photos.length} photo{photos.length === 1 ? '' : 's'})
              </p>
              <div className="flex items-center gap-2">
                {activePhoto && (
                  <button
                    type="button"
                    onClick={() => setIsEnhanced((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                      isEnhanced
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 ring-1 ring-amber-400/50 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                    title={isEnhanced ? 'Reset normal brightness' : 'Brighten / Enhance dark photo'}
                  >
                    <Sun className={`h-3.5 w-3.5 ${isEnhanced ? 'text-amber-500 fill-amber-500/20' : ''}`} />
                    {isEnhanced ? 'Brightened' : 'Brighten'}
                  </button>
                )}
                {activePhoto && (
                  <button
                    type="button"
                    onClick={() => setIsZoomed(true)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    Full image
                  </button>
                )}
              </div>
            </div>

            {/* Active Photo Container */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-950 flex items-center justify-center">
              {activePhoto ? (
                <img
                  src={resolveAssetUrl(activePhoto) || ''}
                  alt={`Damage proof evidence for ${submission.resident?.fullName}`}
                  className="h-full w-full object-contain cursor-pointer transition-all hover:scale-[1.01]"
                  style={{
                    filter: isEnhanced ? 'brightness(1.45) contrast(1.15)' : 'none',
                  }}
                  onClick={() => setIsZoomed(true)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 p-6 text-center">
                  <FileText className="h-10 w-10 stroke-1 mb-2" />
                  <p className="text-sm font-medium">No photo uploaded</p>
                </div>
              )}

              {/* Photo Navigation controls if multiple */}
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedPhotoIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1))}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPhotoIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-0.5 text-[10px] font-bold text-white tracking-widest uppercase">
                    {selectedPhotoIndex + 1} / {photos.length}
                  </div>
                </>
              )}
            </div>

            {/* Photo Thumbnails */}
            {photos.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {photos.map((url, idx) => (
                  <button
                    key={`thumb-${idx}`}
                    type="button"
                    onClick={() => setSelectedPhotoIndex(idx)}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all ${
                      idx === selectedPhotoIndex
                        ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
                        : 'border-slate-200 dark:border-slate-800 opacity-90 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={resolveAssetUrl(url) || ''}
                      alt={`Thumbnail ${idx + 1}`}
                      className="h-full w-full object-cover transition-all"
                      style={{
                        filter: isEnhanced ? 'brightness(1.25) contrast(1.08)' : 'none',
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Damage Description, Information & Decision Flow */}
          <div className="flex flex-col space-y-5">
            {/* Damage Profile Box */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Damage Classification
                </span>
                <span className="inline-flex rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 shadow-sm">
                  {submission.damageType}
                </span>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Applicant Description</p>
                <p className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                  {submission.description || 'No description provided.'}
                </p>
              </div>

              {submission.supportingInfo && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Supporting Documents / Notes</p>
                  <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">
                    {submission.supportingInfo}
                  </p>
                </div>
              )}
            </div>

            {/* Submission Metadata */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800/70 dark:bg-slate-950">
                <span className="text-slate-400">Submitted</span>
                <p className="mt-0.5 font-bold text-slate-700 dark:text-slate-200">
                  {formatDateTime(submission.dateSubmitted)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800/70 dark:bg-slate-950">
                <span className="text-slate-400">Submission Mode</span>
                <p className="mt-0.5 font-bold text-slate-700 dark:text-slate-200">
                  {submission.syncSource === 'OFFLINE_SYNC' ? 'Offline Field Sync' : 'Direct Online App'}
                </p>
              </div>
            </div>

            {/* Previous Review Note if already returned */}
            {submission.rejectionReason && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-950/30">
                <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-bold text-xs uppercase tracking-wide">
                  <AlertTriangle className="h-4 w-4" />
                  Revision Note Sent to Resident
                </div>
                <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
                  {submission.rejectionReason}
                </p>
                {submission.reviewedBy && (
                  <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                    Reviewed by {submission.reviewedBy} on {formatDateTime(submission.reviewedAt)}
                  </p>
                )}
              </div>
            )}

            {/* Review Decision Block */}
            {isPending && (
              <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800">
                {!showRevisionForm ? (
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Review Action
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setShowRevisionForm(true)}
                        disabled={submittingAction}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Request Revision
                      </button>
                      <button
                        type="button"
                        onClick={handleApprove}
                        disabled={submittingAction}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve Beneficiary
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                        Reason for Revision Note
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowRevisionForm(false)}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>

                    <textarea
                      value={revisionReason}
                      onChange={(e) => setRevisionReason(e.target.value)}
                      placeholder="Explain to the resident what needs to be corrected or re-uploaded..."
                      rows={3}
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />

                    {/* Quick preset helper chips */}
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Quick Presets:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_REVISION_REASONS.map((preset, pIdx) => (
                          <button
                            key={`preset-${pIdx}`}
                            type="button"
                            onClick={() => setRevisionReason(preset)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 transition-colors text-left"
                          >
                            {preset.slice(0, 42)}...
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRevisionForm(false)}
                        className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleReject}
                        disabled={!revisionReason.trim() || submittingAction}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
                      >
                        Send Revision Request
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox Modal for Full Image Zoom */}
      {isZoomed && activePhoto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 p-4">
          <div className="absolute top-5 right-5 flex items-center gap-3 z-10">
            <button
              type="button"
              onClick={() => setIsEnhanced((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                isEnhanced
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30 ring-2 ring-amber-300'
                  : 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm'
              }`}
              title={isEnhanced ? 'Reset normal brightness' : 'Brighten / Enhance dark photo'}
            >
              <Sun className={`h-4 w-4 ${isEnhanced ? 'fill-white' : ''}`} />
              {isEnhanced ? 'Enhanced' : 'Brighten photo'}
            </button>
            <button
              type="button"
              onClick={() => setIsZoomed(false)}
              className="rounded-full bg-white/20 p-2 text-white hover:bg-white/40 transition-colors backdrop-blur-sm"
              title="Close full image"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <img
            src={resolveAssetUrl(activePhoto) || ''}
            alt="Full size damage proof"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl transition-all"
            style={{
              filter: isEnhanced ? 'brightness(1.45) contrast(1.15)' : 'none',
            }}
          />
        </div>
      )}
    </div>,
    document.body
  )
}

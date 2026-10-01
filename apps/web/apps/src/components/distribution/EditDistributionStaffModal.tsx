'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, ScanEligibleUser, StaffUser } from '@/lib/api'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'
import { showToast } from '@/lib/toast'
import type { DistributionRow } from './DistributionsTable'
import { formatScheduledDate } from './DistributionsTable'

interface EditDistributionStaffModalProps {
  open: boolean
  onClose: () => void
  distribution: DistributionRow | null
  onSuccess?: () => void
}

const DEBOUNCE_MS = 250

export default function EditDistributionStaffModal({
  open,
  onClose,
  distribution,
  onSuccess,
}: EditDistributionStaffModalProps) {
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([])
  const [staffQuery, setStaffQuery] = useState('')
  const [debouncedStaffQuery, setDebouncedStaffQuery] = useState('')
  const [eligibleStaff, setEligibleStaff] = useState<ScanEligibleUser[]>([])
  const [allStaffMap, setAllStaffMap] = useState<Map<string, { id: string; fullName: string; assignedBarangays: string[] }>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedStaffQuery(staffQuery.trim())
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [staffQuery])

  // Initialize state when modal opens or distribution changes
  useEffect(() => {
    if (!open || !distribution) {
      setAssignedStaffIds([])
      setStaffQuery('')
      setDebouncedStaffQuery('')
      setEligibleStaff([])
      setErrorMessage(null)
      return
    }

    const initialIds = (distribution.assignedStaffIds || []).map((id) => String(id))
    setAssignedStaffIds(initialIds)
    setStaffQuery('')
    setDebouncedStaffQuery('')
    setErrorMessage(null)

    // Pre-fetch all staff to ensure we have names for existing assignments
    const loadStaffMeta = async () => {
      try {
        const res = await api.getStaffUsers({ status: 'active' })
        if (res.success && res.data) {
          const map = new Map<string, { id: string; fullName: string; assignedBarangays: string[] }>()
          for (const s of res.data) {
            const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim() || s.fullName || 'Staff'
            map.set(s.id, { id: s.id, fullName, assignedBarangays: s.assignedBarangays || [] })
          }
          setAllStaffMap(map)
        }
      } catch (e) {
        console.error('Failed to load staff metadata:', e)
      }
    }

    void loadStaffMeta()
  }, [open, distribution])

  // Load eligible staff for this distribution's scope and date
  useEffect(() => {
    if (!open || !distribution) return

    let cancelled = false
    setIsLoading(true)
    setErrorMessage(null)

    const fetchEligible = async () => {
      try {
        const response = await api.getScanEligibleUsers({
          barangay: distribution.barangay,
          assignedBarangayIds: distribution.assignedBarangays,
          scheduled: distribution.scheduled,
          q: debouncedStaffQuery || undefined,
          limit: 30,
        })

        if (!cancelled && response.success && response.data) {
          setEligibleStaff(response.data.items || [])
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load eligible staff:', err)
          setErrorMessage('Failed to load eligible staff members.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchEligible()

    return () => {
      cancelled = true
    }
  }, [open, distribution, debouncedStaffQuery])

  if (!open || !distribution) return null

  const toggleStaff = (staffId: string) => {
    setErrorMessage(null)
    setAssignedStaffIds((prev) => {
      if (prev.includes(staffId)) {
        if (prev.length <= 1) {
          setErrorMessage('At least 1 staff member must remain assigned to the distribution.')
          return prev
        }
        return prev.filter((id) => id !== staffId)
      } else {
        return [...prev, staffId]
      }
    })
  }

  const handleSave = async () => {
    if (assignedStaffIds.length < 1) {
      setErrorMessage('Please select at least 1 staff member.')
      return
    }

    setIsSaving(true)
    setErrorMessage(null)

    try {
      const response = await api.updateDistributionStaff(distribution.id, assignedStaffIds)
      if (response.success) {
        showToast.success('Assigned staff updated successfully.')
        onSuccess?.()
        onClose()
      } else {
        setErrorMessage(response.message || 'Failed to update assigned staff.')
      }
    } catch (err: unknown) {
      console.error('Failed to save distribution staff:', err)
      const errorObj = err as { message?: string; response?: { message?: string } }
      const msg = errorObj.response?.message || errorObj.message || 'Failed to update assigned staff.'
      setErrorMessage(msg)
      showToast.error(msg)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full px-4 py-6 sm:py-10 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-sm"
          onClick={isSaving ? undefined : onClose}
        />

        {/* Modal Dialog */}
        <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-100 dark:border-slate-800">
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
                    Staff Allocation • {distribution.barangay}
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl sm:text-2xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                  Manage Assigned Staff
                </h3>
                <p className="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-slate-400">
                  Allocate staff & volunteers authorized to scan beneficiary QR codes in {distribution.barangay}.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Content Body */}
          <div className="p-6 space-y-4 overflow-y-auto flex-1">
            {/* Error Banner */}
            {errorMessage && (
              <div className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-700 dark:text-red-300 text-xs flex items-center justify-between">
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  className="text-red-500 hover:text-red-700 ml-2 font-bold"
                >
                  ×
                </button>
              </div>
            )}

            {/* Currently Selected Staff summary */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Currently Assigned ({assignedStaffIds.length})
                </span>
                {assignedStaffIds.length < 1 && (
                  <span className="text-xs text-red-500 font-medium">Select at least 1 staff member</span>
                )}
              </div>

              {assignedStaffIds.length > 0 ? (
                <div className="flex flex-wrap gap-2 p-3 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                  {assignedStaffIds.map((id) => {
                    const staffInfo = allStaffMap.get(id) || eligibleStaff.find((s) => s.id === id)
                    const displayName = staffInfo ? staffInfo.fullName : `Staff (${id.slice(-4)})`

                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-semibold border border-emerald-200/80 dark:border-emerald-800 shadow-2xs"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{displayName}</span>
                        <button
                          type="button"
                          onClick={() => toggleStaff(id)}
                          className="w-4 h-4 flex items-center justify-center rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-800 text-emerald-700 dark:text-emerald-300 transition-colors"
                          title={`Remove ${displayName}`}
                        >
                          ×
                        </button>
                      </span>
                    )
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-2xl border border-dashed border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/30 text-center text-xs text-red-600 dark:text-red-400 font-medium">
                  No staff currently assigned. Please select at least 1 staff member below.
                </div>
              )}
            </div>

            {/* Search Eligible Staff */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                Available Field Staff (Coverage for {distribution.barangay})
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={staffQuery}
                  onChange={(e) => setStaffQuery(sanitizeSearchQuery(e.target.value))}
                  maxLength={MAX_SEARCH_LENGTH}
                  placeholder="Search staff by name or role…"
                  className="w-full pl-9 pr-10 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                />
                <svg
                  className="w-4 h-4 text-slate-400 absolute left-3 top-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {staffQuery && (
                  <button
                    type="button"
                    onClick={() => setStaffQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Eligible Staff List */}
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                  <span>Checking eligible staff members…</span>
                </div>
              ) : eligibleStaff.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                  {staffQuery ? 'No staff matching your search query.' : 'No eligible staff found for this barangay jurisdiction.'}
                </div>
              ) : (
                eligibleStaff.map((staff) => {
                  const isSelected = assignedStaffIds.includes(staff.id)
                  const hasConflict = Boolean(staff.conflict) && !isSelected
                  const disabled = hasConflict || !staff.inScope

                  return (
                    <div
                      key={staff.id}
                      onClick={() => {
                        if (!disabled) toggleStaff(staff.id)
                      }}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 shadow-xs'
                          : disabled
                          ? 'opacity-50 border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/30 cursor-not-allowed'
                          : 'border-slate-200/80 dark:border-slate-800 hover:border-emerald-400/50 hover:bg-emerald-50/10 dark:hover:bg-slate-800 bg-white dark:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-colors ${
                            isSelected
                              ? 'bg-[#0F533A] border-[#0F533A] text-white'
                              : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                            <span>{staff.fullName}</span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/40">
                              {staff.role}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Assigned scope: {staff.scopesSummary?.join(', ') || 'No barangays'}
                          </div>
                        </div>
                      </div>

                      <div>
                        {hasConflict ? (
                          <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-900">
                            Schedule conflict
                          </span>
                        ) : !staff.inScope ? (
                          <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            Out of scope
                          </span>
                        ) : isSelected ? (
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            Assigned ✓
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-400 hover:text-emerald-600">
                            Add +
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-between">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <strong className="text-slate-900 dark:text-slate-100">{assignedStaffIds.length}</strong> staff member{assignedStaffIds.length === 1 ? '' : 's'} assigned
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-2xs"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || assignedStaffIds.length < 1}
                className="rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white px-5 py-2 text-xs font-bold shadow-md shadow-emerald-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isSaving ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>Updating…</span>
                  </>
                ) : (
                  'Save Staff Assignments'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function XIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

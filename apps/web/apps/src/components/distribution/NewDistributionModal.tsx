'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ScanEligibleUser } from '../../lib/api'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '../../lib/inputValidation'
import { useAuth } from '@/lib/AuthContext'

export type CreateDistributionPayload = {
  barangay: string
  assignedBarangays?: string[]
  location?: string
  assignedStaffIds: string[]
  scheduled: string
  endsAt: string
  notes?: string
  disasterEventId?: string
  requiresBeneficiaryApproval?: boolean
}

type StepFieldErrors = {
  barangay?: string
  location?: string
  scheduled?: string
  endsAt?: string
  notes?: string
  assignedStaffIds?: string
  global?: string
}

type ScanEligibleData = {
  items: ScanEligibleUser[]
  nextCursor: number | null
}

const DEBOUNCE_MS = 300
const NOTES_MAX = 2000
const LOCATION_MAX = 60
const LOCATION_REGEX = /^[a-zA-Z0-9\s\-,\.\/:#()ñÑ']*$/
const SCHEDULE_MIN_LEAD_MINUTES = 5
const DISTRIBUTION_START_HOUR = 6
const DISTRIBUTION_END_HOUR = 20

const STEP_DETAILS = {
  1: {
    eyebrow: 'Step 1 of 3',
    title: 'Choose the barangay for distribution',
    description: 'Select the affected barangay where this relief distribution will take place.',
  },
  2: {
    eyebrow: 'Step 2 of 3',
    title: 'Set the distribution schedule',
    description: 'Define when the relief distribution happens and add optional coordination notes for staff and volunteers.',
  },
  3: {
    eyebrow: 'Step 3 of 3',
    title: 'Assign staff and volunteers',
    description: 'Assign staff or volunteers who cover this barangay to manage verification and aid handover.',
  },
} as const

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function getDefaultEndTime(startValue: string): string {
  const start = new Date(startValue)
  if (Number.isNaN(start.getTime())) return ''

  const preferredEnd = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const closingTime = new Date(start)
  closingTime.setHours(DISTRIBUTION_END_HOUR, 0, 0, 0)
  const end = preferredEnd.getTime() > closingTime.getTime() ? closingTime : preferredEnd

  return end.getTime() > start.getTime() ? formatDateTimeLocal(end) : ''
}

export default function NewDistributionModal({
  open,
  onClose,
  onCreate,
  barangayOptions,
}: {
  open: boolean
  onClose: () => void
  onCreate: (payload: CreateDistributionPayload) => void | Promise<void>
  barangayOptions: string[]
}) {
  const { user } = useAuth()
  const isLguStaff = user?.role === 'LGU_STAFF'

  const [step, setStep] = useState(1)
  const [barangay, setBarangay] = useState('')
  const [location, setLocation] = useState('')
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)

  const [scheduled, setScheduled] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [notes, setNotes] = useState('')

  const [errors, setErrors] = useState<StepFieldErrors>({})

  const [requiresBeneficiaryApproval, setRequiresBeneficiaryApproval] = useState<boolean>(false)
  const [preApprovedCount, setPreApprovedCount] = useState<number | null>(null)
  const [isLoadingPreApproved, setIsLoadingPreApproved] = useState(false)

  const [staffQuery, setStaffQuery] = useState('')
  const [debouncedStaffQuery, setDebouncedStaffQuery] = useState('')
  const [staffData, setStaffData] = useState<ScanEligibleData>({ items: [], nextCursor: null })
  const [isLoadingStaff, setIsLoadingStaff] = useState(false)

  const cacheRef = useRef<Map<string, ScanEligibleData>>(new Map())
  const selectedStaffRef = useRef<Map<string, ScanEligibleUser>>(new Map())

  useEffect(() => {
    if (!open) return
    setStep(1)
    setBarangay('')
    setLocation('')
    setAssignedStaffIds([])
    setScheduled('')
    setEndsAt('')
    setNotes('')
    setRequiresBeneficiaryApproval(false)
    setErrors({})
    setStaffQuery('')
    setDebouncedStaffQuery('')
    setStaffData({ items: [], nextCursor: null })
    setIsCreating(false)
    setIsLoadingStaff(false)
    setPreApprovedCount(null)
    setIsLoadingPreApproved(false)
    cacheRef.current = new Map()
    selectedStaffRef.current = new Map()
  }, [open])

  useEffect(() => {
    if (!open || !barangay) {
      setPreApprovedCount(null)
      return
    }
    let isCancelled = false
    setIsLoadingPreApproved(true)
    api.previewBeneficiaries({
      barangay,
    })
      .then((res) => {
        if (!isCancelled && res.success && res.data) {
          setPreApprovedCount(res.data.count)
        }
      })
      .catch(() => {
        if (!isCancelled) setPreApprovedCount(0)
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingPreApproved(false)
      })

    return () => {
      isCancelled = true
    }
  }, [open, barangay])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedStaffQuery(staffQuery.trim())
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [staffQuery])

  const scheduleMinLocal = useMemo(() => {
    const minDate = new Date(Date.now() + SCHEDULE_MIN_LEAD_MINUTES * 60 * 1000)
    return formatDateTimeLocal(minDate)
  }, [open])

  const scheduleMaxLocal = useMemo(() => {
    const now = new Date()
    const maxDate = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)
    maxDate.setHours(23, 59, 0, 0)
    return formatDateTimeLocal(maxDate)
  }, [open])

  const endsAtMaxLocal = useMemo(() => {
    const start = new Date(scheduled)
    if (Number.isNaN(start.getTime())) return scheduleMaxLocal
    start.setHours(DISTRIBUTION_END_HOUR, 0, 0, 0)
    return formatDateTimeLocal(start)
  }, [scheduled, scheduleMaxLocal])

  const validateStep1 = (): StepFieldErrors => {
    const out: StepFieldErrors = {}
    if (!barangay.trim()) {
      out.barangay = 'Please select a barangay for this distribution.'
    }
    const trimmedLoc = location.trim()
    if (trimmedLoc.length > LOCATION_MAX) {
      out.location = `Location must be ${LOCATION_MAX} characters or fewer.`
    } else if (trimmedLoc && !LOCATION_REGEX.test(trimmedLoc)) {
      out.location = 'Location contains invalid characters. Only letters, numbers, spaces, and standard address punctuation (-, ,, ., /, #, \', (, ), ñ, Ñ) are allowed.'
    }
    return out
  }

  const validateStep2 = (): StepFieldErrors => {
    const out: StepFieldErrors = {}
    const date = new Date(scheduled)
    const endDate = new Date(endsAt)
    const now = new Date()
    const minAllowed = Date.now() + SCHEDULE_MIN_LEAD_MINUTES * 60 * 1000
    if (!scheduled.trim()) {
      out.scheduled = 'Scheduled date/time is required.'
    } else if (Number.isNaN(date.getTime())) {
      out.scheduled = 'Scheduled date/time is invalid.'
    } else if (date.getTime() < minAllowed) {
      out.scheduled = `Scheduled date/time must be at least ${SCHEDULE_MIN_LEAD_MINUTES} minutes from now.`
    } else if (date.getTime() > now.getTime() + 31 * 24 * 60 * 60 * 1000) {
      out.scheduled = 'Schedule must be within the next 31 days.'
    } else {
      const hour = date.getHours()
      const isBeforeStart = hour < DISTRIBUTION_START_HOUR
      const isAfterEnd = hour >= DISTRIBUTION_END_HOUR
      if (isBeforeStart || isAfterEnd) {
        out.scheduled = `Schedule must start at or after ${DISTRIBUTION_START_HOUR}:00 and before ${DISTRIBUTION_END_HOUR}:00.`
      }
    }

    if (!endsAt.trim()) {
      out.endsAt = 'Distribution end date/time is required.'
    } else if (Number.isNaN(endDate.getTime())) {
      out.endsAt = 'Distribution end date/time is invalid.'
    } else if (!Number.isNaN(date.getTime())) {
      const isSameDay =
        endDate.getFullYear() === date.getFullYear() &&
        endDate.getMonth() === date.getMonth() &&
        endDate.getDate() === date.getDate()
      const endHour = endDate.getHours()
      const endMinute = endDate.getMinutes()
      const isAfterClosing =
        endHour > DISTRIBUTION_END_HOUR ||
        (endHour === DISTRIBUTION_END_HOUR && endMinute > 0)

      if (endDate.getTime() <= date.getTime()) {
        out.endsAt = 'Distribution end time must be after the start time.'
      } else if (!isSameDay) {
        out.endsAt = 'Distribution must start and end on the same day.'
      } else if (isAfterClosing) {
        out.endsAt = `Distribution must end by ${DISTRIBUTION_END_HOUR}:00.`
      }
    }

    if (notes.length > NOTES_MAX) {
      out.notes = `Notes must be ${NOTES_MAX} characters or fewer.`
    }

    return out
  }

  const validateStep3 = (): StepFieldErrors => {
    const out: StepFieldErrors = {}
    if (assignedStaffIds.length < 1) {
      out.assignedStaffIds = 'Select at least 1 staff member.'
      return out
    }

    const unknownIds = assignedStaffIds.filter((id) => !selectedStaffRef.current.has(id))
    if (unknownIds.length > 0) {
      out.assignedStaffIds = 'Some selected staff are out of scope for this distribution.'
      return out
    }

    const outOfScope = assignedStaffIds.some((id) => {
      const candidate = selectedStaffRef.current.get(id)
      if (!candidate) return true
      return !candidate.scopesSummary.includes(barangay)
    })

    if (outOfScope) {
      out.assignedStaffIds = `Some selected staff do not cover ${barangay}.`
      return out
    }

    if (isLguStaff) {
      const outOfRequesterScope = assignedStaffIds.some((id) => {
        const candidate = selectedStaffRef.current.get(id)
        if (!candidate) return true
        return candidate.scopesSummary.some((scope) => !user?.assignedBarangays?.includes(scope))
      })

      if (outOfRequesterScope) {
        out.assignedStaffIds = 'Some selected staff are outside your barangay scope.'
      }
    }

    return out
  }

  const stepErrors = useMemo(() => {
    if (step === 1) return validateStep1()
    if (step === 2) return validateStep2()
    return validateStep3()
  }, [
    step,
    barangay,
    scheduled,
    endsAt,
    notes,
    assignedStaffIds,
    isLguStaff,
  ])

  const isCurrentStepValid = Object.keys(stepErrors).length === 0

  const cacheKey = (cursor: number) => {
    return [barangay, scheduled, debouncedStaffQuery, cursor].join('|')
  }

  const loadEligibleStaff = async (cursor = 0, append = false) => {
    if (!barangay) return

    const key = cacheKey(cursor)
    const cached = cacheRef.current.get(key)
    if (cached) {
      setStaffData((prev) => ({
        items: append ? [...prev.items, ...cached.items] : cached.items,
        nextCursor: cached.nextCursor,
      }))
      for (const staff of cached.items) {
        selectedStaffRef.current.set(staff.id, staff)
      }
      return
    }

    setIsLoadingStaff(true)
    try {
      const scheduledIso = scheduled ? new Date(scheduled).toISOString() : undefined

      const response = await api.getScanEligibleUsers({
        barangay,
        scheduled: scheduledIso,
        q: debouncedStaffQuery,
        cursor,
        limit: 20,
      })

      const data = response.data ?? { items: [], nextCursor: null }
      cacheRef.current.set(key, data)

      for (const staff of data.items) {
        selectedStaffRef.current.set(staff.id, staff)
      }

      setStaffData((prev) => ({
        items: append ? [...prev.items, ...data.items] : data.items,
        nextCursor: data.nextCursor,
      }))
    } catch (error: unknown) {
      console.error('Failed to fetch eligible staff:', error)
      setErrors((prev) => ({ ...prev, global: 'Failed to fetch eligible staff. Please try again.' }))
      setStaffData({ items: [], nextCursor: null })
    } finally {
      setIsLoadingStaff(false)
    }
  }

  useEffect(() => {
    if (!open || step !== 3) return
    if (!barangay) return
    setStaffData({ items: [], nextCursor: null })
    void loadEligibleStaff(0, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, barangay, scheduled, debouncedStaffQuery])

  const setStepErrors = (nextErrors: StepFieldErrors) => {
    setErrors((prev) => ({ ...prev, ...nextErrors }))
  }

  const goNext = () => {
    const current = step === 1
      ? validateStep1()
      : step === 2
        ? validateStep2()
        : validateStep3()

    setStepErrors(current)

    if (Object.keys(current).length > 0) return
    setErrors({})
    setStep((s) => Math.min(3, s + 1))
  }

  const goBack = () => {
    setErrors({})
    setStep((s) => Math.max(1, s - 1))
  }

  const toggleStaff = (staff: ScanEligibleUser) => {
    const allowedRoles = new Set(['VOLUNTEER', 'LGU_STAFF', 'SUPERADMIN'])
    if (!allowedRoles.has(staff.role)) return
    if (staff.isAvailable === false) return

    selectedStaffRef.current.set(staff.id, staff)

    setAssignedStaffIds((prev) => {
      if (prev.includes(staff.id)) return prev.filter((id) => id !== staff.id)
      return [...prev, staff.id]
    })
  }

  const applyServerValidation = (error: unknown) => {
    const nextErrors: StepFieldErrors = {}
    const err = error as {
      response?: {
        code?: string
        message?: string
        errors?: Array<{ path?: string; message?: string }>
      }
      message?: string
    }

    const code = err.response?.code
    let message = err.response?.message || 'Failed to create distribution. Please try again.'
    if (
      message.includes('CastError') ||
      message.includes('at path') ||
      message.includes('$') ||
      message.includes('Mongoose') ||
      message.includes('ObjectId') ||
      message.includes('Cast to')
    ) {
      message = 'Failed to create distribution. Please check your inputs and try again.'
    }

    if (code === 'STAFF_SCHEDULE_CONFLICT') {
      nextErrors.assignedStaffIds = message
      setStep(3)
    } else if (
      code === 'OUT_OF_SCOPE_STAFF' ||
      code === 'INVALID_ASSIGNED_STAFF' ||
      code === 'STAFF_NOT_FOUND' ||
      code === 'INSUFFICIENT_SCOPE_COVERAGE'
    ) {
      nextErrors.assignedStaffIds = code === 'OUT_OF_SCOPE_STAFF'
        ? 'Some selected staff are not assigned to this distribution barangay.'
        : code === 'STAFF_NOT_FOUND'
          ? 'Some selected staff no longer exist.'
          : code === 'INSUFFICIENT_SCOPE_COVERAGE'
            ? 'Selected staff do not cover this barangay.'
          : 'Some selected staff are invalid for assignment.'
      setStep(3)
    }

    for (const issue of err.response?.errors || []) {
      const path = issue.path || ''
      if (path.includes('barangay')) {
        nextErrors.barangay = issue.message || 'Barangay is required.'
        setStep(1)
      }
      if (path.includes('location')) {
        nextErrors.location = issue.message || 'Location is invalid.'
        setStep(1)
      }
      if (path.includes('scheduled')) {
        nextErrors.scheduled = issue.message || 'Scheduled date/time is invalid.'
        setStep(2)
      }
      if (path.includes('endsAt')) {
        nextErrors.endsAt = issue.message || 'Distribution end date/time is invalid.'
        setStep(2)
      }
      if (path.includes('notes')) {
        nextErrors.notes = issue.message || `Notes must be ${NOTES_MAX} characters or fewer.`
        setStep(2)
      }
      if (path.includes('assignedStaffIds')) {
        nextErrors.assignedStaffIds = issue.message || 'Select at least 1 staff member.'
        setStep(3)
      }
    }

    if (Object.keys(nextErrors).length === 0) {
      nextErrors.global = message
    }

    setErrors(nextErrors)
  }

  const doCreate = async () => {
    const locationErrors = validateStep1()
    const scheduleErrors = validateStep2()
    const staffErrors = validateStep3()
    const allErrors = { ...locationErrors, ...scheduleErrors, ...staffErrors }

    if (Object.keys(allErrors).length > 0 || isCreating) {
      setErrors(allErrors)
      if (Object.keys(locationErrors).length > 0) setStep(1)
      else if (Object.keys(scheduleErrors).length > 0) setStep(2)
      else setStep(3)
      return
    }

    setIsCreating(true)
    setErrors({})

    try {
      await onCreate({
        barangay,
        location: location.trim() ? location.trim() : (barangay ? `${barangay} Covered Court` : undefined),
        assignedStaffIds,
        scheduled: new Date(scheduled).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        notes: notes.trim() ? notes.trim() : undefined,
        requiresBeneficiaryApproval,
      })
    } catch (error: unknown) {
      applyServerValidation(error)
    } finally {
      setIsCreating(false)
    }
  }

  const currentStepDetails = STEP_DETAILS[step as 1 | 2 | 3]

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={isCreating ? undefined : onClose} />

      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl">
        {/* Top Animated Progress Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A] transition-all duration-500 ease-out shadow-[0_0_12px_rgba(16,185,129,0.5)]"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="border-b border-gray-100 dark:border-slate-800 px-6 pt-5 pb-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[#0F533A] dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider border border-emerald-200/60 dark:border-emerald-800/40">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Step {step} of 3 • {Math.round((step / 3) * 100)}% Complete
                </span>
              </div>
              <h3 className="mt-1.5 text-xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                Schedule a Barangay Relief Distribution
              </h3>
              <p className="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-slate-400">
                Setup and dispatch relief aid operations with live verification telemetry.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
              aria-label="Close"
            >
              <XIcon />
            </button>
          </div>

          {/* Dedicated Horizontal Progress Stepper */}
          <div className="mt-6 mb-2 px-2 sm:px-6">
            <div className="relative flex items-center justify-between">
              {/* Connecting Progress Track Line */}
              <div className="absolute left-6 right-6 top-4 -translate-y-1/2 h-1 bg-slate-200 dark:bg-slate-700 rounded-full z-0">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-[#0F533A] rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: step === 1 ? '0%' : step === 2 ? '50%' : '100%',
                  }}
                />
              </div>

              {[
                {
                  stepNum: 1,
                  title: 'Location',
                  subtitle: barangay ? barangay : 'Select Barangay',
                  isDone: !!barangay && step > 1,
                },
                {
                  stepNum: 2,
                  title: 'Schedule',
                  subtitle: scheduled && endsAt ? 'Start & End Set' : 'Set Timing',
                  isDone: !!scheduled && !!endsAt && step > 2,
                },
                {
                  stepNum: 3,
                  title: 'Assign Team',
                  subtitle: assignedStaffIds.length > 0 ? `${assignedStaffIds.length} Selected` : 'Allocate Staff',
                  isDone: assignedStaffIds.length > 0 && isCurrentStepValid,
                },
              ].map(({ stepNum, title, subtitle, isDone }) => {
                const isActive = step === stepNum
                const isPast = step > stepNum || isDone
                const canClick = stepNum < step || (stepNum === 2 && !!barangay) || (stepNum === 3 && !!barangay && !!scheduled && !!endsAt)

                return (
                  <button
                    key={stepNum}
                    type="button"
                    onClick={() => {
                      if (canClick && !isCreating) {
                        setErrors({})
                        setStep(stepNum)
                      }
                    }}
                    disabled={!canClick || isCreating}
                    className={`relative z-10 flex flex-col items-center group transition-all ${
                      canClick && !isActive ? 'cursor-pointer' : ''
                    }`}
                  >
                    {/* Stepper Node Circle */}
                    <div
                      className={`flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                        isPast && !isActive
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                          : isActive
                          ? 'bg-[#0F533A] dark:bg-emerald-600 text-white ring-4 ring-emerald-500/20 dark:ring-emerald-400/30 shadow-md shadow-[#0F533A]/40 scale-105'
                          : 'border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {isPast && !isActive ? <CheckIcon /> : stepNum}
                    </div>

                    {/* Step Labels */}
                    <div className="mt-2 text-center max-w-[90px] sm:max-w-[120px]">
                      <p
                        className={`text-xs font-bold tracking-tight transition-colors leading-tight ${
                          isActive
                            ? 'text-[#0F533A] dark:text-emerald-400 font-extrabold'
                            : isPast
                            ? 'text-slate-900 dark:text-slate-100'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {title}
                      </p>
                      <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-medium">
                        {subtitle}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="space-y-4 overflow-y-auto px-6 py-5 flex-1 min-h-0" style={{ maxHeight: 'calc(92vh - 230px)' }}>
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800/50 px-5 py-3.5 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">{currentStepDetails.eyebrow}</p>
              <h4 className="mt-0.5 text-base font-extrabold text-gray-900 dark:text-slate-100">{currentStepDetails.title}</h4>
              <p className="mt-0.5 text-xs text-gray-600 dark:text-slate-300">{currentStepDetails.description}</p>
            </div>
          </div>

          <div className="min-h-[260px]">
            {/* STEP 1: Barangay Selection */}
            {step === 1 && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-200">Target Barangay</label>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Choose the affected barangay where this relief release will be conducted.</p>
                  </div>
                  <span className="rounded-full border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-2.5 py-1 text-xs font-bold text-gray-600 dark:text-slate-300">
                    {barangay ? '1 selected' : 'Select 1'}
                  </span>
                </div>

                <div className="mt-3 grid max-h-48 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                  {barangayOptions.map((b) => {
                    const selected = b === barangay
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => {
                          setBarangay(b)
                          setAssignedStaffIds([])
                          setErrors({})
                          setLocation((prev) => (!prev || prev.endsWith('Covered Court') ? `${b} Covered Court` : prev))
                        }}
                        className={[
                          'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors',
                          selected
                            ? 'border-[#0F533A] bg-[#0F533A]/5 dark:bg-[#0F533A]/20 text-[#0F533A] dark:text-emerald-400 font-bold'
                            : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700',
                        ].join(' ')}
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current/20">
                          {selected ? <CheckIcon /> : null}
                        </span>
                        <span className="truncate">{b}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  Selected: <strong className="text-gray-900 dark:text-slate-100">{barangay || 'None'}</strong>
                </div>
                {errors.barangay && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.barangay}</p>}

                {/* Specific Distribution Venue / Location */}
                <div className="mt-4">
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                    Distribution Venue / Location
                  </label>
                  <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
                    Specify the distribution site (e.g. Covered Court, Elementary School, or Barangay Hall).
                  </p>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => {
                      const next = e.target.value
                      setLocation(next)
                      if (next && !LOCATION_REGEX.test(next)) {
                        setErrors((prev) => ({
                          ...prev,
                          location: 'Location contains invalid characters. Disallowed symbols like <, >, {, }, $, ;, ", etc. are not allowed.',
                        }))
                      } else {
                        setErrors((prev) => ({ ...prev, location: undefined }))
                      }
                    }}
                    maxLength={LOCATION_MAX}
                    placeholder={barangay ? `e.g., ${barangay} Covered Court` : 'e.g., Poblacion Covered Court'}
                    className={`w-full rounded-xl border bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-200 shadow-sm outline-none transition-colors ${
                      errors.location
                        ? 'border-red-400 focus:border-red-500'
                        : 'border-gray-200 dark:border-slate-700 focus:border-gray-400 dark:focus:border-slate-500'
                    }`}
                  />
                  <div className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">{location.length}/{LOCATION_MAX}</div>
                  {errors.location && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.location}</p>}
                </div>

                {/* Distribution Eligibility Mode */}
                <div className="mt-5 rounded-2xl border border-gray-200 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-800/40 p-4 sm:p-5">
                  <div>
                    <label className="block text-sm font-bold text-gray-900 dark:text-slate-100">
                      Distribution Eligibility Mode
                    </label>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                      Choose who can receive relief assistance in {barangay || 'the selected barangay'}.
                    </p>
                  </div>

                  <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {/* Option 1: General Relief */}
                    <button
                      type="button"
                      onClick={() => setRequiresBeneficiaryApproval(false)}
                      className={[
                        'flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer relative',
                        !requiresBeneficiaryApproval
                          ? 'border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/40 ring-2 ring-emerald-500/20 shadow-sm'
                          : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Open to All
                        </span>
                        <span className={`h-4 w-4 rounded-full border flex items-center justify-center text-[10px] ${!requiresBeneficiaryApproval ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 dark:border-slate-600'}`}>
                          {!requiresBeneficiaryApproval && <CheckIcon />}
                        </span>
                      </div>
                      <div className="mt-2.5 font-bold text-sm text-gray-900 dark:text-slate-100">
                        General Calamity Relief
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-300 leading-relaxed">
                        Every verified resident household in {barangay || 'the barangay'} is eligible. Best for essential food packs, drinking water, and standard supplies.
                      </p>
                      <div className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <span>✓ No damage assessment required</span>
                      </div>
                    </button>

                    {/* Option 2: Targeted Specialized Assistance */}
                    <button
                      type="button"
                      onClick={() => setRequiresBeneficiaryApproval(true)}
                      className={[
                        'flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer relative',
                        requiresBeneficiaryApproval
                          ? 'border-amber-600 bg-amber-50/80 dark:bg-amber-950/40 ring-2 ring-amber-500/20 shadow-sm'
                          : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Proof Required
                        </span>
                        <span className={`h-4 w-4 rounded-full border flex items-center justify-center text-[10px] ${requiresBeneficiaryApproval ? 'border-amber-600 bg-amber-600 text-white' : 'border-gray-300 dark:border-slate-600'}`}>
                          {requiresBeneficiaryApproval && <CheckIcon />}
                        </span>
                      </div>
                      <div className="mt-2.5 font-bold text-sm text-gray-900 dark:text-slate-100 flex items-center justify-between">
                        <span>Targeted Specialized Aid</span>
                        {barangay && preApprovedCount !== null && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200">
                            {isLoadingPreApproved ? '...' : `${preApprovedCount} pre-approved`}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-slate-300 leading-relaxed">
                        Restricted to residents with approved damage proof in Target Beneficiaries. Best for cash aid, shelter repair, and livelihood grants.
                      </p>
                      <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 font-semibold flex flex-col gap-0.5">
                        <span className="flex items-center gap-1">
                          <span>✓ Pre-approved beneficiaries auto-enrolled on creation</span>
                        </span>
                        {barangay && preApprovedCount !== null && preApprovedCount > 0 && (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            • {preApprovedCount} approved {preApprovedCount === 1 ? 'household' : 'households'} in coverage ready for instant claim pass
                          </span>
                        )}
                        {barangay && preApprovedCount === 0 && (
                          <span className="text-slate-500 dark:text-slate-400 font-normal">
                            • 0 households currently pre-approved (residents can submit proof after scheduling)
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: Schedule & Notes */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-200">Scheduled Date/Time</label>
                  <input
                    type="datetime-local"
                    value={scheduled}
                    min={scheduleMinLocal}
                    max={scheduleMaxLocal}
                    onChange={(e) => {
                      const nextStart = e.target.value
                      setScheduled(nextStart)
                      setEndsAt(getDefaultEndTime(nextStart))
                      setErrors({})
                    }}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-200 shadow-sm outline-none transition-colors focus:border-gray-400 dark:focus:border-slate-500"
                  />
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">
                    Allowed: current month only, {DISTRIBUTION_START_HOUR}:00-{DISTRIBUTION_END_HOUR}:00, at least {SCHEDULE_MIN_LEAD_MINUTES} minutes ahead.
                  </p>
                  {errors.scheduled && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.scheduled}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-200">Distribution End Date/Time</label>
                  <input
                    type="datetime-local"
                    value={endsAt}
                    min={scheduled || scheduleMinLocal}
                    max={endsAtMaxLocal}
                    onChange={(e) => {
                      setEndsAt(e.target.value)
                      setErrors({})
                    }}
                    disabled={!scheduled}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-200 shadow-sm outline-none transition-colors focus:border-gray-400 dark:focus:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">
                    Must be after the start time, on the same day, and no later than {DISTRIBUTION_END_HOUR}:00.
                  </p>
                  {errors.endsAt && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.endsAt}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-200">Coordination Notes (Optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value)
                      setErrors({})
                    }}
                    rows={4}
                    placeholder="Add release venue instructions, reminders for volunteers, or packaging notes."
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-gray-700 dark:text-slate-200 shadow-sm outline-none transition-colors focus:border-gray-400 dark:focus:border-slate-500 placeholder-gray-400 dark:placeholder-slate-500"
                  />
                  <div className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">{notes.length}/{NOTES_MAX}</div>
                  {errors.notes && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.notes}</p>}
                </div>
              </div>
            )}

            {/* STEP 3: Assign Staff / Volunteers */}
            {step === 3 && (
              <div className="space-y-4">
                {/* Visual Overview Recap */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-800/40 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Target Location:</span>
                    <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-1.5">
                      📍 {barangay}{location ? ` • ${location}` : ''}
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        (Change)
                      </button>
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Scheduled Timeline:</span>
                    <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-1.5">
                      🕒 {scheduled ? new Date(scheduled).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '--'}
                      {endsAt ? ` – ${new Date(endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        (Change)
                      </button>
                    </p>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-slate-200">
                    Assign Staff / Volunteers for {barangay}
                  </label>
                  <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">
                    Select team members assigned to <strong>{barangay}</strong> who will handle resident verification and QR scanning.
                  </p>
                  <input
                    value={staffQuery}
                    onChange={(e) => setStaffQuery(sanitizeSearchQuery(e.target.value))}
                    maxLength={MAX_SEARCH_LENGTH}
                    placeholder="Search staff by name or email"
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm text-gray-700 dark:text-slate-200 shadow-sm outline-none transition-colors focus:border-gray-400 dark:focus:border-slate-500 placeholder-gray-400 dark:placeholder-slate-500"
                  />
                </div>

                <div className="max-h-64 overflow-y-auto rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm divide-y divide-gray-100 dark:divide-slate-700">
                  {isLoadingStaff ? (
                    <div className="p-4 text-sm text-gray-600 dark:text-slate-400 flex items-center gap-2">
                      <SpinnerIcon />
                      Loading eligible staff for {barangay}...
                    </div>
                  ) : staffData.items.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500 dark:text-slate-400">No staff found assigned to {barangay}.</div>
                  ) : (
                    staffData.items.map((staff) => {
                      const selected = assignedStaffIds.includes(staff.id)
                      const isUnavailable = staff.isAvailable === false
                      return (
                        <label
                          key={staff.id}
                          className={`px-4 py-3 flex items-center justify-between gap-3 transition-colors ${
                            isUnavailable
                              ? 'opacity-60 bg-gray-50/70 dark:bg-slate-800/40 cursor-not-allowed'
                              : selected
                                ? 'bg-[#0F533A]/4 dark:bg-[#0F533A]/20 cursor-pointer'
                                : 'hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={isUnavailable}
                              onChange={() => toggleStaff(staff)}
                              className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-[#0F533A] dark:bg-slate-700 focus:ring-[#0F533A] disabled:cursor-not-allowed"
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">{staff.fullName}</div>
                              {isUnavailable ? (
                                <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400 truncate">
                                  Already assigned to {staff.conflict?.barangay} distribution on this date
                                </div>
                              ) : (
                                <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                                  Scopes: {staff.scopesSummary.join(', ') || 'None'}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {isUnavailable ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[11px] font-medium">
                                Busy ({staff.conflict?.barangay})
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-medium">
                                Available
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-800/50 text-[11px] font-medium">
                              {staff.role}
                            </span>
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>

                {staffData.nextCursor !== null && !isLoadingStaff && (
                  <button
                    type="button"
                    onClick={() => void loadEligibleStaff(staffData.nextCursor || 0, true)}
                    className="text-sm text-[#0F533A] dark:text-emerald-400 font-medium hover:underline"
                  >
                    Load more
                  </button>
                )}

                <div className="text-xs font-medium text-gray-600 dark:text-slate-300">
                  Assigned Team Members: <strong className="text-gray-900 dark:text-slate-100">{assignedStaffIds.length}</strong>
                </div>

                {assignedStaffIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {assignedStaffIds.map((id) => {
                      const staff = selectedStaffRef.current.get(id)
                      return (
                        <button
                          type="button"
                          key={id}
                          onClick={() => setAssignedStaffIds((prev) => prev.filter((x) => x !== id))}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium border border-emerald-200 dark:border-emerald-800"
                        >
                          {staff?.fullName || id}
                          <span className="text-emerald-500 hover:text-emerald-800 font-bold">&times;</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {errors.assignedStaffIds && <p className="text-sm text-red-600 dark:text-red-400">{errors.assignedStaffIds}</p>}
              </div>
            )}

            {errors.global && <p className="text-sm text-red-600 dark:text-red-400">{errors.global}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={step === 1 ? onClose : goBack}
              disabled={isCreating}
              className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-300 transition-colors hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!isCurrentStepValid}
                className={[
                  'rounded-xl px-5 py-2.5 text-sm font-bold transition-colors',
                  isCurrentStepValid
                    ? 'bg-[#0F533A] hover:bg-[#0b412d] text-white cursor-pointer shadow-md'
                    : 'bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed',
                ].join(' ')}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={doCreate}
                disabled={!isCurrentStepValid || isCreating}
                className={[
                  'inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-colors',
                  isCurrentStepValid && !isCreating
                    ? 'bg-[#0F533A] hover:bg-[#0b412d] text-white cursor-pointer shadow-md'
                    : 'bg-gray-200 dark:bg-slate-800 text-gray-400 dark:text-slate-500 cursor-not-allowed',
                ].join(' ')}
              >
                {isCreating ? (
                  <>
                    <SpinnerIcon />
                    Creating distribution...
                  </>
                ) : (
                  'Create Distribution'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  )
}

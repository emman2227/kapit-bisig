'use client'

import React, { useEffect, useRef, useState } from 'react'
import { api, BARANGAY_OPTIONS, CreateStaffData } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { isAsciiText, MAX_TEXT_LENGTH, MAX_EMAIL_LENGTH, sanitizeAsciiText, sanitizeNoWhitespace, validateEmailFormat } from '@/lib/inputValidation'

interface AddUserModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

interface FormErrors {
  firstName?: string
  lastName?: string
  email?: string
  assignedBarangays?: string
  general?: string
}

export default function AddUserModal({ isOpen, onClose, onSuccess }: AddUserModalProps) {
  // Form state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [assignedBarangays, setAssignedBarangays] = useState<string[]>([])

  // UI state
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [barangayDropdownOpen, setBarangayDropdownOpen] = useState(false)
  const barangayButtonRef = useRef<HTMLButtonElement>(null)
  const barangayMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!barangayDropdownOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const inButton = barangayButtonRef.current?.contains(target)
      const inMenu = barangayMenuRef.current?.contains(target)
      if (!inButton && !inMenu) {
        setBarangayDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [barangayDropdownOpen])

  useEffect(() => {
    if (!isOpen) {
      setBarangayDropdownOpen(false)
    }
  }, [isOpen])

  const resetForm = () => {
    setFirstName('')
    setLastName('')
    setEmail('')
    setAssignedBarangays([])
    setBarangayDropdownOpen(false)
    setErrors({})
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    // First name
    if (!firstName.trim()) {
      newErrors.firstName = 'First name is required'
    } else if (firstName.trim().length > MAX_TEXT_LENGTH) {
      newErrors.firstName = `First name must not exceed ${MAX_TEXT_LENGTH} characters`
    } else if (!isAsciiText(firstName.trim())) {
      newErrors.firstName = 'Only standard characters are allowed'
    }

    // Last name
    if (!lastName.trim()) {
      newErrors.lastName = 'Last name is required'
    } else if (lastName.trim().length > MAX_TEXT_LENGTH) {
      newErrors.lastName = `Last name must not exceed ${MAX_TEXT_LENGTH} characters`
    } else if (!isAsciiText(lastName.trim())) {
      newErrors.lastName = 'Only standard characters are allowed'
    }

    // Email
    const emailCheck = validateEmailFormat(email)
    if (!emailCheck.isValid) {
      newErrors.email = emailCheck.error
    }

    // Accessible barangays
    if (assignedBarangays.length < 1) {
      newErrors.assignedBarangays = 'Please select at least 1 accessible barangay'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    setIsLoading(true)
    setErrors({})

    const data: CreateStaffData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      assignedBarangays,
    }

    try {
      const response = await api.createStaffUser(data)

      if (response.success) {
        showToast.success('LGU Staff created successfully. Verification code sent to email.')
        resetForm()
        onSuccess?.()
        onClose()
      } else {
        const errorMsg = response.message || 'Failed to create user'
        setErrors({ general: errorMsg })
        showToast.error(errorMsg)
      }
    } catch (err: any) {
      console.error('Error creating user:', err)

      // Handle backend validation errors
      if (err.response?.errors && Array.isArray(err.response.errors)) {
        const newErrors: FormErrors = {}
        const errorMessages: string[] = []

        for (const e of err.response.errors) {
          if (e.path && e.message) {
            // Map path to form field
            const fieldMap: Record<string, keyof FormErrors> = {
              firstName: 'firstName',
              lastName: 'lastName',
              email: 'email',
              assignedBarangays: 'assignedBarangays',
            }
            const field = fieldMap[e.path]
            if (field) {
              newErrors[field] = e.message
            } else {
              errorMessages.push(e.message)
            }
          }
        }

        if (errorMessages.length > 0) {
          newErrors.general = errorMessages.join(', ')
        }

        if (Object.keys(newErrors).length > 0) {
          setErrors(newErrors)
        }

        const displayMessage = err.response.message || 'Validation failed'
        showToast.error(displayMessage)
      } else if (err.response?.message) {
        setErrors({ general: err.response.message })
        showToast.error(err.response.message)
      } else {
        setErrors({ general: 'Failed to create user. Please try again.' })
        showToast.error('Failed to create user.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full px-4 py-6 sm:py-10 flex items-center justify-center">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/45 backdrop-blur-sm transition-opacity"
          onClick={handleClose}
        />

        {/* Modal Content */}
        <div className="relative bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col border border-gray-100 dark:border-slate-800 max-h-[92vh] overflow-hidden">
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
                    System Access • LGU Staff Provisioning
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                  Add LGU Staff
                </h3>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  Create a new field staff account and assign barangay jurisdictions.
                </p>
              </div>

              <button
                onClick={handleClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                disabled={isLoading}
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1">
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* General Error */}
              {errors.general && (
                <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 rounded-2xl text-red-700 dark:text-red-300 text-xs">
                  {errors.general}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    First Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(sanitizeAsciiText(e.target.value))}
                    maxLength={MAX_TEXT_LENGTH}
                    placeholder="e.g. Juan"
                    className={`w-full px-3.5 py-2.5 rounded-xl border ${
                      errors.firstName ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'
                    } bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors`}
                    disabled={isLoading}
                  />
                  {errors.firstName && (
                    <p className="mt-1 text-xs text-red-500">{errors.firstName}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Last Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(sanitizeAsciiText(e.target.value))}
                    maxLength={MAX_TEXT_LENGTH}
                    placeholder="e.g. Dela Cruz"
                    className={`w-full px-3.5 py-2.5 rounded-xl border ${
                      errors.lastName ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'
                    } bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors`}
                    disabled={isLoading}
                  />
                  {errors.lastName && (
                    <p className="mt-1 text-xs text-red-500">{errors.lastName}</p>
                  )}
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(sanitizeNoWhitespace(e.target.value, MAX_EMAIL_LENGTH))}
                  maxLength={MAX_EMAIL_LENGTH}
                  placeholder="e.g. juan@lgu.gov.ph"
                  className={`w-full px-3.5 py-2.5 rounded-xl border ${
                    errors.email ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'
                  } bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors`}
                  disabled={isLoading}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-500">{errors.email}</p>
                )}
              </div>

              {/* Accessible Barangays */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                  Accessible Barangays <span className="text-red-500">*</span>
                </label>

                <div className="relative">
                  <button
                    ref={barangayButtonRef}
                    type="button"
                    onClick={() => setBarangayDropdownOpen((v) => !v)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border ${
                      errors.assignedBarangays ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'
                    } bg-white dark:bg-slate-800 text-xs ${
                      assignedBarangays.length > 0 ? 'text-slate-800 dark:text-slate-100 font-semibold' : 'text-slate-400'
                    }`}
                    disabled={isLoading}
                  >
                    <span className="truncate">
                      {assignedBarangays.length > 0
                        ? `${assignedBarangays.length} barangay${assignedBarangays.length > 1 ? 's' : ''} selected`
                        : 'Select barangays'}
                    </span>
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${barangayDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {barangayDropdownOpen && (
                    <div
                      ref={barangayMenuRef}
                      className="absolute left-0 top-full mt-2 w-full max-h-56 overflow-y-auto bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-1.5 z-50"
                    >
                      {BARANGAY_OPTIONS.map((barangay) => {
                        const selected = assignedBarangays.includes(barangay)
                        return (
                          <button
                            key={barangay}
                            type="button"
                            onClick={() => {
                              setAssignedBarangays((prev) =>
                                prev.includes(barangay)
                                  ? prev.filter((b) => b !== barangay)
                                  : [...prev, barangay]
                              )
                              setErrors((prev) => ({ ...prev, assignedBarangays: undefined }))
                            }}
                            className={[
                              'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-left transition-colors font-medium',
                              selected ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700',
                            ].join(' ')}
                          >
                            <span className="w-4 flex items-center justify-center">
                              {selected ? (
                                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : null}
                            </span>
                            <span className="truncate">{barangay}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {assignedBarangays.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {assignedBarangays.map((barangay) => (
                      <span key={barangay} className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold border border-emerald-200/80 dark:border-emerald-800">
                        {barangay}
                      </span>
                    ))}
                  </div>
                )}

                {errors.assignedBarangays && (
                  <p className="mt-1 text-xs text-red-500">{errors.assignedBarangays}</p>
                )}
              </div>

              <div className="rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 p-3.5">
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  New staff will receive a first-login OTP, set their own password, and only access the barangays selected above.
                </p>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 shadow-xs"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white px-5 py-2.5 text-sm font-bold shadow-md shadow-emerald-900/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                disabled={isLoading}
              >
                {isLoading && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                <span>{isLoading ? 'Creating…' : 'Create Staff'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

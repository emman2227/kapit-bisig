'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SelectDropdown from '@/components/ui/SelectDropdown'
import SectionHeader from '@/components/ui/SectionHeader'

const EXPIRY_DAYS = 30

type Props = {
  barangay: string
  setBarangay: (value: string) => void
  quantity: string
  setQuantity: (value: string) => void
  expirationLabel: string
  activeUnusedLabel: string
  quantityError: string
  canSubmit: boolean
  isLoading: boolean
  hasGeneratedBatch: boolean
  onOpenConfirm: () => void
  confirmOpen: boolean
  onCloseConfirm: () => void
  onConfirmGenerate: () => void
  barangayOptions: readonly string[]
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

function GenerateConfirmModal({
  open,
  barangay,
  quantity,
  expirationLabel,
  onCancel,
  onConfirm,
  isLoading,
}: {
  open: boolean
  barangay: string
  quantity: string
  expirationLabel: string
  onCancel: () => void
  onConfirm: () => void
  isLoading: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)
  
  // React Best Practices: Store event handlers in refs to avoid redundant effect cleanup/re-binds
  const latestHandles = useRef({ onCancel, onConfirm, isLoading })
  latestHandles.current = { onCancel, onConfirm, isLoading }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return

    const previousActive = document.activeElement as HTMLElement | null
    cancelBtnRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      const { onCancel, isLoading } = latestHandles.current
      if (event.key === 'Escape' && !isLoading) {
        onCancel()
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (!focusable.length) return

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousActive?.focus()
    }
  }, [open])

  if (!open || !mounted || typeof document === 'undefined') return null

  const modal = (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" aria-hidden={!open}>
      <div
        className="fixed inset-0 bg-slate-950/60 dark:bg-black/75 backdrop-blur-sm transition-opacity"
        onClick={isLoading ? undefined : onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-confirm-title"
        aria-describedby="generate-confirm-desc"
        className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 p-8 shadow-2xl border border-gray-200/80 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150"
      >
        <h2 id="generate-confirm-title" className="text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
          Confirm Code Generation
        </h2>
        <div id="generate-confirm-desc" className="mt-5 space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
            <span className="font-semibold text-gray-800 dark:text-gray-300">Barangay:</span> 
            <span className="text-gray-900 dark:text-gray-100">{barangay || 'Not selected'}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100 dark:border-slate-800">
            <span className="font-semibold text-gray-800 dark:text-gray-300">Quantity:</span> 
            <span className="text-gray-900 dark:text-gray-100 font-bold">{quantity || '0'}</span>
          </div>
          <p className="pt-2 leading-relaxed">
            <span className="font-semibold text-gray-800 dark:text-gray-300 block mb-1">Expiration Guidelines:</span> 
            Codes expire in <strong>{EXPIRY_DAYS} days</strong> and can only be used once. 
            They will be invalid after <span className="font-medium text-[#004A1C] dark:text-[#ECC323]">{expirationLabel}</span>.
          </p>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-xl border border-gray-300 dark:border-slate-700 px-5 py-2.5 text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#004A1C] dark:bg-[#ECC323] px-6 py-2.5 text-sm font-bold text-white dark:text-[#004A1C] hover:bg-[#003815] dark:hover:bg-yellow-400 transition-colors shadow-md shadow-[#004A1C]/20 dark:shadow-[#ECC323]/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? <Spinner /> : null}
            {isLoading ? 'Generating...' : 'Confirm Generate'}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default function CodeGenerationForm({
  barangay,
  setBarangay,
  quantity,
  setQuantity,
  expirationLabel,
  activeUnusedLabel,
  quantityError,
  canSubmit,
  isLoading,
  hasGeneratedBatch,
  onOpenConfirm,
  confirmOpen,
  onCloseConfirm,
  onConfirmGenerate,
  barangayOptions,
}: Props) {
  const expirationLine = useMemo(
    () => `Expires in ${EXPIRY_DAYS} days • Expiration date: ${expirationLabel}`,
    [expirationLabel]
  )
  const barangayDropdownOptions = useMemo(
    () => barangayOptions.map((option) => ({ value: option, label: option })),
    [barangayOptions]
  )

  return (
    <section className="relative z-20 rounded-[2rem] border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm mb-8">
      {/* Top Header Bar */}
      <div className="rounded-t-[calc(2rem-1px)] border-b border-slate-200/80 bg-slate-50/90 px-6 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-8">
        <SectionHeader
          eyebrow="Security & Token Dispatch"
          title="Municipal code generator"
          subtitle="Generate single-use verification tokens for barangay resident distribution claims"
          rightAccessory={
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              30-day token lifetime
            </div>
          }
        />
      </div>

      <div className="relative z-10 p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-end gap-6">
          <div className="flex-1 w-full">
            <label htmlFor="code-generation-barangay" className="mb-2 block text-[11px] font-bold tracking-widest text-gray-500 dark:text-gray-400 uppercase">
              Barangay
            </label>
            <SelectDropdown
              id="code-generation-barangay"
              value={barangay}
              onChange={setBarangay}
              options={barangayDropdownOptions}
              placeholder="Select barangay"
              ariaLabel="Select barangay"
            />
            <p className="mt-2.5 text-[11px] font-bold tracking-wider uppercase text-gray-400 dark:text-slate-500 h-4 truncate" title={activeUnusedLabel}>
              {activeUnusedLabel}
            </p>
          </div>

          <div className="w-full lg:w-48 xl:w-[220px]">
            <label htmlFor="code-generation-quantity" className="mb-2 block text-[11px] font-bold tracking-widest text-gray-500 dark:text-gray-400 uppercase">
              Quantity
            </label>
            <input
              id="code-generation-quantity"
              type="number"
              min={1}
              max={100}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-11 w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 px-4 text-sm font-bold text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-slate-800 focus:border-[#004A1C] dark:focus:border-[#ECC323] focus:outline-none focus:ring-2 focus:ring-[#004A1C]/20 dark:focus:ring-[#ECC323]/20 shadow-inner transition-all"
              aria-invalid={Boolean(quantityError)}
              aria-describedby="code-generation-quantity-error"
            />
            {quantityError ? (
              <p id="code-generation-quantity-error" className="mt-2.5 text-[11px] font-bold tracking-wider uppercase text-red-600 dark:text-red-400 h-4" role="alert">
                {quantityError}
              </p>
            ) : (
              <p className="mt-2.5 text-[11px] font-bold tracking-wider uppercase text-gray-400 dark:text-slate-500 h-4">Min 1, Max 100</p>
            )}
          </div>

          <div className="w-full lg:w-48 xl:w-56 pb-[26px]">
            <button
              type="button"
              onClick={onOpenConfirm}
              disabled={!canSubmit || isLoading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 dark:bg-white px-4 text-sm font-bold tracking-wide text-white dark:text-gray-900 transition-all hover:bg-gray-800 dark:hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_4px_14px_rgba(0,0,0,0.1)] hover:-translate-y-0.5"
              aria-label="Generate codes"
            >
              {isLoading ? <Spinner /> : null}
              {isLoading ? 'Working...' : 'Generate Codes'}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-5 border-t border-gray-200/50 dark:border-slate-700/50">
          <p className="text-[12px] font-bold text-gray-500 dark:text-slate-400 tracking-wide">{expirationLine}</p>
          {hasGeneratedBatch ? (
            <div className="rounded-lg border border-amber-200/80 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:shadow-none">
              New codes append to existing
            </div>
          ) : null}
        </div>
      </div>

      <GenerateConfirmModal
        open={confirmOpen}
        barangay={barangay}
        quantity={quantity}
        expirationLabel={expirationLabel}
        onCancel={onCloseConfirm}
        onConfirm={onConfirmGenerate}
        isLoading={isLoading}
      />
    </section>
  )
}


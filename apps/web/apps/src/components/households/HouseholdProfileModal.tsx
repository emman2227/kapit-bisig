'use client'

import React, { useState } from 'react'
import type { HouseholdRow } from '@/app/households/page'

interface HouseholdProfileModalProps {
  isOpen: boolean
  onClose: () => void
  data: HouseholdRow | null
  distributionName?: string
}

export default function HouseholdProfileModal({
  isOpen,
  onClose,
  data,
  distributionName,
}: HouseholdProfileModalProps) {
  const [copied, setCopied] = useState(false)

  if (!isOpen || !data) return null

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(data.householdCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard error
    }
  }

  const isClaimed = data.claimStatus === 'Claimed'

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-full px-4 py-6 sm:py-10 flex items-center justify-center">
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />

        {/* Modal Container */}
        <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-100 dark:border-slate-800">
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
                    Relief Registry • Verified Beneficiary Record
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl sm:text-2xl font-black text-gray-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
                  <span>{data.familyHeadName}</span>
                  <VerifiedBadge />
                </h3>
                <p className="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-slate-400">
                  Official relief assistance record and household census composition.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                aria-label="Close"
              >
                <XIcon />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
            {/* Hero Overview Card */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    Household Registry Code
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-base font-black text-slate-900 dark:text-slate-100 tracking-wider bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-200/70 dark:border-slate-700/70">
                      {data.householdCode}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors shadow-xs"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 shadow-xs">
                    <UsersIcon className="w-3.5 h-3.5 text-slate-400" />
                    <span>{data.familyMembersCount} Person{data.familyMembersCount === 1 ? '' : 's'}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    <MapPinIcon className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{data.barangay}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Residence & Contact Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Address */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-1.5">
                  <HomeIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Physical Address</span>
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  {data.address}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Barangay {data.barangay}
                </div>
              </div>

              {/* Contact */}
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase tracking-wider mb-1.5">
                  <PhoneIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Registered Contact</span>
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  {data.contact || 'No phone number provided'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Family Head Primary Mobile
                </div>
              </div>
            </div>

            {/* Distribution Claim Status Card */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/40 p-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Distribution Claim Status
                  </span>
                </div>
                {distributionName && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 truncate max-w-[260px]">
                    {distributionName}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                      isClaimed
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {data.claimStatus}
                  </span>

                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    {data.lastClaimedAt ? (
                      `Latest aid received: ${new Date(data.lastClaimedAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}`
                    ) : (
                      'No previous relief assistance recorded'
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Registration & Census Info */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Census Registration Date
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">
                  {data.registeredAt
                    ? new Date(data.registeredAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : 'System Record'}
                </p>
              </div>

              <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Verified in Local Barangay Registry</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----- Icons ----- */

function XIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function UsersIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function MapPinIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function HomeIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function PhoneIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  )
}

function CheckCircleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400" title="Verified Household Record">
      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
      </svg>
    </span>
  )
}

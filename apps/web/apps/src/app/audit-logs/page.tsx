'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { DashboardLayout, Header } from '@/components/layout'
import { api } from '@/lib/api'
import type { AuditLogRecord } from '@/lib/api'
import { showToast } from '@/lib/toast'
import {
  Search,
  RotateCcw,
  X,
  Shield,
  Key,
  FileText,
  AlertTriangle,
  Eye,
  Copy,
  Check,
  ExternalLink,
  Globe,
  User,
  Database,
  Clock,
  Layers,
  Terminal,
} from 'lucide-react'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'
import SelectDropdown from '@/components/ui/SelectDropdown'
import SectionHeader from '@/components/ui/SectionHeader'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import Pagination from '@/components/ui/Pagination'

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  // Auth & Access
  { value: 'LOGIN_SUCCESS', label: 'LOGIN_SUCCESS (Login Successful)' },
  { value: 'LOGIN_FAILURE', label: 'LOGIN_FAILURE (Login Failed)' },
  { value: 'LOGOUT', label: 'LOGOUT (Signed Out)' },
  { value: 'ACCESS_DENIED', label: 'ACCESS_DENIED (Unauthorized Attempt)' },
  { value: 'LOGIN_OTP_SENT', label: 'LOGIN_OTP_SENT (2FA OTP Dispatched)' },
  { value: 'LOGIN_OTP_VERIFY_SUCCESS', label: 'LOGIN_OTP_VERIFY_SUCCESS (2FA Verified)' },
  { value: 'LOGIN_OTP_VERIFY_FAILED', label: 'LOGIN_OTP_VERIFY_FAILED (2FA Failed)' },
  { value: 'LOGIN_OTP_RESEND', label: 'LOGIN_OTP_RESEND (2FA Resent)' },
  { value: 'FORGOT_PASSWORD_OTP_REQUESTED', label: 'FORGOT_PASSWORD_OTP_REQUESTED' },
  { value: 'FORGOT_PASSWORD_RESET_SUCCESS', label: 'FORGOT_PASSWORD_RESET_SUCCESS' },
  // Staff Lifecycle
  { value: 'STAFF_CREATED', label: 'STAFF_CREATED (Account Created)' },
  { value: 'STAFF_UPDATED', label: 'STAFF_UPDATED (Details/Barangays Updated)' },
  { value: 'STAFF_DISABLED', label: 'STAFF_DISABLED (Account Suspended)' },
  { value: 'STAFF_DELETED', label: 'STAFF_DELETED (Account Removed)' },
  { value: 'STAFF_PASSWORD_RESET', label: 'STAFF_PASSWORD_RESET' },
  { value: 'STAFF_PASSWORD_RESET_OTP_SENT', label: 'STAFF_PASSWORD_RESET_OTP_SENT' },
  { value: 'STAFF_ACTIVATION_OTP_RESENT', label: 'STAFF_ACTIVATION_OTP_RESENT' },
  // Distribution Lifecycle
  { value: 'DISTRIBUTION_CREATED', label: 'DISTRIBUTION_CREATED (New Run Created)' },
  { value: 'DISTRIBUTION_RESCHEDULED', label: 'DISTRIBUTION_RESCHEDULED (Dates Shifted)' },
  { value: 'DISTRIBUTION_STAFF_UPDATED', label: 'DISTRIBUTION_STAFF_UPDATED (Staff Assigned)' },
  { value: 'DISTRIBUTION_CLAIMED', label: 'DISTRIBUTION_CLAIMED (Marked Claimed)' },
  { value: 'DISTRIBUTION_ARCHIVED', label: 'DISTRIBUTION_ARCHIVED (Archived)' },
  { value: 'DISTRIBUTION_RESTORED', label: 'DISTRIBUTION_RESTORED (Restored)' },
  // Claims & Sync
  { value: 'CLAIM_RECORDED', label: 'CLAIM_RECORDED (Aid Package Claimed)' },
  { value: 'BENEFICIARY_CLAIM_RECORDED', label: 'BENEFICIARY_CLAIM_RECORDED' },
  { value: 'BENEFICIARY_ELIGIBILITY_UPDATED', label: 'BENEFICIARY_ELIGIBILITY_UPDATED' },
  { value: 'OFFLINE_SYNC_RECEIVED', label: 'OFFLINE_SYNC_RECEIVED (Offline Scans Synced)' },
  { value: 'CLAIM_RETRY', label: 'CLAIM_RETRY' },
  // Resident & Household Operations
  { value: 'RESIDENT_STATUS_UPDATED', label: 'RESIDENT_STATUS_UPDATED (Approval / Status Change)' },
  { value: 'RESIDENT_ASSISTED_REVISED', label: 'RESIDENT_ASSISTED_REVISED (Staff Assisted Edit)' },
  { value: 'PROOF_SUBMISSION_CREATED', label: 'PROOF_SUBMISSION_CREATED' },
  { value: 'PROOF_SUBMISSION_REVIEWED', label: 'PROOF_SUBMISSION_REVIEWED (Document Proof)' },
  { value: 'HOUSEHOLD_UPDATED', label: 'HOUSEHOLD_UPDATED' },
]

function getActionBadgeStyle(action: string): { bg: string; text: string; border: string } {
  if (
    action.includes('FAILURE') ||
    action.includes('DENIED') ||
    action.includes('DELETED') ||
    action.includes('DISABLED')
  ) {
    return {
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      text: 'text-rose-700 dark:text-rose-300',
      border: 'border-rose-200 dark:border-rose-800/60',
    }
  }
  if (
    action.includes('SUCCESS') ||
    action.includes('CREATED') ||
    action.includes('RESTORED') ||
    action.includes('CLAIMED')
  ) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800/60',
    }
  }
  if (action.includes('UPDATED') || action.includes('RESCHEDULED') || action.includes('REVISED')) {
    return {
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200 dark:border-amber-800/60',
    }
  }
  if (action.includes('OTP') || action.includes('SYNC') || action.includes('SUBMISSION')) {
    return {
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-200 dark:border-blue-800/60',
    }
  }
  return {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
  }
}

function getRoleBadge(role: string): { label: string; className: string } {
  const normalized = (role || '').toUpperCase()
  if (normalized === 'SUPERADMIN') {
    return {
      label: 'Superadmin',
      className:
        'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    }
  }
  if (normalized === 'LGU_STAFF') {
    return {
      label: 'LGU Staff',
      className:
        'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    }
  }
  if (normalized === 'VOLUNTEER') {
    return {
      label: 'Volunteer',
      className:
        'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300 border-teal-200 dark:border-teal-800',
    }
  }
  return {
    label: role || 'System',
    className:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  }
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Direct column filters
  const [dateFilter, setDateFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')

  // Debounced values for text filters
  const [debouncedActor, setDebouncedActor] = useState('')
  const [debouncedTarget, setDebouncedTarget] = useState('')

  // Active inspect modal
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedActor(actorFilter)
    }, 300)
    return () => clearTimeout(handler)
  }, [actorFilter])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTarget(targetFilter)
    }, 300)
    return () => clearTimeout(handler)
  }, [targetFilter])

  const hasActiveFilters = Boolean(dateFilter || actionFilter || actorFilter || targetFilter)

  const handleResetFilters = () => {
    setDateFilter('')
    setActionFilter('')
    setActorFilter('')
    setTargetFilter('')
    setPage(1)
  }

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.getAuditLogs({
        page,
        limit: 50,
        action: actionFilter || undefined,
        actor: debouncedActor || undefined,
        target: debouncedTarget || undefined,
        date: dateFilter || undefined,
      })
      setLogs(res.data || [])
      if (res.pagination) {
        setTotalPages(res.pagination.totalPages)
        setTotal(res.pagination.totalDocs || 0)
      }
    } catch (err) {
      console.error(err)
      showToast.error('Failed to load audit logs.')
    } finally {
      setLoading(false)
    }
  }, [page, actionFilter, debouncedActor, debouncedTarget, dateFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const securityAlertCount = useMemo(
    () => logs.filter((l) => l.action === 'ACCESS_DENIED' || l.action === 'LOGIN_FAILURE').length,
    [logs],
  )
  const mutationCount = useMemo(
    () =>
      logs.filter(
        (l) =>
          l.action.includes('CREATED') ||
          l.action.includes('UPDATED') ||
          l.action.includes('REVIEWED') ||
          l.action.includes('REVISED'),
      ).length,
    [logs],
  )

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  return (
    <DashboardLayout>
      <Header
        title="Audit Logs"
        subtitle="System activity and security events (Superadmin Only)"
      />

      {/* ── Top Level Control Section & Metrics ── */}
      <section className="mb-6 overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
        <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
          <SectionHeader
            eyebrow="Security & Governance"
            title="System audit activity"
            subtitle="Immutable audit trail of administrator actions, resident verifications, and distribution lifecycle events"
            rightAccessory={
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                Total events {total.toLocaleString()}
              </div>
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
          <SummaryMetricCard
            label="Total Logged"
            value={total}
            helper="All recorded audit events"
            variant="blue"
            icon={<Shield className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Visible Page"
            value={logs.length}
            helper={`Page ${page} of ${totalPages || 1}`}
            variant="purple"
            icon={<FileText className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Data Changes"
            value={mutationCount}
            helper="Creations & updates on page"
            variant="emerald"
            icon={<Key className="h-5 w-5" />}
          />
          <SummaryMetricCard
            label="Security Alerts"
            value={securityAlertCount}
            helper="Denied access & failed logins"
            variant="rose"
            icon={<AlertTriangle className="h-5 w-5" />}
          />
        </div>
      </section>

      {/* ── Audit Logs Table Card ── */}
      <div className="overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
        <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-4 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                Audit Directory
              </p>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Event records
              </h3>
            </div>
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset filters
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto min-h-[460px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
              <tr>
                {/* Timestamp Column Header & Filter */}
                <th className="px-5 py-3.5 align-top min-w-[180px]">
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      Timestamp
                    </span>
                    {dateFilter && (
                      <button
                        onClick={() => {
                          setDateFilter('')
                          setPage(1)
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Clear date"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => {
                      setDateFilter(e.target.value)
                      setPage(1)
                    }}
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-normal transition-all"
                  />
                </th>

                {/* Action Column Header & Filter */}
                <th className="px-5 py-3.5 align-top min-w-[240px] relative z-20">
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      Action
                    </span>
                    {actionFilter && (
                      <button
                        onClick={() => {
                          setActionFilter('')
                          setPage(1)
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Clear action"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <SelectDropdown
                    value={actionFilter}
                    options={ACTION_OPTIONS}
                    onChange={(val) => {
                      setActionFilter(val)
                      setPage(1)
                    }}
                    placeholder="All Actions"
                    ariaLabel="Filter by action"
                    className="w-full text-xs font-normal"
                    buttonClassName="!h-[32px] !text-xs !px-2.5 !py-1 !rounded-lg !border-slate-200 dark:!border-slate-700 !bg-white dark:!bg-slate-800 text-slate-700 dark:text-slate-200 !shadow-none font-normal"
                    menuClassName="min-w-[280px] !text-xs !rounded-xl max-h-72"
                  />
                </th>

                {/* Actor Column Header & Filter */}
                <th className="px-5 py-3.5 align-top min-w-[200px]">
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      Actor
                    </span>
                    {actorFilter && (
                      <button
                        onClick={() => {
                          setActorFilter('')
                          setPage(1)
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Clear actor filter"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter by name / role..."
                      value={actorFilter}
                      maxLength={MAX_SEARCH_LENGTH}
                      onChange={(e) => {
                        setActorFilter(sanitizeSearchQuery(e.target.value))
                        setPage(1)
                      }}
                      className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-normal transition-all"
                    />
                  </div>
                </th>

                {/* Target Column Header & Filter */}
                <th className="px-5 py-3.5 align-top min-w-[260px]">
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      Target Entity
                    </span>
                    {targetFilter && (
                      <button
                        onClick={() => {
                          setTargetFilter('')
                          setPage(1)
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Clear target filter"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter target (e.g. San Jose, resident)..."
                      value={targetFilter}
                      maxLength={MAX_SEARCH_LENGTH}
                      onChange={(e) => {
                        setTargetFilter(sanitizeSearchQuery(e.target.value))
                        setPage(1)
                      }}
                      className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-normal transition-all"
                    />
                  </div>
                </th>

                {/* Action / Inspect Header */}
                <th className="px-5 py-3.5 align-top text-right w-[110px]">
                  <div className="mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      Details
                    </span>
                  </div>
                  <div className="h-[32px] flex items-center justify-end">
                    <span className="text-[11px] text-slate-400">Inspect</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mb-2"></div>
                      Loading audit logs...
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center">
                      <Search className="w-8 h-8 mb-2 opacity-20" />
                      <p className="font-medium">No audit logs found.</p>
                      {hasActiveFilters && (
                        <button
                          onClick={handleResetFilters}
                          className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const badge = getActionBadgeStyle(log.action)
                  const roleBadge = getRoleBadge(log.actorRole)
                  return (
                    <tr
                      key={log._id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer"
                      onClick={() => setSelectedLog(log)}
                    >
                      {/* Timestamp */}
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {new Date(log.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {new Date(log.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </div>
                      </td>

                      {/* Action */}
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border ${badge.bg} ${badge.text} ${badge.border}`}
                        >
                          {log.action}
                        </span>
                      </td>

                      {/* Actor */}
                      <td className="px-5 py-4">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          {log.actorName || 'System'}
                        </div>
                        <div className="mt-1">
                          <span
                            className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md border ${roleBadge.className}`}
                          >
                            {roleBadge.label}
                          </span>
                        </div>
                      </td>

                      {/* Target */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 shrink-0">
                            {log.entityType}
                          </span>
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[280px]" title={log.entityLabel || log.entityId}>
                            {log.entityLabel || (log.entityId ? `#${log.entityId.slice(-6)}` : '—')}
                          </span>
                        </div>
                        {log.entityId && (
                          <div className="text-[11px] font-mono text-slate-400 mt-1 flex items-center gap-1.5">
                            <span>ID: {log.entityId.slice(-8)}</span>
                            {log.entityType === 'Distribution' && (
                              <Link
                                href="/distributions"
                                onClick={(e) => e.stopPropagation()}
                                className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5 text-[10px]"
                              >
                                View <ExternalLink className="w-2.5 h-2.5" />
                              </Link>
                            )}
                            {log.entityType === 'Resident' && (
                              <Link
                                href="/resident-registration"
                                onClick={(e) => e.stopPropagation()}
                                className="text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-0.5 text-[10px]"
                              >
                                View <ExternalLink className="w-2.5 h-2.5" />
                              </Link>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Inspect Action */}
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedLog(log)
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-600 dark:hover:text-emerald-400 border border-slate-200 dark:border-slate-700 transition-colors shadow-sm"
                          title="Inspect audit details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Details</span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={50}
            onPageChange={setPage}
            itemLabel="audit logs"
          />
        )}
      </div>

      {/* ── Inspection Modal / Forensic Drawer ── */}
      {selectedLog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[28px] border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Audit Record Inspection
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Immutable event ID: <span className="font-mono">{selectedLog._id}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              {/* Event & Action Summary */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Logged Event
                  </span>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-xl text-xs font-mono font-bold border ${
                        getActionBadgeStyle(selectedLog.action).bg
                      } ${getActionBadgeStyle(selectedLog.action).text} ${
                        getActionBadgeStyle(selectedLog.action).border
                      }`}
                    >
                      {selectedLog.action}
                    </span>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center sm:justify-end gap-1">
                    <Clock className="w-3.5 h-3.5" /> Timestamp
                  </span>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">
                    {new Date(selectedLog.createdAt).toLocaleString(undefined, {
                      dateStyle: 'full',
                      timeStyle: 'medium',
                    })}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                    {new Date(selectedLog.createdAt).toISOString()}
                  </p>
                </div>
              </div>

              {/* Actor & Target 2-Column Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Actor Card */}
                <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/20">
                  <div className="flex items-center gap-2 mb-2 text-slate-500 dark:text-slate-400">
                    <User className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Actor Details
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="text-base font-bold text-slate-900 dark:text-white">
                      {selectedLog.actorName || 'System'}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                          getRoleBadge(selectedLog.actorRole).className
                        }`}
                      >
                        {getRoleBadge(selectedLog.actorRole).label}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono pt-1">
                      ID: {selectedLog.actorId || 'N/A (System)'}
                    </div>
                  </div>
                </div>

                {/* Target Card */}
                <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/20">
                  <div className="flex items-center gap-2 mb-2 text-slate-500 dark:text-slate-400">
                    <Database className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Target Entity
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                        {selectedLog.entityType}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      {selectedLog.entityLabel || 'General System Operation'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono pt-1 break-all">
                      DB ID: {selectedLog.entityId || 'None'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Forensic & Network Info */}
              <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/20">
                <div className="flex items-center gap-2 mb-3 text-slate-500 dark:text-slate-400">
                  <Globe className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Forensic & Network Metadata
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                    <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">
                      IP Address
                    </div>
                    <div className="flex items-center justify-between gap-1 font-mono text-xs text-slate-800 dark:text-slate-200 font-semibold">
                      <span>{selectedLog.ip || 'Unknown'}</span>
                      {selectedLog.ip && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(selectedLog.ip, 'ip')}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          title="Copy IP"
                        >
                          {copiedKey === 'ip' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                    <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">
                      Client User Agent
                    </div>
                    <div
                      className="text-xs text-slate-600 dark:text-slate-300 font-mono truncate"
                      title={selectedLog.userAgent}
                    >
                      {selectedLog.userAgent || 'None reported'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Event Metadata Payload */}
              <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-800/20">
                <div className="flex items-center justify-between mb-2 text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Event Metadata Payload
                    </span>
                  </div>
                  {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          JSON.stringify(selectedLog.metadata, null, 2),
                          'metadata',
                        )
                      }
                      className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                    >
                      {copiedKey === 'metadata' ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied JSON
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy JSON
                        </>
                      )}
                    </button>
                  )}
                </div>

                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 ? (
                  <pre className="p-3 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto max-h-48 border border-slate-800">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-slate-400 italic">
                    No contextual metadata payload attached to this audit event.
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Kapit-Bisig Security Trail • Non-repudiable
              </span>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

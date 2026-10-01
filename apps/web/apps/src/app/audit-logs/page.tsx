'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { DashboardLayout, Header } from '@/components/layout'
import { api } from '@/lib/api'
import type { AuditLogRecord } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { ChevronLeft, ChevronRight, Search, RotateCcw, X, Shield, Key, FileText, AlertTriangle } from 'lucide-react'
import { sanitizeSearchQuery, MAX_SEARCH_LENGTH } from '@/lib/inputValidation'
import SelectDropdown from '@/components/ui/SelectDropdown'
import SectionHeader from '@/components/ui/SectionHeader'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import Pagination from '@/components/ui/Pagination'

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'LOGIN_SUCCESS', label: 'LOGIN_SUCCESS' },
  { value: 'LOGIN_FAILURE', label: 'LOGIN_FAILURE' },
  { value: 'LOGOUT', label: 'LOGOUT' },
  { value: 'DISTRIBUTION_CREATED', label: 'DISTRIBUTION_CREATED' },
  { value: 'DISTRIBUTION_RESCHEDULED', label: 'DISTRIBUTION_RESCHEDULED' },
  { value: 'DISTRIBUTION_CLAIMED', label: 'DISTRIBUTION_CLAIMED' },
  { value: 'CLAIM_RECORDED', label: 'CLAIM_RECORDED' },
  { value: 'STAFF_CREATED', label: 'STAFF_CREATED' },
  { value: 'STAFF_UPDATED', label: 'STAFF_UPDATED' },
  { value: 'RESIDENT_STATUS_UPDATED', label: 'RESIDENT_STATUS_UPDATED' },
  { value: 'PROOF_SUBMISSION_CREATED', label: 'PROOF_SUBMISSION_CREATED' },
  { value: 'PROOF_SUBMISSION_REVIEWED', label: 'PROOF_SUBMISSION_REVIEWED' },
  { value: 'BENEFICIARY_ELIGIBILITY_UPDATED', label: 'BENEFICIARY_ELIGIBILITY_UPDATED' },
  { value: 'BENEFICIARY_CLAIM_RECORDED', label: 'BENEFICIARY_CLAIM_RECORDED' },
  { value: 'OFFLINE_SYNC_RECEIVED', label: 'OFFLINE_SYNC_RECEIVED' },
  { value: 'ACCESS_DENIED', label: 'ACCESS_DENIED' },
]

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
  const [ipFilter, setIpFilter] = useState('')

  // Debounced values for text filters
  const [debouncedActor, setDebouncedActor] = useState('')
  const [debouncedTarget, setDebouncedTarget] = useState('')
  const [debouncedIp, setDebouncedIp] = useState('')

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

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedIp(ipFilter)
    }, 300)
    return () => clearTimeout(handler)
  }, [ipFilter])

  const hasActiveFilters = Boolean(
    dateFilter || actionFilter || actorFilter || targetFilter || ipFilter
  )

  const handleResetFilters = () => {
    setDateFilter('')
    setActionFilter('')
    setActorFilter('')
    setTargetFilter('')
    setIpFilter('')
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
        ip: debouncedIp || undefined,
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
  }, [page, actionFilter, debouncedActor, debouncedTarget, debouncedIp, dateFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const securityAlertCount = useMemo(
    () => logs.filter((l) => l.action === 'ACCESS_DENIED' || l.action === 'LOGIN_FAILURE').length,
    [logs]
  )
  const mutationCount = useMemo(
    () => logs.filter((l) => l.action.includes('CREATED') || l.action.includes('UPDATED') || l.action.includes('REVIEWED')).length,
    [logs]
  )

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
                <th className="px-5 py-3.5 align-top min-w-[190px]">
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
                <th className="px-5 py-3.5 align-top min-w-[210px] relative z-20">
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
                    menuClassName="min-w-[240px] !text-xs !rounded-xl"
                  />
                </th>

                {/* Actor Column Header & Filter */}
                <th className="px-5 py-3.5 align-top min-w-[190px]">
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
                      placeholder="Filter actor / role..."
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
                <th className="px-5 py-3.5 align-top min-w-[180px]">
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      Target
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
                      placeholder="Filter target entity..."
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

                {/* IP / User Agent Column Header & Filter */}
                <th className="px-5 py-3.5 align-top min-w-[200px]">
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="font-semibold text-xs text-slate-700 dark:text-slate-200">
                      IP / User Agent
                    </span>
                    {ipFilter && (
                      <button
                        onClick={() => {
                          setIpFilter('')
                          setPage(1)
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                        title="Clear IP / UA filter"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter IP or agent..."
                      value={ipFilter}
                      maxLength={MAX_SEARCH_LENGTH}
                      onChange={(e) => {
                        setIpFilter(sanitizeSearchQuery(e.target.value))
                        setPage(1)
                      }}
                      className="w-full text-xs pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-normal transition-all"
                    />
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
                logs.map((log) => (
                  <tr key={log._id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-5 py-4 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-900 dark:text-white font-medium">
                        {log.actorName || log.actorId || 'System'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{log.actorRole}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-600 dark:text-slate-300">{log.entityType}</div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">{log.entityId}</div>
                    </td>
                    <td className="px-5 py-4 max-w-[220px]">
                      <div className="text-slate-600 dark:text-slate-300 font-mono text-xs">{log.ip}</div>
                      <div className="text-[10px] text-slate-400 mt-1 truncate" title={log.userAgent}>
                        {log.userAgent}
                      </div>
                    </td>
                  </tr>
                ))
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
    </DashboardLayout>
  )
}

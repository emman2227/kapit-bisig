'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import DistributionStats from './DistributionStats'
import DistributionsTable, { DistributionRow } from './DistributionsTable'
import NewDistributionModal, { CreateDistributionPayload } from './NewDistributionModal'
import { api, getScopedBarangays } from '../../lib/api'
import { showToast } from '@/lib/toast'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/lib/AuthContext'
import ConfirmModal from '@/components/ui/ConfirmModal'

// Barangay options are now computed dynamically per-user

export default function DistributionPageClient() {
  const { user, loading: authLoading, isSuperadmin } = useAuth()
  const scopedBarangays = useMemo(
    () => getScopedBarangays(user?.role, user?.assignedBarangays),
    [user?.role, user?.assignedBarangays],
  )

  const [rows, setRows] = useState<DistributionRow[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lifecycleView, setLifecycleView] = useState<'upcoming' | 'active' | 'completed' | 'archived'>('active')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null)
  const [isArchiving, setIsArchiving] = useState(false)

  const fetchDistributions = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setError(null)
      }
      const res = await api.getDistributions({ view: 'all' })
      if (res.success && res.data) {
        const mapped: DistributionRow[] = res.data.map((d) => ({
          id: d.id || d._id,
          barangay: d.barangay,
          assignedBarangays: d.assignedBarangays ?? [],
          assignedStaffIds: Array.isArray(d.assignedStaffIds)
            ? d.assignedStaffIds.map((item: any) => (typeof item === 'string' ? item : item.toString()))
            : [],
          scheduled: d.scheduled,
          endsAt: d.endsAt,
          households: d.households,
          registeredHouseholds: d.registeredHouseholds ?? 0,
          claimedHouseholds: d.claimedHouseholds ?? 0,
          notes: d.notes,
          requiresBeneficiaryApproval: d.requiresBeneficiaryApproval ?? false,
          status: d.status as 'Unclaimed' | 'Partially Claimed' | 'Claimed',
          claimedAt: d.claimedAt,
          createdAt: d.createdAt,
          archivedAt: d.archivedAt ?? null,
          archivedBy: d.archivedBy ?? null,
          lifecycleStatus: d.lifecycleStatus ?? 'Completed',
        }))
        setRows(mapped)
        setLastUpdated(new Date())
      }
    } catch (err: unknown) {
      console.error('Failed to load distributions:', err)
      if (!silent) {
        setError('Failed to load distributions. Please try again.')
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    // Don't fetch if not authenticated
    if (authLoading || !user) {
      setLoading(false)
      return
    }
    fetchDistributions(false)
  }, [fetchDistributions, authLoading, user])

  // Live data hook: poll for live claim updates when active and tab is visible
  useEffect(() => {
    if (authLoading || !user) return

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchDistributions(true)
      }
    }

    const intervalId = window.setInterval(refreshIfVisible, 4000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [fetchDistributions, authLoading, user])

  const activeCount = useMemo(
    () => rows.filter((r) => r.lifecycleStatus === 'Active').length,
    [rows]
  )
  const upcomingCount = useMemo(
    () => rows.filter((r) => r.lifecycleStatus === 'Upcoming').length,
    [rows]
  )
  const completedCount = useMemo(
    () => rows.filter((r) => r.lifecycleStatus === 'Completed').length,
    [rows]
  )
  const archivedCount = useMemo(
    () => rows.filter((r) => r.lifecycleStatus === 'Archived').length,
    [rows]
  )
  const visibleRows = useMemo(
    () => rows.filter((r) => r.lifecycleStatus.toLowerCase() === lifecycleView),
    [rows, lifecycleView]
  )
  const barangaysCount = useMemo(() => {
    const set = new Set(rows.map((r) => r.barangay))
    return set.size
  }, [rows])

  const householdsServedCount = useMemo(
    () => rows.reduce((sum, r) => sum + r.claimedHouseholds, 0),
    [rows]
  )

  const handleCreate = async (payload: CreateDistributionPayload) => {
    try {
      setError(null)
      const result = await api.createDistribution({
        disasterEventId: payload.disasterEventId,
        barangay: payload.barangay,
        assignedBarangays: payload.assignedBarangays,
        location: payload.location,
        assignedStaffIds: payload.assignedStaffIds,
        scheduled: payload.scheduled,
        endsAt: payload.endsAt,
        notes: payload.notes,
        requiresBeneficiaryApproval: payload.requiresBeneficiaryApproval,
      }, {
        idempotencyKey: crypto.randomUUID(),
      })
      setCreateOpen(false)
      const describeChannel = (label: string, delivery: typeof result.smsDelivery) => {
        if (!delivery) return `${label}: no summary returned`
        const statusLabel = {
          sent_successfully: 'sent successfully',
          partially_delivered: 'partially delivered',
          no_eligible_recipients: 'no eligible recipients',
          provider_not_configured: 'provider not configured',
          provider_request_failed: 'provider request failed',
        }[delivery.status]
        return `${label}: ${statusLabel} (${delivery.sent}/${delivery.attempted} sent, ${delivery.failed} failed, ${delivery.skipped} skipped)`
      }
      const channelMessage = [
        describeChannel('SMS', result.smsDelivery),
        describeChannel('Push', result.pushDelivery),
      ].join(' • ')
      const hasChannelWarning = [result.smsDelivery, result.pushDelivery].some((delivery) =>
        delivery && ['partially_delivered', 'provider_not_configured', 'provider_request_failed'].includes(delivery.status)
      )
      if (hasChannelWarning) showToast.info(`Distribution created. ${channelMessage}`)
      else showToast.success(`Distribution created. ${channelMessage}`)
      await fetchDistributions()
    } catch (err: unknown) {
      console.error('Failed to create distribution:', err)
      const message = 'Failed to create distribution. Please try again.'
      setError(message)
      showToast.error(message)
      throw err
    }
  }

  const pendingArchiveDistribution = useMemo(
    () => (pendingArchiveId ? rows.find((r) => r.id === pendingArchiveId) : null),
    [pendingArchiveId, rows],
  )

  const archiveDistribution = (id: string) => {
    setPendingArchiveId(id)
  }

  const handleConfirmArchive = async () => {
    if (!pendingArchiveId) return
    try {
      setIsArchiving(true)
      await api.archiveDistribution(pendingArchiveId)
      showToast.success('Distribution archived. Historical records were preserved.')
      setPendingArchiveId(null)
      await fetchDistributions()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to archive distribution'
      showToast.error(message)
    } finally {
      setIsArchiving(false)
    }
  }

  const restoreDistribution = async (id: string) => {
    try {
      await api.restoreDistribution(id)
      showToast.success('Distribution restored to completed history.')
      await fetchDistributions()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to restore distribution'
      showToast.error(message)
    }
  }

  const markClaimed = async (id: string) => {
    try {
      setError(null)
      await api.claimDistribution(id)
      showToast.success('Distribution marked as claimed.')
      await fetchDistributions()
    } catch (err: unknown) {
      console.error('Failed to mark as claimed:', err)
      const message = 'Failed to mark as claimed. Please try again.'
      setError(message)
      showToast.error(message)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-2xl p-4 border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)] bg-white animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-200" />
                <div className="space-y-2"><div className="h-5 w-16 bg-gray-200 rounded" /><div className="h-3 w-24 bg-gray-200 rounded" /></div>
              </div>
            </div>
          ))}
        </div>
        <TableSkeleton rows={6} columns={6} />
      </div>
    )
  }

  return (
    <div>
      <DistributionStats
        active={activeCount}
        upcoming={upcomingCount}
        householdsServed={householdsServedCount}
        barangays={barangaysCount}
      />

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl px-5 py-4 flex items-center gap-3">
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Distribution lifecycle">
          {(['active', 'upcoming', 'completed', 'archived'] as const).map((view) => {
            const count =
              view === 'active'
                ? activeCount
                : view === 'upcoming'
                  ? upcomingCount
                  : view === 'completed'
                    ? completedCount
                    : archivedCount
            return (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={lifecycleView === view}
                onClick={() => setLifecycleView(view)}
                className={[
                  'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold capitalize transition-colors',
                  lifecycleView === view
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-950',
                ].join(' ')}
              >
                <span>{view}</span>
                <span
                  className={[
                    'inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold',
                    lifecycleView === view
                      ? 'bg-slate-800 text-white'
                      : 'bg-slate-100 text-slate-600',
                  ].join(' ')}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {lastUpdated && (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span>Live claims active</span>
          </div>
        )}
      </div>

      <DistributionsTable
        rows={visibleRows}
        onOpenCreate={() => setCreateOpen(true)}
        onMarkClaimed={markClaimed}
        onRefresh={fetchDistributions}
        canCreate={isSuperadmin}
        lifecycleView={lifecycleView}
        canManageLifecycle={isSuperadmin}
        onArchive={archiveDistribution}
        onRestore={restoreDistribution}
      />

      {isSuperadmin && (
        <NewDistributionModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreate={handleCreate}
          barangayOptions={scopedBarangays}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(pendingArchiveId)}
        title="Archive Distribution"
        body={
          pendingArchiveDistribution
            ? `Archive the distribution for ${pendingArchiveDistribution.barangay}? Residents and scanners will not see it, but claims and reports will be preserved.`
            : 'Archive this completed distribution? Residents and scanners will not see it, but claims and reports will be preserved.'
        }
        confirmLabel="Archive"
        cancelLabel="Cancel"
        loading={isArchiving}
        onCancel={() => {
          if (!isArchiving) setPendingArchiveId(null)
        }}
        onConfirm={handleConfirmArchive}
      />
    </div>
  )
}

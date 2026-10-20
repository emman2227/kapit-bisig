'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { DashboardLayout, Header } from '@/components/layout'
import HouseholdStats from '@/components/households/PriorityStats'
import HouseholdsTable, { DistributionOption } from '@/components/households/HouseholdsTable'
import api, { getScopedBarangays, DistributionData } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'

export interface HouseholdRow {
  id: string
  householdCode: string
  familyHeadName: string
  barangay: string
  address: string
  familyMembersCount: number
  contact: string
  verificationStatus: string
  verificationScore: number | null
  claimStatus: 'Claimed' | 'Unclaimed'
  lastClaimedAt: string | null
  registeredAt: string | null
}

type BarangayFilter = string
const STATUS_OPTIONS = ['All Status', 'Claimed', 'Unclaimed'] as const
type StatusFilter = (typeof STATUS_OPTIONS)[number]

export default function HouseholdsPage() {
  const { user } = useAuth()
  const BARANGAY_OPTIONS = useMemo(
    () => ['All Barangays', ...getScopedBarangays(user?.role, user?.assignedBarangays)],
    [user?.role, user?.assignedBarangays],
  )

  const [allRows, setAllRows] = useState<HouseholdRow[]>([])
  const [distributions, setDistributions] = useState<DistributionData[]>([])
  const [selectedDistributionId, setSelectedDistributionId] = useState<string>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [barangay, setBarangay] = useState<BarangayFilter>('All Barangays')
  const [status, setStatus] = useState<StatusFilter>('All Status')

  // Load available distribution cycles on mount
  useEffect(() => {
    let isMounted = true
    api.getDistributions({ view: 'all' })
      .then((res) => {
        if (isMounted && res.success && Array.isArray(res.data)) {
          setDistributions(res.data)
        }
      })
      .catch((err) => console.error('Failed to fetch distributions for registry:', err))
    return () => {
      isMounted = false
    }
  }, [])

  const distributionOptions = useMemo(() => {
    const options: DistributionOption[] = []

    const hasActive = distributions.some((d) => d.status !== 'Claimed' && !d.archivedAt)
    if (hasActive) {
      options.push({
        value: 'active',
        label: 'Current / Active Cycle',
        isCurrent: true,
      })
    }

    distributions.forEach((d) => {
      const distId = d._id || d.id
      const dateStr = d.scheduled
        ? new Date(d.scheduled).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : ''
      const isCompleted = d.status === 'Claimed'
      const isCurrent = !isCompleted && !d.archivedAt
      const statusTag = isCompleted ? 'Completed' : isCurrent ? 'Active' : d.status
      const label = `${d.barangay}${dateStr ? ` • ${dateStr}` : ''} (${statusTag})`
      options.push({
        value: distId,
        label,
        isCurrent,
        barangay: d.barangay,
        assignedBarangays: d.assignedBarangays,
        scheduled: d.scheduled,
        status: d.status,
        lifecycleStatus: d.lifecycleStatus || (isCompleted ? 'Completed' : isCurrent ? 'Active' : 'Archived'),
        claimedHouseholds: d.claimedHouseholds,
        registeredHouseholds: d.registeredHouseholds,
        households: d.households,
        notes: d.notes,
      })
    })

    options.push({
      value: 'all',
      label: 'All Cycles (Lifetime Claimed)',
    })

    return options
  }, [distributions])

  const fetchHouseholds = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const pageSize = 50
      let page = 1
      let totalPages = 1
      const mergedRows: HouseholdRow[] = []

      do {
        const res = await api.getHouseholds({
          page,
          limit: pageSize,
          distributionId: selectedDistributionId,
        })
        if (!res.success || !Array.isArray(res.data)) break
        const normalized = (res.data as any[]).map((row) => ({
          ...row,
          claimStatus: row.claimStatus === 'Claimed' ? ('Claimed' as const) : ('Unclaimed' as const),
        }))
        mergedRows.push(...normalized)
        totalPages = res.pagination?.totalPages || 1
        page += 1
      } while (page <= totalPages)

      setAllRows(mergedRows)
    } catch (e: unknown) {
      console.error('Failed to fetch households:', e)
      if (!silent) {
        const err = e as { status?: number; message?: string }
        if (err?.status === 401) setError('Your session has expired. Please log in again.')
        else if (err?.status === 403) setError('You do not have access to view households.')
        else if (typeof err?.status === 'number') setError('Failed to fetch households. Please try again.')
        else setError('Unable to connect to the server. Please make sure the backend is running.')
        setAllRows([])
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [selectedDistributionId])

  useEffect(() => {
    fetchHouseholds(false)
  }, [fetchHouseholds])

  // Live data hook: silently poll for claim status changes when active and tab is visible
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchHouseholds(true)
      }
    }

    const intervalId = window.setInterval(refreshIfVisible, 5000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
    }
  }, [fetchHouseholds])

  const statCounts = useMemo(() => {
    const total = allRows.length
    const claimed = allRows.filter((h) => h.claimStatus === 'Claimed').length
    const notClaimed = allRows.filter((h) => h.claimStatus === 'Unclaimed').length
    const withClaimHistory = allRows.filter((h) => Boolean(h.lastClaimedAt)).length
    return { total, claimed, notClaimed, withClaimHistory }
  }, [allRows])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allRows.filter((h) => {
      const matchesSearch =
        !q ||
        h.familyHeadName.toLowerCase().includes(q) ||
        h.householdCode.toLowerCase().includes(q) ||
        h.barangay.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q)

      const matchesBarangay = barangay === 'All Barangays' || h.barangay === barangay
      const matchesStatus = status === 'All Status' || h.claimStatus === status
      return matchesSearch && matchesBarangay && matchesStatus
    })
  }, [searchQuery, barangay, status, allRows])

  return (
    <DashboardLayout>
      <div className="max-w-[1600px] mx-auto w-full">
        <Header
          title="Relief Registry"
          subtitle="Track resident-based relief records, claim progress, and assistance history"
        />

        <div className="mt-6">
          <HouseholdStats counts={statCounts} />
        </div>

        <HouseholdsTable
          rows={filtered}
          loading={loading}
          error={error}
          hasAnyRows={allRows.length > 0}
          onRetry={() => fetchHouseholds(false)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          barangay={barangay}
          barangayOptions={BARANGAY_OPTIONS as unknown as string[]}
          onBarangayChange={(v) => setBarangay(v as BarangayFilter)}
          status={status}
          statusOptions={STATUS_OPTIONS as unknown as string[]}
          onStatusChange={(v) => setStatus(v as StatusFilter)}
          distributionId={selectedDistributionId}
          distributionOptions={distributionOptions}
          onDistributionChange={(v) => setSelectedDistributionId(v)}
        />
      </div>
    </DashboardLayout>
  )
}

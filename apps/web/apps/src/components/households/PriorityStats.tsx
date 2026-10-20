import React from 'react'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import SectionHeader from '@/components/ui/SectionHeader'

type Counts = {
  total: number
  claimed: number
  notClaimed: number
  withClaimHistory: number
}

export default function HouseholdStats({
  counts,
  activeFilter = 'All Status',
  onlyWithHistory = false,
  onFilterChange,
}: {
  counts?: Partial<Counts>
  activeFilter?: string
  onlyWithHistory?: boolean
  onFilterChange?: (status: 'All Status' | 'Claimed' | 'Unclaimed', withHistory?: boolean) => void
}) {
  const total = counts?.total ?? 0
  const claimed = counts?.claimed ?? 0
  const notClaimed = counts?.notClaimed ?? 0
  const withClaimHistory = counts?.withClaimHistory ?? 0
  const claimRate = total > 0 ? Math.round((claimed / total) * 100) : 0

  const handleAllClick = () => {
    onFilterChange?.('All Status', false)
  }

  const handleClaimedClick = () => {
    if (activeFilter === 'Claimed' && !onlyWithHistory) {
      onFilterChange?.('All Status', false)
    } else {
      onFilterChange?.('Claimed', false)
    }
  }

  const handlePendingClick = () => {
    if (activeFilter === 'Unclaimed' && !onlyWithHistory) {
      onFilterChange?.('All Status', false)
    } else {
      onFilterChange?.('Unclaimed', false)
    }
  }

  const handleHistoryClick = () => {
    if (onlyWithHistory) {
      onFilterChange?.('All Status', false)
    } else {
      onFilterChange?.('All Status', true)
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
      <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
        <SectionHeader
          eyebrow="Relief Registry Overview"
          title="Resident relief summary"
          subtitle="Comprehensive overview of registered resident households, assistance claims, and distribution coverage"
          rightAccessory={
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              Claim rate {claimRate}%
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        <SummaryMetricCard
          label="Registry Rows"
          value={total}
          helper="Resident-based records"
          variant="blue"
          icon={<UsersIcon className="h-5 w-5" />}
          onClick={handleAllClick}
          isSelected={activeFilter === 'All Status' && !onlyWithHistory}
        />
        <SummaryMetricCard
          label="Claimed"
          value={claimed}
          helper="Released support (click to filter)"
          variant="emerald"
          icon={<CheckCircleIcon className="h-5 w-5" />}
          onClick={handleClaimedClick}
          isSelected={activeFilter === 'Claimed' && !onlyWithHistory}
        />
        <SummaryMetricCard
          label="Pending"
          value={notClaimed}
          helper="Needs follow-up (click to filter)"
          variant="amber"
          icon={<HourglassIcon className="h-5 w-5" />}
          onClick={handlePendingClick}
          isSelected={activeFilter === 'Unclaimed' && !onlyWithHistory}
        />
        <SummaryMetricCard
          label="With History"
          value={withClaimHistory}
          helper="Previously assisted (click to filter)"
          variant="purple"
          icon={<HistoryIcon className="h-5 w-5" />}
          onClick={handleHistoryClick}
          isSelected={onlyWithHistory}
        />
      </div>
    </section>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function HourglassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 2h12M6 22h12M8 2v6a4 4 0 002 3.464L12 13l2-1.536A4 4 0 0016 8V2m0 20v-6a4 4 0 00-2-3.464L12 11l-2 1.536A4 4 0 008 16v6" />
    </svg>
  )
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8m9-4v8l4 2" />
    </svg>
  )
}

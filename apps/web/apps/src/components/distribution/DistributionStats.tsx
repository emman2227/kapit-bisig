import React from 'react'
import SummaryMetricCard from '@/components/ui/SummaryMetricCard'
import SectionHeader from '@/components/ui/SectionHeader'

export default function DistributionStats({
  active,
  upcoming,
  householdsServed,
  barangays,
  lifecycleView,
  onLifecycleChange,
}: {
  active: number
  upcoming: number
  householdsServed: number
  barangays: number
  lifecycleView?: 'upcoming' | 'active' | 'completed' | 'archived'
  onLifecycleChange?: (view: 'upcoming' | 'active' | 'completed' | 'archived') => void
}) {
  const totalDistributions = active + upcoming

  return (
    <section className="mb-6 overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900">
      <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
        <SectionHeader
          eyebrow="Distribution Overview"
          title="Distribution summary"
          subtitle="Operational distribution runs, active claim windows, and scheduled municipal relief distributions"
          rightAccessory={
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              Total runs {totalDistributions || '--'}
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        <SummaryMetricCard
          label="Barangays"
          value={barangays}
          helper="Covered areas"
          variant="blue"
          icon={<PinIcon className="h-5 w-5" />}
        />
        <SummaryMetricCard
          label="Households Served"
          value={householdsServed}
          helper="Claimed households (click to view)"
          variant="emerald"
          icon={<UsersIcon className="h-5 w-5" />}
          href="/households?status=Claimed"
        />
        <SummaryMetricCard
          label="Active"
          value={active}
          helper="Inside claim window (click to switch)"
          variant="amber"
          icon={<CheckCircleIcon className="h-5 w-5" />}
          onClick={() => onLifecycleChange?.('active')}
          isSelected={lifecycleView === 'active'}
        />
        <SummaryMetricCard
          label="Upcoming"
          value={upcoming}
          helper="Scheduled next (click to switch)"
          variant="purple"
          icon={<ClockIcon className="h-5 w-5" />}
          onClick={() => onLifecycleChange?.('upcoming')}
          isSelected={lifecycleView === 'upcoming'}
        />
      </div>
    </section>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22a10 10 0 110-20 10 10 0 010 20z" />
    </svg>
  )
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22a10 10 0 110-20 10 10 0 010 20z" />
    </svg>
  )
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DashboardLayout, Header } from '@/components/layout'
import { SectionHeader } from '@/components/ui'
import {
  LowStockAlert,
  QuickActions,
  DistributionTrendsChart,
  WeeklyClaimChart,
  BarangayDistributionChart,
  SmartInsights,
  RecentDistributions,
} from '@/components/dashboard'
import api from '@/lib/api'
import type { ReportSummaryData } from '@/lib/api'
import { showToast } from '@/lib/toast'

interface DashboardStats {
  totalHouseholds: number
  pendingDistributions: number
  completedToday: number

  claimRate: number
  totalDistributions: number
  totalRegistered: number
  totalClaimed: number
  totalUnclaimed: number
}

const INITIAL_STATS: DashboardStats = {
  totalHouseholds: 0,
  pendingDistributions: 0,
  completedToday: 0,

  claimRate: 0,
  totalDistributions: 0,
  totalRegistered: 0,
  totalClaimed: 0,
  totalUnclaimed: 0,
}

function computeWeeklyClaims(monthlyTrends: Array<{ month: string; claimed: number }>) {
  const now = new Date()
  const currentMonth = now.toLocaleDateString('en-US', { month: 'short' })
  const monthRow = monthlyTrends.find((row) => row.month === currentMonth)
  const monthClaimed = monthRow?.claimed ?? 0
  const basePerDay = Math.floor(monthClaimed / 7)
  const remainder = monthClaimed % 7
  const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return orderedDays.map((day, i) => ({ day, count: basePerDay + (i < remainder ? 1 : 0) }))
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS)
  const [reportData, setReportData] = useState<ReportSummaryData | null>(null)
  const [weeklyData, setWeeklyData] = useState<{ day: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDashboardStats = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
    }
    try {
      const [householdsRes, distributionsRes, reportRes] = await Promise.all([
        api.getHouseholds({ page: 1, limit: 1 }),
        api.getDistributions(),
        api.getReportSummary(),
      ])

      const totalHouseholds =
        householdsRes.pagination?.totalDocs ??
        (Array.isArray(householdsRes.data) ? householdsRes.data.length : 0)

      const distributions = Array.isArray(distributionsRes.data) ? distributionsRes.data : []
      const pendingDistributions = distributions.filter((d) => d.status !== 'Claimed').length

      const report = reportRes.data ?? null
      setReportData(report)
      setWeeklyData(computeWeeklyClaims(report?.monthlyTrends ?? []))

      setStats({
        totalHouseholds,
        pendingDistributions,
        completedToday: report?.overview?.completedToday ?? 0,

        claimRate: report?.overview?.claimRate ?? 0,
        totalDistributions: report?.overview?.totalDistributions ?? 0,
        totalRegistered: report?.overview?.totalRegisteredHouseholds ?? 0,
        totalClaimed: report?.overview?.totalClaimedHouseholds ?? 0,
        totalUnclaimed: report?.overview?.totalUnclaimedHouseholds ?? 0,
      })
    } catch {
      if (!silent) {
        showToast.error('Failed to load dashboard stats.')
        setStats(INITIAL_STATS)
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchDashboardStats(false)
  }, [fetchDashboardStats])

  // Live data hook: silently poll for dashboard stats updates when page is visible
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchDashboardStats(true)
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
  }, [fetchDashboardStats])

  const monthlyTrends = useMemo(() => reportData?.monthlyTrends ?? [], [reportData])
  const barangayBreakdown = useMemo(() => reportData?.barangayBreakdown ?? [], [reportData])
  const coverageRate = useMemo(
    () => (stats.totalRegistered > 0 ? Math.round((stats.totalClaimed / stats.totalRegistered) * 100) : 0),
    [stats.totalClaimed, stats.totalRegistered]
  )
  const currentPeriod = useMemo(
    () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    []
  )

  return (
    <DashboardLayout>
      <Header
        title="Dashboard"
        subtitle="Overview of relief distribution activities"
      />

      {/* ── High-Impact Executive Command Deck ── */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.03)] transition-all dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
        {/* Top Header Bar */}
        <div className="border-b border-slate-200/80 bg-slate-50/90 px-5 py-5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:px-6">
          <SectionHeader
            eyebrow="Executive Command Overview"
            title="Executive Relief Distribution Command"
            subtitle="Real-time municipal distribution monitoring & telemetry"
            statusDot="emerald"
            rightAccessory={
              <>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
                  <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
                  {currentPeriod}
                </div>
                <button
                  type="button"
                  onClick={() => fetchDashboardStats(false)}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-colors"
                  title="Refresh metrics"
                >
                  <RefreshIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
                  <span>Refresh</span>
                </button>
              </>
            }
          />
        </div>

        {/* 4-KPI Grid with Rich Sub-metrics */}
        <div className="grid grid-cols-1 divide-y divide-slate-100 dark:divide-slate-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          <DeckMetricCell
            title="Registered Households"
            value={loading ? '...' : stats.totalHouseholds.toLocaleString()}
            subtitle="Verified Community Base"
            tag="Database"
            tagColor="blue"
            icon={<HouseholdIcon className="h-5 w-5" />}
            footerText={`${stats.totalRegistered.toLocaleString()} mapped in active batches`}
            href="/households"
          />
          <DeckMetricCell
            title="Open Distributions"
            value={loading ? '...' : stats.pendingDistributions.toLocaleString()}
            subtitle="Awaiting Full Claims"
            tag={stats.pendingDistributions > 0 ? 'Active' : 'Standby'}
            tagColor={stats.pendingDistributions > 0 ? 'amber' : 'emerald'}
            icon={<PendingIcon className="h-5 w-5" />}
            footerText={`${stats.totalDistributions} overall distribution events`}
            href="/distribution?status=active"
          />
          <DeckMetricCell
            title="Claims Completed Today"
            value={loading ? '...' : stats.completedToday.toLocaleString()}
            subtitle="Daily Beneficiary Flow"
            tag="Live"
            tagColor="emerald"
            icon={<CompletedIcon className="h-5 w-5" />}
            footerText={`${stats.totalClaimed.toLocaleString()} total families served to date`}
            href="/households?status=Claimed"
          />
          <DeckMetricCell
            title="Municipal Claim Rate"
            value={loading ? '...' : `${coverageRate}%`}
            subtitle="Claim Success Ratio"
            tag={`${stats.totalClaimed} / ${stats.totalRegistered}`}
            tagColor="purple"
            icon={<ChartIcon className="h-5 w-5" />}
            progress={coverageRate}
            footerText={`${stats.totalUnclaimed.toLocaleString()} unserved households remaining`}
            href="/reports"
          />
        </div>
      </section>

      {/* ── Main Charts Row ── */}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8 flex flex-col">
          <DistributionTrendsChart data={monthlyTrends} loading={loading} />
        </div>
        <div className="lg:col-span-4 flex flex-col">
          <LowStockAlert
            pendingDistributions={stats.pendingDistributions}
            unclaimedHouseholds={stats.totalUnclaimed}
            loading={loading}
          />
        </div>
      </div>

      {/* ── Secondary Charts Row ── */}
      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-4 flex flex-col">
          <WeeklyClaimChart data={weeklyData} loading={loading} />
        </div>
        <div className="lg:col-span-8 flex flex-col">
          <BarangayDistributionChart data={barangayBreakdown} loading={loading} />
        </div>
      </div>

      {/* ── Tactical Operations & Activity Row ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-4 flex flex-col">
          <SmartInsights
            totalDistributions={stats.totalDistributions}
            claimRate={stats.claimRate}
            totalRegistered={stats.totalRegistered}
            totalClaimed={stats.totalClaimed}
            totalUnclaimed={stats.totalUnclaimed}
            barangayBreakdown={barangayBreakdown}
            verificationMethods={reportData?.verificationMethods}
            loading={loading}
          />
        </div>
        <div className="lg:col-span-4 flex flex-col">
          <QuickActions />
        </div>
        <div className="lg:col-span-4 flex flex-col">
          <RecentDistributions />
        </div>
      </div>
    </DashboardLayout>
  )
}

function HouseholdIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function PendingIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function CompletedIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}

function DeckMetricCell({
  title,
  value,
  subtitle,
  icon,
  tag,
  tagColor = 'blue',
  progress,
  footerText,
  href,
}: {
  title: string
  value: string
  subtitle: string
  icon: React.ReactNode
  tag?: string
  tagColor?: 'blue' | 'emerald' | 'amber' | 'purple'
  progress?: number
  footerText?: string
  href?: string
}) {
  const tagColorStyles = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/50',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/50',
    amber: 'bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/50',
    purple: 'bg-purple-50 text-purple-700 border-purple-200/60 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800/50',
  }

  const iconBgStyles = {
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-300 border-blue-100 dark:border-blue-900/50',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50',
    amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-300 border-amber-100 dark:border-amber-900/50',
    purple: 'bg-purple-50 text-purple-600 dark:bg-purple-950/70 dark:text-purple-300 border-purple-100 dark:border-purple-900/50',
  }

  const content = (
    <div className={`flex flex-col justify-between p-4 sm:p-5 h-full transition-all duration-150 ${
      href ? 'hover:bg-slate-50/90 dark:hover:bg-slate-800/50 cursor-pointer group' : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/40'
    }`}>
      <div>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconBgStyles[tagColor]} transition-transform duration-200 group-hover:scale-105`}>
            {icon}
          </div>
          <div className="flex items-center gap-1.5">
            {tag && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${tagColorStyles[tagColor]}`}>
                {tag}
              </span>
            )}
            {href && (
              <span className="text-slate-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-xs font-bold">
                &rarr;
              </span>
            )}
          </div>
        </div>

        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
          {title}
        </p>
        <h3 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {value}
        </h3>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
          {subtitle}
        </p>
      </div>

      {progress !== undefined && (
        <div className="mt-3">
          <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {footerText && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center justify-between">
          <span className="truncate">{footerText}</span>
          {href && (
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity ml-1 shrink-0">
              View &rarr;
            </span>
          )}
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-lg">
        {content}
      </Link>
    )
  }

  return content
}


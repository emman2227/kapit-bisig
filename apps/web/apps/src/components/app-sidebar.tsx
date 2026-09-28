'use client'

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Users,
  UserCheck,
  ShieldCheck,
  UserPlus,
  House,
  ArrowLeftRight,
  ChartNoAxesCombined,
  FileText,
  Settings,
  LogOut,
  Activity,
  X,
} from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { showToast } from '@/lib/toast'
import { Sidebar, useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const mainNavItems = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, superadminOnly: false },
  { name: 'Manage Users', href: '/users', icon: Users, superadminOnly: true },
  { name: 'Resident Registration', href: '/resident-registration', icon: UserPlus, superadminOnly: false },
  { name: 'Verified Residents', href: '/verified-residents', icon: UserCheck, superadminOnly: false },
  { name: 'Code Generation', href: '/code-generation', icon: ShieldCheck, superadminOnly: true },
  { name: 'Relief Registry', href: '/households', icon: House, superadminOnly: false },
  { name: 'Distribution', href: '/distribution', icon: ArrowLeftRight, superadminOnly: false },
  { name: 'Target Beneficiaries', href: '/target-beneficiaries', icon: FileText, superadminOnly: false },
  { name: 'Reports', href: '/reports', icon: ChartNoAxesCombined, superadminOnly: false },
  { name: 'Audit Logs', href: '/audit-logs', icon: Activity, superadminOnly: true },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { logout, isSuperadmin } = useAuth()
  const { open, toggleSidebar, mobileOpen, setMobileOpen } = useSidebar()
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
      showToast.info('Signing out...')
      await new Promise((r) => setTimeout(r, 400))
      showToast.success('Logged out successfully.')
      router.replace('/login')
    } catch {
      showToast.error('Logout failed. Please try again.')
      setLoggingOut(false)
    }
  }

  // On mobile drawer, content is always expanded
  const isExpanded = open || mobileOpen

  return (
    <Sidebar className="bg-white border-r border-slate-200 dark:border-slate-800 dark:bg-slate-900 z-50 transition-colors">
      {/* Desktop expand/collapse trigger button */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        title={open ? 'Collapse sidebar' : 'Expand sidebar'}
        className="hidden md:inline-flex absolute right-0 top-6 z-50 h-6 w-6 translate-x-[50%] cursor-pointer items-center justify-center rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
      >
        {open ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {/* Sidebar Header */}
      <div className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4">
        <div className="flex items-center">
          <span className="flex w-8 shrink-0 items-center justify-center">
            <Image
              src="/images/Logo1.png"
              alt="Kapit Bisig Logo"
              width={30}
              height={30}
              priority
              className="object-contain drop-shadow-sm"
              style={{ width: 'auto', height: 'auto' }}
            />
          </span>
          <span
            aria-hidden={!isExpanded}
            className={cn(
              'overflow-hidden whitespace-nowrap text-[16px] font-extrabold tracking-tight text-[#004A1C] dark:text-white transition-all duration-300',
              isExpanded ? 'max-w-[160px] opacity-100 translate-x-0 ml-3' : 'max-w-0 opacity-0 -translate-x-4 ml-0'
            )}
          >
            Kapit Bisig
          </span>
        </div>

        {/* Mobile close (X) button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="md:hidden inline-flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
          aria-label="Close navigation menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex-1 space-y-6 px-3 py-4 overflow-y-auto overflow-x-hidden">
        <div>
          <h3 className={cn("mb-2 px-2 text-[10px] font-bold tracking-widest text-[#004A1C]/50 dark:text-gray-400 uppercase transition-all duration-300", isExpanded ? "opacity-100" : "opacity-0 h-0 overflow-hidden mb-0")}>
            Main Menu
          </h3>
          <div className="space-y-1">
            {mainNavItems
              .filter((item) => !item.superadminOnly)
              .map((item) => (
                <NavItem
                  key={item.name}
                  href={item.href}
                  icon={item.icon}
                  isActive={pathname === item.href}
                  isOpen={isExpanded}
                  onClick={() => setMobileOpen(false)}
                >
                  {item.name}
                </NavItem>
              ))}
          </div>
        </div>

        {isSuperadmin && (
          <div>
            <h3 className={cn("mb-2 px-2 text-[10px] font-bold tracking-widest text-[#004A1C]/50 dark:text-gray-400 uppercase transition-all duration-300", isExpanded ? "opacity-100" : "opacity-0 h-0 overflow-hidden mb-0")}>
              Administration
            </h3>
            <div className="space-y-1">
              {mainNavItems
                .filter((item) => item.superadminOnly)
                .map((item) => (
                  <NavItem
                    key={item.name}
                    href={item.href}
                    icon={item.icon}
                    isActive={pathname === item.href}
                    isOpen={isExpanded}
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.name}
                  </NavItem>
                ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer Area */}
      <div className="relative z-10 space-y-1 border-t border-slate-100 dark:border-slate-800 px-2 py-3 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
        <NavItem
          href="/settings"
          icon={Settings}
          isActive={pathname === '/settings'}
          isOpen={isExpanded}
          onClick={() => setMobileOpen(false)}
        >
          Settings
        </NavItem>

        <button
          onClick={() => {
            setMobileOpen(false)
            setShowLogoutModal(true)
          }}
          title={!isExpanded ? 'Logout' : undefined}
          className="w-full group relative flex items-center rounded-xl py-2 pr-2 text-slate-500 dark:text-slate-400 transition-all duration-300 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 overflow-hidden border-l-[3px] border-transparent hover:border-red-500"
        >
          <span className="flex w-12 shrink-0 items-center justify-center transition-transform duration-300 ease-out group-hover:scale-110">
            <LogOut className="h-4 w-4" />
          </span>
          <span
            aria-hidden={!isExpanded}
            className={cn(
              'overflow-hidden whitespace-nowrap text-xs transition-[max-width,opacity,transform] duration-200',
              isExpanded ? 'max-w-[220px] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-2'
            )}
          >
            Logout
          </span>
        </button>
      </div>

      {showLogoutModal &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
              onClick={() => !loggingOut && setShowLogoutModal(false)}
            />
            <div className="relative mx-4 w-full max-w-sm rounded-[24px] bg-white dark:bg-slate-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800">
              <div className="mb-4 flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/10 text-red-500 shadow-inner">
                  <LogOut className="h-7 w-7" />
                </div>
              </div>
              <h3 className="text-center text-xl font-bold text-slate-900 dark:text-white tracking-tight">Confirm Logout</h3>
              <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Are you sure you want to log out? You will need to sign in again to access the system.
              </p>
              <div className="mt-8 flex gap-3">
                <button
                  onClick={() => setShowLogoutModal(false)}
                  disabled={loggingOut}
                  className="flex-1 rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 transition-all hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition-all hover:bg-red-600 hover:shadow-lg hover:shadow-red-600/30 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {loggingOut ? 'Logging out...' : 'Logout'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </Sidebar>
  )
}

function NavItem({
  href,
  icon: Icon,
  isActive,
  isOpen,
  onClick,
  children,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  isActive: boolean
  isOpen: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={!isOpen ? String(children) : undefined}
      className={cn(
        'group relative flex items-center rounded-xl py-2.5 pr-2 mb-1 transition-all duration-300 ease-out overflow-hidden',
        isActive 
          ? 'bg-slate-100 dark:bg-slate-800 font-semibold text-[#004A1C] dark:text-[#ECC323]'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-[#004A1C] dark:hover:text-[#ECC323]'
      )}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 h-3/4 w-[4px] -translate-y-1/2 rounded-full bg-[#ECC323] shadow-sm" />
      )}
      <span className="relative z-10 flex w-12 shrink-0 items-center justify-center transition-all duration-300 ease-in-out group-hover:scale-110 group-hover:text-[#ECC323]">
        <Icon className="h-4 w-4" />
      </span>
      <span
        aria-hidden={!isOpen}
        className={cn(
          'relative z-10 overflow-hidden whitespace-nowrap text-[13px] transition-[max-width,opacity,transform] duration-200',
          isOpen ? 'max-w-[220px] opacity-100 translate-x-0' : 'max-w-0 opacity-0 -translate-x-2'
        )}
      >
        {children}
      </span>
    </Link>
  )
}

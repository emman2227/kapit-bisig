'use client'

import React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import SelectDropdown from './SelectDropdown'

export interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems?: number
  pageSize?: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  itemLabel?: string
  showFirstLast?: boolean
  showPageNumbers?: boolean
  variant?: 'default' | 'embedded' | 'modal'
  className?: string
}

export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize = 10,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 20, 50, 100],
  itemLabel = 'results',
  showFirstLast = true,
  showPageNumbers = true,
  variant = 'default',
  className,
}: PaginationProps) {
  // Safe bounded calculations
  const safeTotalPages = Math.max(1, totalPages || 1)
  const safeCurrentPage = Math.min(Math.max(1, currentPage || 1), safeTotalPages)

  const startItem = totalItems !== undefined && totalItems > 0
    ? (safeCurrentPage - 1) * pageSize + 1
    : 0
  const endItem = totalItems !== undefined
    ? Math.min(totalItems, safeCurrentPage * pageSize)
    : 0

  // Generate numbered pages with smart sliding window and ellipsis
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (safeTotalPages <= 7) {
      for (let i = 1; i <= safeTotalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (safeCurrentPage > 3) {
        pages.push('ellipsis-start')
      }

      const start = Math.max(2, safeCurrentPage - 1)
      const end = Math.min(safeTotalPages - 1, safeCurrentPage + 1)

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i)
      }

      if (safeCurrentPage < safeTotalPages - 2) {
        pages.push('ellipsis-end')
      }
      if (!pages.includes(safeTotalPages)) {
        pages.push(safeTotalPages)
      }
    }
    return pages
  }

  const containerClasses =
    variant === 'modal'
      ? 'flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-3'
      : 'flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6 py-3.5'

  return (
    <div className={cn(containerClasses, className)}>
      {/* Left side: Item count summary & optional page size */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium">
        {totalItems !== undefined ? (
          <span>
            Showing{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {totalItems === 0 ? 0 : startItem}
            </strong>{' '}
            to{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {endItem}
            </strong>{' '}
            of{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {totalItems}
            </strong>{' '}
            {itemLabel}
          </span>
        ) : (
          <span>
            Page{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {safeCurrentPage}
            </strong>{' '}
            of{' '}
            <strong className="font-semibold text-slate-800 dark:text-slate-200">
              {safeTotalPages}
            </strong>
          </span>
        )}

        {onPageSizeChange && (
          <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-700">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Rows:</span>
            <SelectDropdown
              value={String(pageSize)}
              options={pageSizeOptions.map((opt) => ({ value: String(opt), label: String(opt) }))}
              onChange={(val) => onPageSizeChange(Number(val))}
              ariaLabel="Rows per page"
              className="w-[72px]"
              buttonClassName="!h-8 !px-2.5 !py-1 !text-xs !font-semibold !rounded-lg !border-slate-200 dark:!border-slate-700 !bg-slate-50 dark:!bg-slate-800 text-slate-700 dark:text-slate-200 !shadow-none hover:bg-slate-100 dark:hover:bg-slate-700/80"
              menuClassName="!min-w-[76px] !w-auto !rounded-xl !p-1.5 !shadow-xl"
              optionClassName="!px-2 !py-1.5 !text-xs !rounded-lg !gap-1.5"
              direction="up"
              usePortal={true}
            />
          </div>
        )}
      </div>

      {/* Right side: Navigation buttons and page numbers */}
      <div className="flex items-center gap-1.5">
        {/* First page button */}
        {showFirstLast && (
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={safeCurrentPage <= 1}
            title="First Page"
            aria-label="First Page"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-xs"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}

        {/* Previous page button */}
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
          disabled={safeCurrentPage <= 1}
          aria-label="Previous Page"
          className="inline-flex items-center gap-1 h-8 px-2.5 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-xs"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        {/* Numbered page pills */}
        {showPageNumbers && (
          <div className="flex items-center gap-1 mx-0.5">
            {/* Mobile compact indicator */}
            <span className="sm:hidden px-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              {safeCurrentPage} / {safeTotalPages}
            </span>

            {/* Desktop / tablet sliding window page pills */}
            <div className="hidden sm:flex items-center gap-1">
              {getPageNumbers().map((p, idx) => {
                if (typeof p === 'string') {
                  return (
                    <span
                      key={`ellipsis-${idx}`}
                      className="px-1.5 text-xs text-slate-400 select-none"
                    >
                      …
                    </span>
                  )
                }

                const isCurrent = p === safeCurrentPage
                return (
                  <button
                    key={`page-${p}`}
                    type="button"
                    onClick={() => onPageChange(p)}
                    aria-current={isCurrent ? 'page' : undefined}
                    aria-label={`Page ${p}`}
                    className={cn(
                      'min-w-[32px] h-8 px-2 rounded-lg text-xs font-bold transition-all shadow-xs',
                      isCurrent
                        ? 'bg-emerald-600 text-white border border-emerald-600 shadow-sm'
                        : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Next page button */}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(safeTotalPages, safeCurrentPage + 1))}
          disabled={safeCurrentPage >= safeTotalPages}
          aria-label="Next Page"
          className="inline-flex items-center gap-1 h-8 px-2.5 sm:px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-xs"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {/* Last page button */}
        {showFirstLast && (
          <button
            type="button"
            onClick={() => onPageChange(safeTotalPages)}
            disabled={safeCurrentPage >= safeTotalPages}
            title="Last Page"
            aria-label="Last Page"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:pointer-events-none transition-colors shadow-xs"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

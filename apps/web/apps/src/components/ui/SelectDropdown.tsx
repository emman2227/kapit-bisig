'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SelectDropdownOption = {
  value: string
  label: string
}

type SelectDropdownProps = {
  id?: string
  value: string
  options: SelectDropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  buttonClassName?: string
  menuClassName?: string
  optionClassName?: string
  direction?: 'up' | 'down'
  usePortal?: boolean
}

const BASE_BUTTON_CLASS =
  'inline-flex h-11 w-full items-center justify-between rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 text-left text-sm shadow-[0_2px_10px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.2)] outline-none transition focus:ring-2 focus:ring-[#0F533A]/20 dark:focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-slate-700 disabled:text-gray-400 dark:disabled:text-gray-500'

const BASE_MENU_CLASS =
  'z-50 max-h-64 overflow-y-auto rounded-2xl border border-[#DCDCDC] dark:border-slate-600 bg-[#ECECEC] dark:bg-slate-700 p-2 shadow-[0_10px_30px_rgba(0,0,0,0.14)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.4)]'

const BASE_OPTION_CLASS =
  'w-full flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors'

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export default function SelectDropdown({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select option',
  ariaLabel,
  disabled = false,
  className,
  buttonClassName,
  menuClassName,
  optionClassName,
  direction = 'down',
  usePortal = false,
}: SelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const generatedId = useId()
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; minWidth?: number } | null>(null)

  const controlId = useMemo(
    () => id || `select-dropdown-${generatedId.replace(/:/g, '')}`,
    [id, generatedId]
  )
  const menuId = `${controlId}-menu`

  const selectedOption = options.find((opt) => opt.value === value)
  const selectedLabel = selectedOption?.label || placeholder
  const hasSelection = value.trim().length > 0

  useEffect(() => {
    if (!open) return

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      const inButton = buttonRef.current?.contains(target)
      const inMenu = menuRef.current?.contains(target)
      if (!inButton && !inMenu) setOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open || !usePortal) return

    const updateCoords = () => {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      if (direction === 'up') {
        setCoords({
          bottom: window.innerHeight - rect.top + 6,
          left: rect.left,
          minWidth: rect.width,
        })
      } else {
        setCoords({
          top: rect.bottom + 6,
          left: rect.left,
          minWidth: rect.width,
        })
      }
    }

    updateCoords()
    const handleClose = () => setOpen(false)
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)

    return () => {
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
    }
  }, [open, usePortal, direction])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const handleToggle = () => {
    if (!open && usePortal && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      if (direction === 'up') {
        setCoords({
          bottom: window.innerHeight - rect.top + 6,
          left: rect.left,
          minWidth: rect.width,
        })
      } else {
        setCoords({
          top: rect.bottom + 6,
          left: rect.left,
          minWidth: rect.width,
        })
      }
    }
    setOpen((prev) => !prev)
  }

  const positionClass = direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'

  const menuContent = open && (!usePortal || coords) ? (
    <div
      id={menuId}
      ref={menuRef}
      role="listbox"
      aria-labelledby={controlId}
      style={
        usePortal && coords
          ? {
              position: 'fixed',
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              minWidth: coords.minWidth,
              zIndex: 9999,
            }
          : undefined
      }
      className={cx(
        BASE_MENU_CLASS,
        usePortal ? undefined : cx('absolute left-0', positionClass),
        menuClassName
      )}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            onClick={() => {
              onChange(opt.value)
              setOpen(false)
            }}
            className={cx(
              BASE_OPTION_CLASS,
              isSelected ? 'bg-[#EAB308] text-gray-900 font-medium' : 'text-slate-700 dark:text-gray-200 hover:bg-white/70 dark:hover:bg-slate-600/70',
              optionClassName
            )}
          >
            <span className="w-5 flex items-center justify-center text-gray-900 shrink-0">
              {isSelected ? <CheckIcon /> : null}
            </span>
            <span className="truncate">{opt.label}</span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <div className={cx('relative', className)}>
      <button
        id={controlId}
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
        onClick={handleToggle}
        className={cx(BASE_BUTTON_CLASS, buttonClassName)}
      >
        <span className={cx('truncate', hasSelection ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400')}>
          {selectedLabel}
        </span>
        <ChevronDownIcon open={open} />
      </button>

      {usePortal && typeof document !== 'undefined'
        ? menuContent
          ? createPortal(menuContent, document.body)
          : null
        : menuContent}
    </div>
  )
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cx('h-4 w-4 text-gray-500 transition-transform shrink-0', open ? 'rotate-180' : '')}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  )
}

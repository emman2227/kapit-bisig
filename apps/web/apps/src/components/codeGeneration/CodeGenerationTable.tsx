'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { BARANGAY_OPTIONS, getScopedBarangays } from '@/lib/api'
import { showToast } from '@/lib/toast'
import { useAuth } from '@/lib/AuthContext'
import BatchHistory from './BatchHistory'
import CodeGenerationForm from './CodeGenerationForm'
import DownloadActions from './DownloadActions'
import GeneratedCodesTable from './GeneratedCodesTable'
import SecurityNotes from './SecurityNotes'
import { copyToClipboard, downloadCsv, downloadPdf } from './utils'
import type { BatchHistoryItem, CodeStatus, GeneratedCodeRow, NormalizedGenerationResult } from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || '/api'
const EXPIRY_DAYS = 30
const SWEETALERT_SCRIPT_ID = 'sweetalert2-cdn-script'

type RawCode = string | { code?: string; token?: string; barangay?: string; status?: string; expiresAt?: string; expiry?: string }

type GenerateApiResponse = {
  success?: boolean
  message?: string
  data?: {
    batchId?: string
    generatedBy?: string
    generatedAt?: string
    resolveTimeMs?: number
    codes?: RawCode[]
    tokens?: RawCode[]
    created?: RawCode[]
    failedCount?: number
    errors?: string[]
  }
  batchId?: string
  generatedBy?: string
  generatedAt?: string
  resolveTimeMs?: number
  codes?: RawCode[]
  tokens?: RawCode[]
  created?: RawCode[]
  failedCount?: number
  errors?: string[]
}

type SweetAlertOptions = {
  icon: 'success' | 'error' | 'warning' | 'info' | 'question'
  title: string
  text: string
  confirmButtonText?: string
  confirmButtonColor?: string
}

type SwalLike = {
  fire: (options: SweetAlertOptions) => Promise<unknown>
}

function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : undefined
}

async function loadSwal(): Promise<SwalLike | null> {
  if (typeof window === 'undefined') return null

  const maybeSwal = (window as Window & { Swal?: SwalLike }).Swal
  if (maybeSwal?.fire) return maybeSwal

  const existing = document.getElementById(SWEETALERT_SCRIPT_ID) as HTMLScriptElement | null
  if (existing) {
    await new Promise<void>((resolve) => {
      if ((window as Window & { Swal?: SwalLike }).Swal?.fire) {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => resolve(), { once: true })
    })
    return (window as Window & { Swal?: SwalLike }).Swal || null
  }

  const script = document.createElement('script')
  script.id = SWEETALERT_SCRIPT_ID
  script.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11'
  script.async = true
  document.body.appendChild(script)

  await new Promise<void>((resolve) => {
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => resolve(), { once: true })
  })

  return (window as Window & { Swal?: SwalLike }).Swal || null
}

async function showSuccessSweetAlert(text: string): Promise<void> {
  const swal = await loadSwal()
  if (!swal?.fire) {
    showToast.success(text)
    return
  }

  await swal.fire({
    icon: 'success',
    title: 'Codes Generated',
    text,
    confirmButtonText: 'OK',
    confirmButtonColor: '#047857',
  })
}

function toReadableDate(input: Date | string): string {
  const date = typeof input === 'string' ? new Date(input) : input
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeStatus(value: string | undefined): CodeStatus {
  const upper = (value || 'UNUSED').toUpperCase()
  if (upper === 'USED' || upper === 'EXPIRED' || upper === 'LOCKED') return upper
  return 'UNUSED'
}

function extractRows(rawCodes: RawCode[] | undefined, barangay: string, fallbackExpiry: string): GeneratedCodeRow[] {
  if (!rawCodes?.length) return []

  return rawCodes
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          code: entry,
          barangay,
          status: 'UNUSED' as const,
          expiry: fallbackExpiry,
        }
      }

      const codeValue = (entry.code || entry.token || '').trim()
      if (!codeValue) return null

      const expiry = entry.expiresAt || entry.expiry
      return {
        code: codeValue,
        barangay: entry.barangay || barangay,
        status: normalizeStatus(entry.status),
        expiry: expiry ? toReadableDate(expiry) : fallbackExpiry,
      }
    })
    .filter((item): item is GeneratedCodeRow => Boolean(item))
}

function normalizeGenerationResponse(
  response: GenerateApiResponse,
  barangay: string,
  defaultExpiry: string,
  quantity: number
): NormalizedGenerationResult {
  const payload = response.data || response
  const fullCodes = payload.codes || payload.tokens
  const partialCodes = payload.created
  const rows = extractRows(fullCodes || partialCodes, barangay, defaultExpiry)
  const failedCount = typeof payload.failedCount === 'number' ? payload.failedCount : Math.max(0, quantity - rows.length)

  return {
    batchId: payload.batchId || `batch-${Date.now()}`,
    rows,
    summary: {
      generatedCount: rows.length,
      failedCount,
      resolveTimeMs: payload.resolveTimeMs,
    },
    generatedBy: payload.generatedBy || 'Current User',
    date: toReadableDate(payload.generatedAt || new Date()),
    errors: payload.errors || response.errors || [],
  }
}

function filterRows(rows: GeneratedCodeRow[], search: string, statusFilter: 'ALL' | CodeStatus): GeneratedCodeRow[] {
  return rows.filter((row) => {
    const matchesSearch = !search || row.code.toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'ALL' || row.status === statusFilter
    return matchesSearch && matchesStatus
  })
}

const ACTIVE_BATCH_STORAGE_KEY = 'kapit_bisig_active_batch'

async function loadBatchHistoryFromApi(brgy?: string): Promise<BatchHistoryItem[]> {
  try {
    const url = brgy
      ? `${API_URL}/residents/codes/batches?barangay=${encodeURIComponent(brgy)}`
      : `${API_URL}/residents/codes/batches`
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return []
    const json = await response.json()
    if (json.success && Array.isArray(json.batches)) {
      return json.batches.map((b: any) => ({
        batchId: b.batchId,
        barangay: b.barangay,
        quantity: b.quantity,
        generatedBy: b.issuedBy || 'Admin',
        date: toReadableDate(b.date),
        rows: [],
        summary: {
          generatedCount: b.quantity,
          failedCount: 0,
          unused: b.summary?.unused,
          used: b.summary?.used,
          expired: b.summary?.expired,
        },
      }))
    }
  } catch {
    // Silently fall back to empty array
  }
  return []
}

export default function CodeGenerationTable() {
  const { user } = useAuth()
  const scopedBarangays = useMemo(
    () => getScopedBarangays(user?.role, user?.assignedBarangays),
    [user?.role, user?.assignedBarangays],
  )

  const [barangay, setBarangay] = useState('')
  const [quantity, setQuantity] = useState('10')
  const [isLoading, setIsLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [activeUnusedLabel, setActiveUnusedLabel] = useState('Select a barangay to view active unused codes')

  // Data states
  const [batchRows, setBatchRows] = useState<GeneratedCodeRow[]>([])
  const [registryRows, setRegistryRows] = useState<GeneratedCodeRow[]>([])
  const [summary, setSummary] = useState<{ generatedCount: number; failedCount: number; resolveTimeMs?: number } | null>(null)
  const [errorBanner, setErrorBanner] = useState('')
  const [history, setHistory] = useState<BatchHistoryItem[]>([])
  const [viewMode, setViewMode] = useState<'BATCH' | 'REGISTRY'>('BATCH')
  const [hasActiveBatch, setHasActiveBatch] = useState(false)
  const [activeBatchId, setActiveBatchId] = useState('')
  const [batchTitle, setBatchTitle] = useState('Generated Codes Batch')
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | CodeStatus>('ALL')

  const quantityNumber = Number(quantity)
  const quantityError = useMemo(() => {
    if (!quantity.trim()) return 'Quantity is required.'
    if (!Number.isInteger(quantityNumber)) return 'Quantity must be a whole number.'
    if (quantityNumber < 1 || quantityNumber > 100) return 'Quantity must be between 1 and 100.'
    return ''
  }, [quantity, quantityNumber])

  const expirationDate = useMemo(() => {
    const date = new Date(now)
    date.setDate(date.getDate() + EXPIRY_DAYS)
    return date
  }, [now])

  const expirationLabel = useMemo(() => toReadableDate(expirationDate), [expirationDate])
  const canSubmit = Boolean(barangay) && !quantityError && !isLoading

  // Active rows based on view mode
  const currentRows = viewMode === 'REGISTRY' ? registryRows : batchRows
  const filteredRows = useMemo(() => filterRows(currentRows, search, statusFilter), [currentRows, search, statusFilter])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [])

  // Sync statuses of batch tokens with live database records
  const syncBatchStatuses = useCallback(
    async (targetBatchId: string, existingRows: GeneratedCodeRow[]): Promise<GeneratedCodeRow[]> => {
      if (!targetBatchId || !existingRows.length) return existingRows

      try {
        const response = await fetch(`${API_URL}/residents/codes/batch/${encodeURIComponent(targetBatchId)}`, {
          credentials: 'include',
        })
        if (!response.ok) return existingRows
        const json = await response.json()
        if (json.success && Array.isArray(json.tokens)) {
          const prefixMap = new Map<string, { status: CodeStatus; expiry?: string }>()
          for (const t of json.tokens) {
            const prefix = (t.code || '').replace(/-/g, '').slice(0, 4).toUpperCase()
            if (prefix) {
              prefixMap.set(prefix, {
                status: normalizeStatus(t.status),
                expiry: t.expiry ? toReadableDate(t.expiry) : undefined,
              })
            }
          }

          const updatedRows = existingRows.map((row) => {
            const prefix = row.code.replace(/-/g, '').slice(0, 4).toUpperCase()
            const live = prefixMap.get(prefix)
            if (live) {
              return {
                ...row,
                status: live.status,
                expiry: live.expiry || row.expiry,
              }
            }
            return row
          })

          setBatchRows(updatedRows)

          const usedCount = updatedRows.filter((r) => r.status === 'USED').length
          const unusedCount = updatedRows.filter((r) => r.status === 'UNUSED').length
          const expiredCount = updatedRows.filter((r) => r.status === 'EXPIRED').length

          // Update session storage with refreshed statuses
          try {
            const cached = sessionStorage.getItem(ACTIVE_BATCH_STORAGE_KEY)
            if (cached) {
              const parsed = JSON.parse(cached)
              if (parsed.batchId === targetBatchId) {
                sessionStorage.setItem(
                  ACTIVE_BATCH_STORAGE_KEY,
                  JSON.stringify({
                    ...parsed,
                    rows: updatedRows,
                    summary: {
                      ...parsed.summary,
                      used: usedCount,
                      unused: unusedCount,
                      expired: expiredCount,
                    },
                  })
                )
              }
            }
          } catch {
            // Ignore
          }

          // Update in-memory history state
          setHistory((prev) =>
            prev.map((item) =>
              item.batchId === targetBatchId
                ? {
                    ...item,
                    rows: updatedRows,
                    summary: {
                      ...item.summary,
                      unused: unusedCount,
                      used: usedCount,
                      expired: expiredCount,
                    },
                  }
                : item
            )
          )

          return updatedRows
        }
      } catch {
        // Silently keep existing rows on network error
      }
      return existingRows
    },
    []
  )

  // Restore active batch from session storage on mount and sync with live database
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(ACTIVE_BATCH_STORAGE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed?.rows?.length) {
          setBatchRows(parsed.rows)
          setSummary(parsed.summary || null)
          if (parsed.barangay) setBarangay(parsed.barangay)
          setHasActiveBatch(true)
          setBatchTitle(parsed.batchId ? `Active Batch: ${parsed.batchId}` : 'Active Generated Batch')
          if (parsed.batchId) {
            setActiveBatchId(parsed.batchId)
            syncBatchStatuses(parsed.batchId, parsed.rows)
          }
        }
      }
    } catch {
      // Ignore session storage errors
    }
  }, [syncBatchStatuses])

  // Load batch history
  useEffect(() => {
    let mounted = true

    const run = async () => {
      const initial = await loadBatchHistoryFromApi(barangay)
      if (mounted) {
        setHistory(initial)
      }
    }

    run()
    return () => {
      mounted = false
    }
  }, [barangay])

  // Fetch real-time token stats when barangay changes
  const fetchStats = useCallback(async () => {
    if (!barangay) {
      setActiveUnusedLabel('Select a barangay to view active unused codes')
      return
    }

    try {
      const response = await fetch(`${API_URL}/residents/codes/stats?barangayId=${encodeURIComponent(barangay)}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Stats endpoint unavailable')
      }

      const json = await response.json()
      const activeUnused = typeof json?.activeUnused === 'number' ? json.activeUnused : null
      setActiveUnusedLabel(
        activeUnused === null
          ? 'Active unused codes: unavailable'
          : `Active unused codes in this barangay: ${activeUnused}`
      )
    } catch {
      setActiveUnusedLabel('Active unused codes: unavailable')
    }
  }, [barangay])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Fetch registry tokens when in REGISTRY mode
  const fetchRegistry = useCallback(async () => {
    if (!barangay) {
      setRegistryRows([])
      return
    }

    try {
      const statusParam = statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''
      const response = await fetch(
        `${API_URL}/residents/codes/list?barangay=${encodeURIComponent(barangay)}${statusParam}&limit=100`,
        { credentials: 'include' }
      )

      if (!response.ok) throw new Error('Registry endpoint failed')

      const json = await response.json()
      if (json.success && Array.isArray(json.tokens)) {
        const mapped: GeneratedCodeRow[] = json.tokens.map((t: any) => ({
          code: t.code,
          barangay: t.barangay,
          status: normalizeStatus(t.status),
          expiry: toReadableDate(t.expiry),
        }))
        setRegistryRows(mapped)
        setSummary({
          generatedCount: json.total || mapped.length,
          failedCount: 0,
        })
      }
    } catch {
      setErrorBanner('Failed to load token registry for this barangay.')
    }
  }, [barangay, statusFilter])

  useEffect(() => {
    if (viewMode === 'REGISTRY') {
      fetchRegistry()
    }
  }, [viewMode, fetchRegistry])

  // Manual refresh of live statuses
  const onRefresh = async () => {
    try {
      setIsRefreshing(true)
      if (viewMode === 'BATCH') {
        if (activeBatchId && batchRows.length > 0) {
          await syncBatchStatuses(activeBatchId, batchRows)
        }
        const updatedHistory = await loadBatchHistoryFromApi(barangay)
        setHistory(updatedHistory)
        await fetchStats()
      } else {
        await fetchRegistry()
        await fetchStats()
      }
      showToast.success('Statuses updated.')
    } catch {
      showToast.error('Failed to refresh statuses.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const submitGeneration = async () => {
    if (!canSubmit || isLoading) return

    try {
      setIsLoading(true)
      setErrorBanner('')
      const csrfToken = getCookie('XSRF-TOKEN')

      const response = await fetch(`${API_URL}/residents/codes/generate-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          barangay,
          quantity: quantityNumber,
        }),
      })

      const json = (await response.json()) as GenerateApiResponse
      const normalized = normalizeGenerationResponse(json, barangay, expirationLabel, quantityNumber)
      const successFlag = json.success

      if ((!response.ok || successFlag === false) && normalized.rows.length === 0) {
        setSummary({ generatedCount: 0, failedCount: quantityNumber })
        setErrorBanner(json.message || 'Failed to generate codes.')
        return
      }

      if ((!response.ok || successFlag === false) && normalized.rows.length > 0) {
        setErrorBanner(json.message || 'Request partially failed. Some codes were still created.')
      } else if (normalized.errors.length) {
        setErrorBanner(normalized.errors.join(', '))
      }

      setBatchRows(normalized.rows)
      setSummary(normalized.summary)
      setSearch('')
      setStatusFilter('ALL')
      setViewMode('BATCH')
      setHasActiveBatch(true)
      setActiveBatchId(normalized.batchId)
      setBatchTitle(`Batch: ${normalized.batchId}`)

      // Persist active batch in session storage so navigating away doesn't discard plain codes
      try {
        sessionStorage.setItem(
          ACTIVE_BATCH_STORAGE_KEY,
          JSON.stringify({
            batchId: normalized.batchId,
            barangay,
            rows: normalized.rows,
            summary: normalized.summary,
            date: normalized.date,
          })
        )
      } catch {
        // Ignore session storage errors
      }

      const historyItem: BatchHistoryItem = {
        batchId: normalized.batchId,
        barangay,
        quantity: quantityNumber,
        generatedBy: normalized.generatedBy,
        date: normalized.date,
        rows: normalized.rows,
        summary: {
          ...normalized.summary,
          unused: normalized.rows.length,
          used: 0,
          expired: 0,
        },
      }

      setHistory((prev) => [historyItem, ...prev.filter((h) => h.batchId !== normalized.batchId)])

      // Refresh live stats
      fetchStats()

      if (normalized.rows.length > 0) {
        await showSuccessSweetAlert(
          `${normalized.rows.length} code${normalized.rows.length > 1 ? 's' : ''} generated successfully.`
        )
      }

      if (normalized.summary.failedCount > 0 && normalized.rows.length === 0) {
        showToast.error('No codes were created.')
      }
    } catch {
      setErrorBanner('Failed to connect to the server.')
      setSummary({ generatedCount: 0, failedCount: quantityNumber })
    } finally {
      setIsLoading(false)
      setConfirmOpen(false)
    }
  }

  const onCopyRow = async (code: string) => {
    try {
      await copyToClipboard(code)
      showToast.success('Code copied to clipboard.')
    } catch {
      showToast.error('Unable to copy code.')
    }
  }

  const onCopyAll = async () => {
    if (!filteredRows.length) return

    try {
      const text = filteredRows.map((row) => row.code).join('\n')
      await copyToClipboard(text)
      showToast.success('All codes copied.')
    } catch {
      showToast.error('Unable to copy all codes.')
    }
  }

  const onDownloadCsv = () => {
    if (!filteredRows.length) return
    downloadCsv(filteredRows, `kapit-bisig-codes-${Date.now()}`)
  }

  const onDownloadPdf = () => {
    if (!filteredRows.length) return
    downloadPdf(filteredRows, `kapit-bisig-codes-${Date.now()}`, 'Kapit-Bisig Generated Codes')
  }

  const onViewBatch = async (batchId: string) => {
    const selected = history.find((item) => item.batchId === batchId)
    const existingRows = selected?.rows?.length ? selected.rows : []

    try {
      setIsLoading(true)
      const response = await fetch(`${API_URL}/residents/codes/batch/${encodeURIComponent(batchId)}`, {
        credentials: 'include',
      })
      const json = await response.json()
      if (json.success && Array.isArray(json.tokens)) {
        let finalRows: GeneratedCodeRow[] = []

        if (existingRows.length > 0) {
          // If we have plain unmasked codes from this session, merge live statuses into them
          const prefixMap = new Map<string, { status: CodeStatus; expiry?: string }>()
          for (const t of json.tokens) {
            const prefix = (t.code || '').replace(/-/g, '').slice(0, 4).toUpperCase()
            if (prefix) {
              prefixMap.set(prefix, {
                status: normalizeStatus(t.status),
                expiry: t.expiry ? toReadableDate(t.expiry) : undefined,
              })
            }
          }

          finalRows = existingRows.map((row) => {
            const prefix = row.code.replace(/-/g, '').slice(0, 4).toUpperCase()
            const live = prefixMap.get(prefix)
            if (live) {
              return {
                ...row,
                status: live.status,
                expiry: live.expiry || row.expiry,
              }
            }
            return row
          })
        } else {
          // Historical batch from server (masked codes)
          finalRows = json.tokens.map((t: any) => ({
            code: t.code,
            barangay: t.barangay,
            status: normalizeStatus(t.status),
            expiry: toReadableDate(t.expiry),
          }))
        }

        const usedCount = finalRows.filter((r) => r.status === 'USED').length
        const unusedCount = finalRows.filter((r) => r.status === 'UNUSED').length
        const expiredCount = finalRows.filter((r) => r.status === 'EXPIRED').length

        setBatchRows(finalRows)
        setSummary({
          generatedCount: finalRows.length,
          failedCount: 0,
        })
        if (selected?.barangay) setBarangay(selected.barangay)
        setActiveBatchId(batchId)
        setSearch('')
        setStatusFilter('ALL')
        setErrorBanner('')
        setViewMode('BATCH')
        setBatchTitle(`Batch: ${batchId}`)

        setHistory((prev) =>
          prev.map((item) =>
            item.batchId === batchId
              ? {
                  ...item,
                  rows: finalRows,
                  summary: {
                    ...item.summary,
                    unused: unusedCount,
                    used: usedCount,
                    expired: expiredCount,
                  },
                }
              : item
          )
        )
      }
    } catch {
      showToast.error('Failed to load batch records')
    } finally {
      setIsLoading(false)
    }
  }

  const onClearActiveBatch = () => {
    try {
      sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY)
    } catch {
      // Ignore
    }
    setBatchRows([])
    setSummary(null)
    setHasActiveBatch(false)
    setActiveBatchId('')
    setBatchTitle('Generated Codes Batch')
    showToast.success('Batch view cleared.')
  }

  return (
    <div className="space-y-6 lg:space-y-8 pb-12 w-full max-w-[1400px]">
      <CodeGenerationForm
        barangay={barangay}
        setBarangay={setBarangay}
        quantity={quantity}
        setQuantity={setQuantity}
        expirationLabel={expirationLabel}
        activeUnusedLabel={activeUnusedLabel}
        quantityError={quantityError}
        canSubmit={canSubmit}
        isLoading={isLoading}
        hasGeneratedBatch={batchRows.length > 0}
        onOpenConfirm={() => setConfirmOpen(true)}
        confirmOpen={confirmOpen}
        onCloseConfirm={() => setConfirmOpen(false)}
        onConfirmGenerate={submitGeneration}
        barangayOptions={scopedBarangays}
      />

      <GeneratedCodesTable
        rows={filteredRows}
        search={search}
        setSearch={setSearch}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        onCopyRow={onCopyRow}
        summary={summary}
        errorBanner={errorBanner}
        viewMode={viewMode}
        onSwitchMode={setViewMode}
        onClearActiveBatch={onClearActiveBatch}
        batchTitle={batchTitle}
        hasActiveBatch={hasActiveBatch}
        selectedBarangay={barangay}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        downloadActions={
          <DownloadActions
            disabled={!filteredRows.length}
            onDownloadCsv={onDownloadCsv}
            onDownloadPdf={onDownloadPdf}
            onCopyAll={onCopyAll}
          />
        }
      />

      <BatchHistory history={history} onView={onViewBatch} />

      <SecurityNotes />
    </div>
  )
}





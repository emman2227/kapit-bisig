import { useEffect, useSyncExternalStore } from 'react';
import {
  fetchResidentDistributions,
  filterVisibleResidentDistributions,
  getResidentSession,
  type ResidentDistributionItem,
} from '../api/ResidentQrService';
import {
  clearResidentDistributionOfflineCache,
  loadResidentDistributionOfflineCache,
  saveResidentDistributionOfflineCache,
} from './ResidentOfflineStore';

export const DISTRIBUTION_FRESH_MS = 60 * 1000;
export const DISTRIBUTION_OFFLINE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResidentDistributionState {
  residentId: string | null;
  items: ResidentDistributionItem[];
  fetchedAt: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  warning: string | null;
  retryAfterUntil: number | null;
}

type RefreshOptions = {
  force?: boolean;
  residentId?: string | null;
};

const listeners = new Set<() => void>();
let generation = 0;
let inFlight: Promise<void> | null = null;

function initialState(residentId: string | null = null): ResidentDistributionState {
  return {
    residentId,
    items: [],
    fetchedAt: null,
    isLoading: false,
    isRefreshing: false,
    error: null,
    warning: null,
    retryAfterUntil: null,
  };
}

let state = initialState();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function setState(update: Partial<ResidentDistributionState>): void {
  state = { ...state, ...update };
  emit();
}

function timestamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function ageWithin(value: string | null, maxAgeMs: number, now = Date.now()): boolean {
  const parsed = timestamp(value);
  return parsed !== null && now - parsed >= 0 && now - parsed <= maxAgeMs;
}

function lastUpdatedWarning(message: string, fetchedAt: string | null): string {
  const parsed = timestamp(fetchedAt);
  if (parsed === null) return message;
  const label = new Date(parsed).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${message} Showing schedules last updated ${label}.`;
}

function activateResident(residentId: string | null): void {
  if (state.residentId === residentId) return;
  const previousResidentId = state.residentId;
  generation += 1;
  inFlight = null;
  state = initialState(residentId);
  emit();
  if (previousResidentId) {
    clearResidentDistributionOfflineCache(previousResidentId).catch(() => undefined);
  }
}

export function clearResidentDistributionStore(): void {
  const previousResidentId = state.residentId;
  generation += 1;
  inFlight = null;
  state = initialState();
  emit();
  if (previousResidentId) {
    clearResidentDistributionOfflineCache(previousResidentId).catch(() => undefined);
  }
}

export function getResidentDistributionSnapshot(): ResidentDistributionState {
  return state;
}

export function subscribeResidentDistributionStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshResidentDistributions(options: RefreshOptions = {}): Promise<void> {
  const expectedResidentId = options.residentId || null;
  if (expectedResidentId) activateResident(expectedResidentId);
  if (inFlight) return inFlight;

  if (state.fetchedAt === null) {
    setState({ isLoading: true, error: null });
  } else if (options.force) {
    setState({ isRefreshing: true });
  }

  const refreshGeneration = generation;
  const refreshPromise = (async () => {
    const now = Date.now();
    const session = await getResidentSession();

    if (!session || (expectedResidentId && session.residentId !== expectedResidentId)) {
      if (refreshGeneration !== generation) return;
      setState({
        isLoading: false,
        isRefreshing: false,
        error: 'Please sign in again to load distributions.',
      });
      return;
    }

    if (state.residentId !== session.residentId) activateResident(session.residentId);
    const activeGeneration = generation;

    const cachedForResident = await loadResidentDistributionOfflineCache(session.residentId);
    if (activeGeneration !== generation || state.residentId !== session.residentId) return;
    const cachedFetchedAt = cachedForResident?.fetchedAt || null;
    if (
      state.fetchedAt === null &&
      Array.isArray(cachedForResident?.items) &&
      ageWithin(cachedFetchedAt, DISTRIBUTION_OFFLINE_FALLBACK_MS, now)
    ) {
      setState({
        items: filterVisibleResidentDistributions(cachedForResident.items, now),
        fetchedAt: cachedFetchedAt,
        isLoading: false,
        error: null,
      });
    }

    if (!ageWithin(state.fetchedAt, DISTRIBUTION_OFFLINE_FALLBACK_MS, now) && state.fetchedAt !== null) {
      setState({ items: [], fetchedAt: null, warning: null });
    }

    if (!options.force && ageWithin(state.fetchedAt, DISTRIBUTION_FRESH_MS, now)) return;

    if (state.retryAfterUntil && state.retryAfterUntil > now) {
      const seconds = Math.max(1, Math.ceil((state.retryAfterUntil - now) / 1000));
      const message = `The server asked us to wait ${seconds} seconds before refreshing.`;
      setState({
        isLoading: false,
        isRefreshing: false,
        warning: state.fetchedAt ? lastUpdatedWarning(message, state.fetchedAt) : message,
      });
      return;
    }

    const hasCachedData = state.fetchedAt !== null;
    setState({
      isLoading: !hasCachedData,
      isRefreshing: Boolean(options.force && hasCachedData),
      error: hasCachedData ? null : state.error,
    });

    const result = await fetchResidentDistributions(session.token);
    if (activeGeneration !== generation || state.residentId !== session.residentId) return;

    if (!result.success || !Array.isArray(result.data)) {
      const retryAfterUntil = result.retryAfterSeconds
        ? Date.now() + result.retryAfterSeconds * 1000
        : null;
      const message = result.message || 'Unable to refresh distributions.';
      setState({
        isLoading: false,
        isRefreshing: false,
        retryAfterUntil,
        error: hasCachedData ? null : message,
        warning: hasCachedData ? lastUpdatedWarning(message, state.fetchedAt) : null,
      });
      return;
    }

    const fetchedAt = timestamp(result.generatedAt)
      ? result.generatedAt as string
      : new Date().toISOString();
    const items = filterVisibleResidentDistributions(result.data);
    setState({
      items,
      fetchedAt,
      isLoading: false,
      isRefreshing: false,
      error: null,
      warning: null,
      retryAfterUntil: null,
    });
    await saveResidentDistributionOfflineCache(session.residentId, items, fetchedAt);
  })()
    .catch(() => {
      if (refreshGeneration !== generation) return;
      const message = 'Unable to refresh distributions.';
      setState({
        isLoading: false,
        isRefreshing: false,
        error: state.fetchedAt ? null : message,
        warning: state.fetchedAt ? lastUpdatedWarning(message, state.fetchedAt) : null,
      });
    })
    .finally(() => {
      if (inFlight === refreshPromise) inFlight = null;
    });

  inFlight = refreshPromise;
  return refreshPromise;
}

export function useResidentDistributionStore(
  enabled: boolean,
  residentId?: string | null,
): ResidentDistributionState & { refresh: (force?: boolean) => Promise<void> } {
  const snapshot = useSyncExternalStore(
    subscribeResidentDistributionStore,
    getResidentDistributionSnapshot,
    getResidentDistributionSnapshot,
  );

  useEffect(() => {
    if (!enabled || !residentId) return;
    activateResident(residentId);
    refreshResidentDistributions({ residentId }).catch(() => undefined);
  }, [enabled, residentId]);

  return {
    ...snapshot,
    refresh: (force = false) => refreshResidentDistributions({ force, residentId }),
  };
}

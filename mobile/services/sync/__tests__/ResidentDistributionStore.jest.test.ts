jest.mock('../../api/ResidentQrService', () => ({
  fetchResidentDistributions: jest.fn(),
  getResidentSession: jest.fn(),
  filterVisibleResidentDistributions: jest.fn((items: unknown[]) => items),
}));

jest.mock('../ResidentOfflineStore', () => ({
  clearResidentDistributionOfflineCache: jest.fn(async () => undefined),
  loadResidentDistributionOfflineCache: jest.fn(),
  saveResidentDistributionOfflineCache: jest.fn(async () => undefined),
}));

import {
  clearResidentDistributionStore,
  getResidentDistributionSnapshot,
  refreshResidentDistributions,
} from '../ResidentDistributionStore';

const api = jest.requireMock('../../api/ResidentQrService') as {
  fetchResidentDistributions: jest.Mock;
  getResidentSession: jest.Mock;
};
const offlineStore = jest.requireMock('../ResidentOfflineStore') as {
  clearResidentDistributionOfflineCache: jest.Mock;
  loadResidentDistributionOfflineCache: jest.Mock;
  saveResidentDistributionOfflineCache: jest.Mock;
};

const futureDistribution = {
  id: 'distribution-a',
  barangay: 'Bolo',
  scheduled: '2026-08-24T01:00:00.000Z',
  endsAt: '2026-08-24T10:00:00.000Z',
  lifecycleStatus: 'Upcoming',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => { resolve = resolver; });
  return { promise, resolve };
}

describe('ResidentDistributionStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearResidentDistributionStore();
    api.getResidentSession.mockResolvedValue({
      token: 'resident-token',
      residentId: 'resident-a',
    });
    offlineStore.loadResidentDistributionOfflineCache.mockResolvedValue(null);
  });

  it('coalesces concurrent loads and reuses data during the fresh window', async () => {
    const network = deferred<{
      success: boolean;
      data: typeof futureDistribution[];
      generatedAt: string;
    }>();
    api.fetchResidentDistributions.mockReturnValue(network.promise);

    const first = refreshResidentDistributions({ residentId: 'resident-a' });
    const second = refreshResidentDistributions({ residentId: 'resident-a' });
    expect(second).toBe(first);

    network.resolve({
      success: true,
      data: [futureDistribution],
      generatedAt: new Date().toISOString(),
    });
    await Promise.all([first, second]);

    await refreshResidentDistributions({ residentId: 'resident-a' });
    expect(api.fetchResidentDistributions).toHaveBeenCalledTimes(1);
    expect(getResidentDistributionSnapshot().items).toEqual([futureDistribution]);
  });

  it('shows a multi-day cached fallback within 7 days and preserves it when refresh fails', async () => {
    const fetchedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    offlineStore.loadResidentDistributionOfflineCache.mockResolvedValue({
      residentId: 'resident-a',
      items: [futureDistribution],
      fetchedAt,
    });
    api.fetchResidentDistributions.mockResolvedValue({
      success: false,
      message: 'Network unavailable.',
      failureKind: 'NETWORK',
    });

    await refreshResidentDistributions({ residentId: 'resident-a' });

    const snapshot = getResidentDistributionSnapshot();
    expect(snapshot.items).toEqual([futureDistribution]);
    expect(snapshot.error).toBeNull();
    expect(snapshot.warning).toContain('Network unavailable.');
    expect(snapshot.warning).toContain('last updated');
  });

  it('honors retryAfterSeconds without sending another forced request', async () => {
    const fetchedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    offlineStore.loadResidentDistributionOfflineCache.mockResolvedValue({
      residentId: 'resident-a',
      items: [futureDistribution],
      fetchedAt,
    });
    api.fetchResidentDistributions.mockResolvedValue({
      success: false,
      status: 429,
      code: 'RATE_LIMITED',
      failureKind: 'RATE_LIMIT',
      message: 'Please wait.',
      retryAfterSeconds: 90,
    });

    await refreshResidentDistributions({ residentId: 'resident-a' });
    await refreshResidentDistributions({ residentId: 'resident-a', force: true });

    expect(api.fetchResidentDistributions).toHaveBeenCalledTimes(1);
    expect(getResidentDistributionSnapshot().warning).toContain('wait');
  });

  it('does not expose a persisted fallback older than 7 days', async () => {
    offlineStore.loadResidentDistributionOfflineCache.mockResolvedValue({
      residentId: 'resident-a',
      items: [futureDistribution],
      fetchedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    api.fetchResidentDistributions.mockResolvedValue({
      success: false,
      message: 'Network unavailable.',
      failureKind: 'NETWORK',
    });

    await refreshResidentDistributions({ residentId: 'resident-a' });

    expect(getResidentDistributionSnapshot().items).toEqual([]);
    expect(getResidentDistributionSnapshot().error).toBe('Network unavailable.');
  });

  it('ignores an old response after logout clears the resident store', async () => {
    const network = deferred<{ success: boolean; data: typeof futureDistribution[] }>();
    api.fetchResidentDistributions.mockReturnValue(network.promise);

    const request = refreshResidentDistributions({ residentId: 'resident-a' });
    await Promise.resolve();
    await Promise.resolve();
    clearResidentDistributionStore();
    network.resolve({ success: true, data: [futureDistribution] });
    await request;

    expect(getResidentDistributionSnapshot()).toMatchObject({
      residentId: null,
      items: [],
      fetchedAt: null,
    });
  });
});

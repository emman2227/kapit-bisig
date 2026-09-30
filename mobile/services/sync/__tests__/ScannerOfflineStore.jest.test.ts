jest.mock('expo-file-system/legacy', () => {
  const files = new Map<string, string>();
  const directories = new Set<string>(['file:///documents/']);
  return {
    documentDirectory: 'file:///documents/',
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
    getInfoAsync: jest.fn(async (path: string) => ({ exists: files.has(path) || directories.has(path) })),
    makeDirectoryAsync: jest.fn(async (path: string) => { directories.add(path); }),
    readAsStringAsync: jest.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`Missing mock file: ${path}`);
      return files.get(path);
    }),
    writeAsStringAsync: jest.fn(async (path: string, value: string) => { files.set(path, value); }),
    readDirectoryAsync: jest.fn(async (dirPath: string) => {
      const results: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(dirPath)) {
          const relative = key.slice(dirPath.length);
          if (!relative.includes('/')) {
            results.push(relative);
          }
        }
      }
      return results;
    }),
    deleteAsync: jest.fn(async (path: string) => { files.delete(path); }),
    __seedFile: (path: string, value: string) => files.set(path, value),
    __reset: () => files.clear(),
  };
});

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }),
    __reset: () => values.clear(),
  };
});

import {
  saveDistributionRoster,
  loadDistributionRoster,
  isResidentClaimedLocally,
  addOfflineClaim,
  listOfflineClaims,
  saveScannerAssignments,
  loadScannerAssignments,
  listDownloadedRosters,
  type OfflineRosterData,
} from '../ScannerOfflineStore';

const fileSystem = jest.requireMock('expo-file-system/legacy') as {
  __reset: () => void;
};
const secureStore = jest.requireMock('expo-secure-store') as {
  __reset: () => void;
};

describe('ScannerOfflineStore', () => {
  beforeEach(() => {
    fileSystem.__reset();
    secureStore.__reset();
  });

  const sampleRoster: OfflineRosterData = {
    distributionId: 'dist-101',
    barangay: 'Poblacion',
    assignedBarangays: ['Poblacion'],
    requiresBeneficiaryApproval: false,
    totalCount: 2,
    claimedCount: 0,
    downloadedAt: new Date().toISOString(),
    roster: [
      {
        residentId: 'res-1',
        residentCode: 'PO-2026-000001',
        maskedName: 'Juan D.',
        barangay: 'Poblacion',
        qrVersion: 2,
        isApprovedBeneficiary: true,
        alreadyClaimed: false,
      },
      {
        residentId: 'res-2',
        residentCode: 'PO-2026-000002',
        maskedName: 'Maria S.',
        barangay: 'Poblacion',
        qrVersion: 2,
        isApprovedBeneficiary: true,
        alreadyClaimed: false,
      },
    ],
  };

  it('saves and loads distribution roster correctly', async () => {
    await saveDistributionRoster('staff-1', 'dist-101', sampleRoster);
    const loaded = await loadDistributionRoster('staff-1', 'dist-101');
    expect(loaded).not.toBeNull();
    expect(loaded?.distributionId).toBe('dist-101');
    expect(loaded?.roster.length).toBe(2);
  });

  it('saves and restores scanner assignments locally', async () => {
    const assignments = {
      active: [{ id: 'dist-101', barangay: 'Poblacion' }],
      nearestUpcoming: { id: 'dist-102', scheduled: '2026-10-01' },
    };

    await saveScannerAssignments('staff-1', assignments);
    const loaded = await loadScannerAssignments('staff-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.active).toHaveLength(1);
    expect(loaded?.active[0].id).toBe('dist-101');
    expect(loaded?.nearestUpcoming?.id).toBe('dist-102');
    expect(loaded?.cachedAt).toBeDefined();
  });

  it('enumerates all downloaded rosters for a staff member', async () => {
    await saveDistributionRoster('staff-1', 'dist-101', sampleRoster);
    await saveDistributionRoster('staff-1', 'dist-102', {
      ...sampleRoster,
      distributionId: 'dist-102',
      barangay: 'San Jose',
    });

    const rosters = await listDownloadedRosters('staff-1');
    expect(rosters).toHaveLength(2);
    const ids = rosters.map((r) => r.distributionId);
    expect(ids).toContain('dist-101');
    expect(ids).toContain('dist-102');
  });

  it('marks resident as claimed locally and prevents duplicates', async () => {
    await saveDistributionRoster('staff-1', 'dist-101', sampleRoster);
    expect(await isResidentClaimedLocally('staff-1', 'dist-101', 'res-1')).toBe(false);

    await addOfflineClaim('staff-1', 'dist-101', {
      clientGeneratedId: 'claim-client-1',
      distributionId: 'dist-101',
      residentId: 'res-1',
      residentCode: 'PO-2026-000001',
      scannedAt: new Date().toISOString(),
    });

    expect(await isResidentClaimedLocally('staff-1', 'dist-101', 'res-1')).toBe(true);
    const claims = await listOfflineClaims('staff-1', 'dist-101');
    expect(claims).toHaveLength(1);
    expect(claims[0].residentId).toBe('res-1');

    // Roster entry should also be updated
    const updatedRoster = await loadDistributionRoster('staff-1', 'dist-101');
    expect(updatedRoster?.roster[0].alreadyClaimed).toBe(true);
    expect(updatedRoster?.claimedCount).toBe(1);
  });
});

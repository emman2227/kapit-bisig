jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    __reset: () => store.clear(),
  };
});

import * as SecureStore from 'expo-secure-store';
import { hasCompletedOnboarding, setCompletedOnboarding } from '../OnboardingStorage';

describe('OnboardingStorage', () => {
  beforeEach(() => {
    (SecureStore as unknown as { __reset: () => void }).__reset();
    jest.clearAllMocks();
  });

  it('returns false by default when onboarding flag has not been saved', async () => {
    const completed = await hasCompletedOnboarding();
    expect(completed).toBe(false);
  });

  it('persists and returns true after marking onboarding as completed', async () => {
    await setCompletedOnboarding(true);
    const completed = await hasCompletedOnboarding();
    expect(completed).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('kapitbisighascompletedonboarding', 'true');
  });

  it('handles read errors gracefully without throwing', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('Storage unavailable'));
    const completed = await hasCompletedOnboarding();
    expect(completed).toBe(false);
  });
});

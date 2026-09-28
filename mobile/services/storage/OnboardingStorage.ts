import * as SecureStore from 'expo-secure-store';

const ONBOARDING_COMPLETED_KEY = 'kapitbisighascompletedonboarding';

/**
 * Check whether the user has previously completed or skipped onboarding.
 */
export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(ONBOARDING_COMPLETED_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark onboarding as completed so it is never displayed again on this device.
 */
export async function setCompletedOnboarding(completed = true): Promise<void> {
  try {
    await SecureStore.setItemAsync(ONBOARDING_COMPLETED_KEY, completed ? 'true' : 'false');
  } catch (error) {
    console.warn('[OnboardingStorage] Failed to save onboarding state:', error);
  }
}

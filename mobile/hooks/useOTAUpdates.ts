import { useEffect, useState, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import * as Updates from 'expo-updates';

export interface OTAUpdateState {
  isChecking: boolean;
  isUpdateAvailable: boolean;
  isUpdating: boolean;
  updateId: string | null;
  channel: string | null;
  error: string | null;
  checkAndApplyUpdate: (promptUser?: boolean) => Promise<boolean>;
}

export function useOTAUpdates(autoCheckOnMount: boolean = true): OTAUpdateState {
  const [isChecking, setIsChecking] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasCheckedRef = useRef(false);

  const checkAndApplyUpdate = useCallback(async (promptUser: boolean = false): Promise<boolean> => {
    // Updates are not active in development, simulators without release bundles, or Expo Go
    if (__DEV__ || !Updates.isEnabled) {
      return false;
    }

    try {
      setIsChecking(true);
      setError(null);

      const checkResult = await Updates.checkForUpdateAsync();

      if (checkResult.isAvailable) {
        setIsUpdateAvailable(true);
        setIsUpdating(true);

        // Download the new bundle
        await Updates.fetchUpdateAsync();
        setIsUpdating(false);

        if (promptUser) {
          Alert.alert(
            'Update Downloaded',
            'A new version of Kapit-Bisig has been downloaded. Restart the app now to apply the update?',
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Restart Now',
                onPress: async () => {
                  try {
                    await Updates.reloadAsync();
                  } catch (reloadErr) {
                    console.warn('[OTAUpdates] Error reloading app:', reloadErr);
                  }
                },
              },
            ]
          );
        }

        return true;
      }

      setIsUpdateAvailable(false);
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[OTAUpdates] Check failed:', message);
      setError(message);
      return false;
    } finally {
      setIsChecking(false);
      setIsUpdating(false);
    }
  }, []);

  useEffect(() => {
    if (autoCheckOnMount && !__DEV__ && Updates.isEnabled && !hasCheckedRef.current) {
      hasCheckedRef.current = true;
      // Delay on mount so initial app rendering and interactions are not disrupted
      const timer = setTimeout(() => {
        checkAndApplyUpdate(true).catch(() => {});
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [autoCheckOnMount, checkAndApplyUpdate]);

  return {
    isChecking,
    isUpdateAvailable,
    isUpdating,
    updateId: Updates.updateId ?? null,
    channel: Updates.channel ?? null,
    error,
    checkAndApplyUpdate,
  };
}

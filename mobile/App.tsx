import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, StyleSheet, Alert, Platform, AppState, type EventSubscription } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
const isExpoGo = Boolean(Constants.expoGoConfig);

// Lazy-load notifications only outside Expo Go to prevent SDK 56 startup crash
const Notifications = !isExpoGo ? require('expo-notifications') : null;

// Mock types for TypeScript compiler
type Notification = any;
type NotificationResponse = any;
type NotificationHandler = any;

// Safe wrapper functions to prevent crashes on Expo Go
function setNotificationHandler(handler: any) {
  if (Notifications) {
    Notifications.setNotificationHandler(handler);
  }
}

function addNotificationReceivedListener(listener: any) {
  if (Notifications) {
    return Notifications.addNotificationReceivedListener(listener);
  }
  return { remove: () => {} } as any;
}

function addNotificationResponseReceivedListener(listener: any) {
  if (Notifications) {
    return Notifications.addNotificationResponseReceivedListener(listener);
  }
  return { remove: () => {} } as any;
}

async function getPermissionsAsync() {
  if (Notifications) {
    return Notifications.getPermissionsAsync();
  }
  return { status: 'denied' } as any;
}

async function requestPermissionsAsync() {
  if (Notifications) {
    return Notifications.requestPermissionsAsync();
  }
  return { status: 'denied' } as any;
}

async function getExpoPushTokenAsync(projectId: string) {
  if (Notifications) {
    return Notifications.getExpoPushTokenAsync({ projectId });
  }
  return { data: '' } as any;
}

async function setNotificationChannelAsync(channelId: string, channel: any) {
  if (Notifications) {
    return Notifications.setNotificationChannelAsync(channelId, channel);  }
}

async function scheduleNotificationAsync(request: any) {
  if (Notifications) {
    return Notifications.scheduleNotificationAsync(request);
  }
}

const AndroidImportance = Notifications ? Notifications.AndroidImportance : {
  UNSPECIFIED: -1,
  NONE: 0,
  MIN: 1,
  LOW: 2,
  DEFAULT: 3,
  HIGH: 4,
  MAX: 5
};
import SplashScreen from './components/SplashScreen';
import HomeScreen from './components/ResidentHomeDashboardScreen';
import ProfileScreen from './components/ProfileScreen';
import ResidentProofRequestScreen from './components/ResidentProofRequestScreen';
import { registerBackgroundProofSync, unregisterBackgroundProofSync } from './services/sync/BackgroundSyncService';
import {
  refreshProofSyncSnapshot,
  startProofSyncCoordinator,
  syncCurrentResidentProofs,
} from './services/sync/ProofSyncCoordinator';
import { startClaimSyncCoordinator } from './services/sync/ClaimSyncCoordinator';
import { countTotalPendingClaims } from './services/sync/ScannerOfflineStore';
import {
  clearResidentOfflineCache,
  isOfflineCacheWithinGrace,
  listOfflineProofRecords,
  loadResidentOfflineCache,
  quarantineLegacyOwnerlessQueue,
  saveResidentOfflineCache,
  updateResidentOfflineCache,
} from './services/sync/ResidentOfflineStore';
import { shouldInvalidateVirtualId } from './services/sync/VirtualIdPolicy';
import {
  clearResidentDistributionStore,
  useResidentDistributionStore,
} from './services/sync/ResidentDistributionStore';
import ResidentRegistrationRevisionScreen from './components/ResidentRegistrationRevisionScreen';
import VolunteerDashboardScreen from './components/VolunteerDashboardScreen';
import QRReceiptScreen from './components/QRReceiptScreen';
import DistributionScreen from './components/DistributionScreen';
import VolunteerQRScannerScreen from './components/VolunteerQRScannerScreen';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { mobileAuthService, User as VolunteerUser } from './services/auth/MobileAuthService';
import {
  clearResidentSession,
  fetchResidentProfile,
  fetchResidentQr,
  getResidentSession,
  getResidentToken,
  ResidentProfile,
  ResidentQrData,
  saveResidentSession,
  registerResidentPushDevice,
  unregisterResidentPushDevice,
} from './services/api/ResidentQrService';
import { useOTAUpdates } from './hooks';

type Screen = 'home' | 'distributions' | 'qr' | 'profile' | 'proof-request' | 'registration-revision';
type AccountType = 'resident' | 'volunteer' | null;
type SplashInitialView = 'landing' | 'login';
const CONFIRMED_AUTH_FAILURE_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_REVOKED', 'INVALID_TOKEN']);

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown push notification error';
  }
}

function resolveExpoProjectId(): string | null {
  const envProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (envProjectId) {
    return envProjectId;
  }

  const easProjectId = Constants.easConfig?.projectId?.trim();
  if (easProjectId) {
    return easProjectId;
  }

  const extraProjectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId?.trim();

  return extraProjectId || null;
}

function maskPushToken(token: string): string {
  if (token.length <= 12) {
    return token;
  }

  return `${token.slice(0, 8)}...${token.slice(-4)}`;
}

async function scheduleEmulatorTestNotification() {
  await scheduleNotificationAsync({
    content: {
      title: 'Kapit-Bisig Notifications Ready',
      body: 'Emulator mode is using a local test notification. Remote push still requires a physical device.',
      data: { screen: 'home' },
    },
    trigger: null,
  });
}

async function scheduleExpoGoTestNotification() {
  await scheduleNotificationAsync({
    content: {
      title: 'Kapit-Bisig Notifications Ready',
      body: 'Expo Go supports local notifications here. Remote push requires a development build.',
      data: { screen: 'home' },
    },
    trigger: null,
  });
}

async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    await setNotificationChannelAsync('default', {
      name: 'default',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#16A34A',
    });
  } catch (error) {
    console.warn('Android notification channel setup skipped:', getErrorMessage(error));
  }
}

const notificationHandler: NotificationHandler = {
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
};

setNotificationHandler(notificationHandler);

export default function App() {
  useOTAUpdates();

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [showSplash, setShowSplash] = useState(true);
  const [splashInitialView, setSplashInitialView] = useState<SplashInitialView>('landing');
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [residentProfile, setResidentProfile] = useState<ResidentProfile | null>(null);
  const [residentVirtualId, setResidentVirtualId] = useState<ResidentQrData | null>(null);
  const [isVirtualIdLoading, setIsVirtualIdLoading] = useState(false);
  const [virtualIdError, setVirtualIdError] = useState<string | null>(null);
  const [virtualIdWarning, setVirtualIdWarning] = useState<string | null>(null);
  const [volunteerUser, setVolunteerUser] = useState<VolunteerUser | null>(null);
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const notificationReceivedListener = useRef<EventSubscription | null>(null);
  const notificationResponseListener = useRef<EventSubscription | null>(null);
  const pushTokenRef = useRef<string | null>(null);
  const residentVirtualIdRef = useRef<ResidentQrData | null>(null);
  const residentVirtualIdFetchedAtRef = useRef<string | null>(null);
  const virtualIdRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const virtualIdGenerationRef = useRef(0);
  const isResidentPending = accountType === 'resident'
    && (residentProfile?.status === 'Pending' || residentProfile?.status === 'Needs Revision');
  const residentDistributions = useResidentDistributionStore(
    accountType === 'resident' && residentProfile?.status === 'Approved',
    residentProfile?.id,
  );

  const setVirtualIdSnapshot = useCallback((data: ResidentQrData | null, fetchedAt: string | null) => {
    residentVirtualIdRef.current = data;
    residentVirtualIdFetchedAtRef.current = fetchedAt;
    setResidentVirtualId(data);
  }, []);

  const clearVirtualIdSnapshot = useCallback(async (residentId?: string) => {
    virtualIdGenerationRef.current += 1;
    virtualIdRefreshPromiseRef.current = null;
    setVirtualIdSnapshot(null, null);
    setIsVirtualIdLoading(false);
    setVirtualIdWarning(null);
    if (residentId) {
      await updateResidentOfflineCache(residentId, {
        virtualId: null,
        virtualIdFetchedAt: null,
      });
    }
  }, [setVirtualIdSnapshot]);

  const refreshResidentVirtualId = useCallback((_force = false): Promise<void> => {
    if (virtualIdRefreshPromiseRef.current) return virtualIdRefreshPromiseRef.current;
    const refreshGeneration = virtualIdGenerationRef.current;

    const refreshPromise = (async () => {
      const [session, cache] = await Promise.all([
        getResidentSession(),
        loadResidentOfflineCache(),
      ]);
      if (!session) {
        setVirtualIdSnapshot(null, null);
        setVirtualIdError('Please sign in again to load your virtual ID.');
        return;
      }

      const cachedForResident = cache?.residentId === session.residentId ? cache : null;
      const cachedId = cachedForResident?.virtualId?.residentId === session.residentId
        ? cachedForResident.virtualId
        : null;
      const cachedFetchedAt = cachedId ? cachedForResident?.virtualIdFetchedAt || null : null;
      const currentId = residentVirtualIdRef.current?.residentId === session.residentId
        ? residentVirtualIdRef.current
        : cachedId;
      const currentFetchedAt = residentVirtualIdRef.current?.residentId === session.residentId
        ? residentVirtualIdFetchedAtRef.current
        : cachedFetchedAt;

      if (currentId !== residentVirtualIdRef.current || currentFetchedAt !== residentVirtualIdFetchedAtRef.current) {
        setVirtualIdSnapshot(currentId, currentFetchedAt);
      }

      // A saved ID stays on screen while launch/resume performs a silent check.
      // Only residents without a saved ID should ever see the initial loader.
      setIsVirtualIdLoading(!currentId);
      setVirtualIdError(null);
      setVirtualIdWarning(null);

      const result = await fetchResidentQr(session.token);
      if (refreshGeneration !== virtualIdGenerationRef.current) return;
      if (result.success && result.data) {
        const fetchedAt = new Date().toISOString();
        setVirtualIdSnapshot(result.data, fetchedAt);
        setVirtualIdError(null);
        setVirtualIdWarning(null);
        await updateResidentOfflineCache(session.residentId, {
          virtualId: result.data,
          virtualIdFetchedAt: fetchedAt,
        });
        return;
      }

      const invalidatesId = shouldInvalidateVirtualId(result.status, result.code);
      if (invalidatesId) {
        await clearVirtualIdSnapshot(session.residentId);
        setVirtualIdError(result.message || 'Your virtual ID is currently unavailable.');
        return;
      }

      const message = result.message || 'Unable to refresh your virtual ID.';
      if (currentId) {
        setVirtualIdWarning(message);
      } else {
        setVirtualIdError(message);
      }
    })()
      .catch(() => {
        if (residentVirtualIdRef.current) {
          setVirtualIdWarning('Unable to refresh your virtual ID.');
        } else {
          setVirtualIdError('Unable to load your virtual ID.');
        }
      })
      .finally(() => {
        if (virtualIdRefreshPromiseRef.current === refreshPromise) {
          setIsVirtualIdLoading(false);
          virtualIdRefreshPromiseRef.current = null;
        }
      });

    virtualIdRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [clearVirtualIdSnapshot, setVirtualIdSnapshot]);

  const loadResidentProfile = async (preserveSessionOnFailure = false): Promise<boolean> => {
    try {
      const [token, session, cache] = await Promise.all([
        getResidentToken(),
        getResidentSession(),
        loadResidentOfflineCache(),
      ]);
      if (!token || !session) {
        clearResidentDistributionStore();
        setResidentProfile(null);
        await clearVirtualIdSnapshot();
        return false;
      }

      const residentCache = cache?.residentId === session.residentId ? cache : null;
      const usableCache = residentCache && isOfflineCacheWithinGrace(residentCache)
        ? residentCache
        : null;

      if (usableCache) {
        setResidentProfile(usableCache.profile);
        if (usableCache.virtualId?.residentId === session.residentId) {
          setVirtualIdSnapshot(usableCache.virtualId, usableCache.virtualIdFetchedAt || null);
        } else {
          if (usableCache.profile.status !== 'Approved') virtualIdGenerationRef.current += 1;
          setVirtualIdSnapshot(null, null);
          setIsVirtualIdLoading(usableCache.profile.status === 'Approved');
        }
        setAccountType('resident');
      }

      const response = await fetchResidentProfile(token);
      if (!response.success || !response.data) {
        if (response.failureKind === 'AUTH' && response.code === 'TOKEN_EXPIRED' && usableCache) {
          // The server token may expire before the seven-day offline account cache.
          // Keep read/draft access, while proof syncing will request reauthentication.
          return true;
        }

        if (response.failureKind === 'AUTH' && response.code && CONFIRMED_AUTH_FAILURE_CODES.has(response.code)) {
          await clearResidentSession();
          await clearResidentOfflineCache();
          clearResidentDistributionStore();
          setResidentProfile(null);
          await clearVirtualIdSnapshot();
          setAccountType(null);
          return false;
        }

        // Network and server failures must not destroy a recently validated offline session.
        return Boolean(usableCache || (preserveSessionOnFailure && residentProfile));
      }

      const nextSession = {
        ...session,
        residentId: response.data.id,
        residentCode: response.data.residentCode,
        fullName: response.data.fullName,
        mobileNumber: response.data.mobileNumber,
        barangay: response.data.barangay,
        status: response.data.status,
      };
      const canUseVirtualId = response.data.status === 'Approved';
      if (!canUseVirtualId) virtualIdGenerationRef.current += 1;
      const liveVirtualId = residentVirtualIdRef.current?.residentId === response.data.id
        ? residentVirtualIdRef.current
        : null;
      const preservedVirtualId = canUseVirtualId
        ? liveVirtualId || (
          residentCache?.virtualId?.residentId === response.data.id
            ? residentCache.virtualId
            : null
        )
        : null;
      const preservedVirtualIdFetchedAt = preservedVirtualId
        ? (liveVirtualId ? residentVirtualIdFetchedAtRef.current : residentCache?.virtualIdFetchedAt) || null
        : null;
      await saveResidentSession(nextSession);
      await saveResidentOfflineCache({
        residentId: response.data.id,
        session: nextSession,
        profile: response.data,
        virtualId: preservedVirtualId,
        virtualIdFetchedAt: preservedVirtualIdFetchedAt,
        activeEvent: usableCache?.activeEvent ?? null,
        activeEventFetchedAt: usableCache?.activeEventFetchedAt ?? null,
        proofStatus: usableCache?.proofStatus ?? null,
        lastOnlineValidatedAt: new Date().toISOString(),
      });
      setResidentProfile(response.data);
      setVirtualIdSnapshot(preservedVirtualId, preservedVirtualIdFetchedAt);
      setIsVirtualIdLoading(canUseVirtualId && !preservedVirtualId);
      setVirtualIdError(null);
      setVirtualIdWarning(null);
      setAccountType('resident');
      return true;
    } catch {
      return false;
    }
  };

  const handleGetStarted = () => {
    setSplashInitialView('landing');
    setShowSplash(false);
  };

  const handleVolunteerLoginSuccess = (user: VolunteerUser) => {
    // Ensure volunteer login is the only active session type.
    clearResidentSession().catch(() => undefined);
    clearResidentOfflineCache().catch(() => undefined);
    clearResidentDistributionStore();
    setVolunteerUser(user);
    setResidentProfile(null);
    clearVirtualIdSnapshot().catch(() => undefined);
    setVirtualIdError(null);
    setVirtualIdWarning(null);
    setAccountType('volunteer');
    setCurrentScreen('home');
    setSplashInitialView('landing');
    setShowSplash(false);
  };

  const handleLogout = () => {
    getResidentSession().then(async (session) => {
      if (!session) return;
      const queue = await listOfflineProofRecords(session.residentId);
      if (queue.length > 0) {
        Alert.alert(
          'Saved proofs kept on this device',
          `${queue.length} unsynced proof request${queue.length === 1 ? '' : 's'} will be hidden and will only sync after this resident signs in again.`,
        );
      }
    }).catch(() => undefined);
    if (accountType === 'volunteer') {
      const user = volunteerUser || mobileAuthService.getCurrentUser();
      if (user?.id) {
        countTotalPendingClaims(user.id).then((pending) => {
          if (pending > 0) {
            Alert.alert(
              'Unsynced Claims',
              `You have ${pending} recorded offline claim(s) that have not synced yet. They will remain saved and sync when an assigned account reconnects.`,
            );
          }
        }).catch(() => undefined);
      }
      mobileAuthService.logout().catch(() => undefined);
      setVolunteerUser(null);
    }
    if (accountType === 'resident' && pushTokenRef.current) {
      const deviceToken = pushTokenRef.current;
      getResidentToken()
        .then((residentToken) => residentToken ? unregisterResidentPushDevice(residentToken, deviceToken) : undefined)
        .catch(() => undefined);
      pushTokenRef.current = null;
    }

    clearResidentSession().catch(() => undefined);
    clearResidentOfflineCache().catch(() => undefined);
    clearResidentDistributionStore();

    setResidentProfile(null);
    clearVirtualIdSnapshot().catch(() => undefined);
    setVirtualIdError(null);
    setVirtualIdWarning(null);
    setAccountType(null);
    setSplashInitialView('login');
    setShowSplash(true);
    setCurrentScreen('home');

    // Unregister background sync on logout
    unregisterBackgroundProofSync().catch(() => undefined);
  };

  const handleNavigate = (screen: Screen) => {
    if (isResidentPending && (screen === 'qr' || screen === 'distributions')) {
      Alert.alert(
        residentProfile?.status === 'Needs Revision' ? 'Needs Revision' : 'Pending Approval',
        residentProfile?.status === 'Needs Revision'
          ? 'Distribution and QR access are disabled while your registration needs corrections from admin review.'
          : 'Distribution and QR access are disabled while your account is pending admin review.',
      );
      return;
    }
    setCurrentScreen(screen);
  };

  const handleResidentProfileUpdated = (profile: ResidentProfile) => {
    setResidentProfile(profile);
    getResidentSession()
      .then(async (session) => {
        if (!session) return;
        await updateResidentOfflineCache(session.residentId, { profile });
        if (profile.status === 'Approved') {
          await refreshResidentVirtualId(true);
        } else {
          await clearVirtualIdSnapshot(session.residentId);
        }
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    quarantineLegacyOwnerlessQueue().catch(() => undefined);
    const stopProofCoordinator = startProofSyncCoordinator();
    const stopClaimCoordinator = startClaimSyncCoordinator();
    Promise.all([getResidentSession(), loadResidentOfflineCache()])
      .then(([session, cache]) => {
        if (session && cache?.residentId === session.residentId && isOfflineCacheWithinGrace(cache)) {
          setShowSplash(false);
        }
      })
      .catch(() => undefined);
    return () => {
      stopProofCoordinator();
      stopClaimCoordinator();
    };
  }, []);

  useEffect(() => {
    if (!showSplash) {
      const initializeSession = async () => {
        setIsProfileLoading(true);

        try {
          const volunteerSessionActive = await mobileAuthService.initialize();
          if (volunteerSessionActive) {
            setVolunteerUser(mobileAuthService.getCurrentUser());
            setResidentProfile(null);
            setAccountType('volunteer');
            return;
          }

          const residentSessionActive = await loadResidentProfile();
          if (!residentSessionActive) {
            setShowSplash(true);
            setAccountType(null);
          }
        } finally {
          setIsProfileLoading(false);
        }
      };

      initializeSession().catch(() => undefined);

      // Register background proof sync after session is resolved
      registerBackgroundProofSync().catch(() => undefined);
      syncCurrentResidentProofs().catch(() => undefined);
    }
  }, [showSplash]);

  useEffect(() => {
    if (accountType === 'resident' && residentProfile?.status === 'Approved') {
      refreshResidentVirtualId(false).catch(() => undefined);
    }
  }, [accountType, refreshResidentVirtualId, residentProfile?.status]);

  useEffect(() => {
    if (accountType !== 'resident') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        loadResidentProfile(true)
          .then(() => refreshResidentVirtualId(false))
          .catch(() => undefined);
        refreshProofSyncSnapshot()
          .then(() => syncCurrentResidentProofs())
          .catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [accountType, refreshResidentVirtualId]);

  useEffect(() => {
    const registerForPushNotificationsAsync = async () => {
      try {
        if (Platform.OS === 'web') {
          console.log('Push notifications are skipped on web.');
          return;
        }

        if (Platform.OS === 'android') {
          await ensureAndroidNotificationChannel();
        }

        const executionEnvironment = Constants.executionEnvironment;
        const { status: existingStatus } = await getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.warn('Push notification permission not granted.');
          return;
        }

        console.log('Push notification permission granted.');

        if (executionEnvironment === 'storeClient') {
          console.log('Running in Expo Go. Remote push token registration is disabled; local notifications remain available.');

          if (__DEV__) {
            await scheduleExpoGoTestNotification();
          }

          return;
        }

        if (!Device.isDevice) {
          console.log('Running on simulator/emulator. Remote push token registration is skipped, but local notifications remain enabled for testing.');

          if (__DEV__) {
            await scheduleEmulatorTestNotification();
          }

          return;
        }

        const projectId = resolveExpoProjectId();
        if (!projectId) {
          console.warn(
            'Push token registration skipped: missing Expo project ID. Set EXPO_PUBLIC_EAS_PROJECT_ID or configure eas.projectId.',
          );
          return;
        }

        const tokenResponse = await getExpoPushTokenAsync(projectId);
        const expoPushToken = String(tokenResponse?.data || '').trim();
        if (!expoPushToken) {
          console.warn('Expo did not return a remote push token.');
          return;
        }
        pushTokenRef.current = expoPushToken;
        console.log(`Push token ready: ${maskPushToken(expoPushToken)}`);

        if (accountType === 'resident') {
          const residentToken = await getResidentToken();
          if (residentToken) {
            const registration = await registerResidentPushDevice(
              residentToken,
              expoPushToken,
              Platform.OS === 'ios' ? 'ios' : 'android',
            );
            if (!registration.success) {
              console.warn(registration.message || 'Resident push-device registration failed.');
            }
          }
        }
      } catch (error) {
        console.error('Push registration error:', getErrorMessage(error), error);
      }    };

    registerForPushNotificationsAsync().catch(() => undefined);

    notificationReceivedListener.current = addNotificationReceivedListener((notification: Notification) => {
      console.log('Push notification received:', notification.request.identifier);
    });

    notificationResponseListener.current = addNotificationResponseReceivedListener((response: NotificationResponse) => {
      const data = (response.notification.request.content.data || {}) as { screen?: Screen };
      const targetScreen = data.screen;

      if (targetScreen === 'home' || targetScreen === 'distributions' || targetScreen === 'qr' || targetScreen === 'profile' || targetScreen === 'proof-request') {
        handleNavigate(targetScreen);
      } else {
        handleNavigate('home');
      }
    });

    return () => {
      notificationReceivedListener.current?.remove();
      notificationResponseListener.current?.remove();
    };
  }, [accountType, isResidentPending, residentProfile?.id]);

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#16A34A" />
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  if (showSplash) {
    return (
      <SafeAreaProvider>
        <SplashScreen
          onGetStarted={handleGetStarted}
          onVolunteerLogin={handleVolunteerLoginSuccess}
          initialView={splashInitialView}
        />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  if (isProfileLoading) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#16A34A" />
        </View>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'distributions':
        if (accountType === 'volunteer') {
          return (
            <VolunteerDashboardScreen
              volunteerUser={volunteerUser}
              onNavigate={handleNavigate}
              onLogout={handleLogout}
            />
          );
        }
        if (accountType !== 'resident') return null;
        return (
          <DistributionScreen
            barangayName={residentProfile?.barangay ? `Barangay ${residentProfile.barangay}` : undefined}
            distributionItems={residentDistributions.items}
            isDistributionLoading={residentDistributions.isLoading}
            isDistributionRefreshing={residentDistributions.isRefreshing}
            distributionError={residentDistributions.error}
            distributionWarning={residentDistributions.warning}
            distributionFetchedAt={residentDistributions.fetchedAt}
            onRefreshDistributions={residentDistributions.refresh}
            onNavigate={handleNavigate}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            onNavigate={handleNavigate}
            onLogout={handleLogout}
            accountType={accountType || undefined}
            residentStatus={residentProfile?.status}
            residentNote={residentProfile?.rejectionReason}
            residentProfile={residentProfile}
            volunteerUser={volunteerUser}
            onResidentProfileUpdated={handleResidentProfileUpdated}
            onVolunteerProfileUpdated={setVolunteerUser}
          />
        );
      case 'proof-request':
        return (
          <ResidentProofRequestScreen
            onBack={() => handleNavigate('home')}
            onSignInRequired={handleLogout}
          />
        );
      case 'registration-revision':
        return (
          <ResidentRegistrationRevisionScreen
            residentNote={residentProfile?.rejectionReason}
            onBack={() => handleNavigate('profile')}
            onSubmitted={(profile) => {
              handleResidentProfileUpdated(profile);
              handleNavigate('home');
            }}
          />
        );
      case 'qr':
        if (accountType === 'volunteer') {
          return <VolunteerQRScannerScreen onBack={() => handleNavigate('home')} onNavigate={handleNavigate} />;
        }

        return (
          <QRReceiptScreen
            onBack={() => handleNavigate('home')}
            onNavigate={handleNavigate}
            idData={residentVirtualId}
            isLoading={isVirtualIdLoading}
            error={virtualIdError}
            warning={virtualIdWarning}
            onRefresh={refreshResidentVirtualId}
          />
        );
      case 'home':
      default:
        // Show VolunteerDashboardScreen for volunteers, HomeScreen for residents
        if (accountType === 'volunteer') {
          return (
            <VolunteerDashboardScreen
              volunteerUser={volunteerUser}
              onNavigate={handleNavigate}
              onLogout={handleLogout}
            />
          );
        }
        return (
          <HomeScreen
            onNavigate={handleNavigate}
            residentStatus={residentProfile?.status}
            residentNote={residentProfile?.rejectionReason}
            userName={residentProfile?.firstName || residentProfile?.fullName}
            barangayName={
              residentProfile?.barangay
                ? `Barangay ${residentProfile.barangay}`
                : undefined
            }
            virtualIdData={residentVirtualId}
            isVirtualIdLoading={isVirtualIdLoading}
            virtualIdError={virtualIdError}
            virtualIdWarning={virtualIdWarning}
            onRefreshVirtualId={refreshResidentVirtualId}
            distributionItems={residentDistributions.items}
            isDistributionLoading={residentDistributions.isLoading}
            distributionWarning={residentDistributions.warning}
            onRefreshDistributions={residentDistributions.refresh}
          />
        );
    }
  };

  return (
    <SafeAreaProvider>
      {renderScreen()}
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
  },
});

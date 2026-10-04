import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { residentTheme, theme } from '../../theme';
import { Typography } from './Typography';

export type BottomTab = 'home' | 'distributions' | 'profile' | 'qr';

interface BottomNavigationProps {
  activeTab: BottomTab;
  onNavigate?: (screen: BottomTab) => void;
  showDistributions?: boolean;
  showScan?: boolean;
  appearance?: 'default' | 'resident';
}

interface TabItemConfig {
  key: BottomTab;
  label: string;
  activeIcon: keyof typeof Ionicons.glyphMap;
  inactiveIcon: keyof typeof Ionicons.glyphMap;
}

const DEFAULT_TABS: TabItemConfig[] = [
  { key: 'home', label: 'Home', activeIcon: 'home', inactiveIcon: 'home-outline' },
  { key: 'distributions', label: 'Distributions', activeIcon: 'calendar', inactiveIcon: 'calendar-outline' },
  { key: 'profile', label: 'Profile', activeIcon: 'person', inactiveIcon: 'person-outline' },
];

export default function BottomNavigation({
  activeTab,
  onNavigate,
  showDistributions = true,
  showScan = false,
  appearance = 'default',
}: BottomNavigationProps) {
  const insets = useSafeAreaInsets();
  const isResident = appearance === 'resident';

  const renderTabItem = (tab: TabItemConfig) => {
    const isActive = activeTab === tab.key;
    const color = isResident
      ? (isActive ? residentTheme.colors.brandDark : residentTheme.colors.secondary)
      : (isActive ? theme.colors.primary : theme.colors.textMuted);

    return (
      <TouchableOpacity
        key={tab.key}
        style={styles.item}
        onPress={() => onNavigate?.(tab.key)}
        disabled={isActive}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={tab.label}
      >
        {isResident && isActive ? <View style={styles.activeIndicator} /> : null}
        <Ionicons name={isActive ? tab.activeIcon : tab.inactiveIcon} size={22} color={color} />
        <Typography variant="caption" weight="semiBold" color={color} style={styles.label}>
          {tab.label}
        </Typography>
      </TouchableOpacity>
    );
  };

  const renderScanButton = () => {
    const isScanActive = activeTab === 'qr';

    return (
      <TouchableOpacity
        key="center-scan"
        style={styles.scanButtonWrapper}
        onPress={() => onNavigate?.('qr')}
        disabled={isScanActive}
        activeOpacity={0.85}
        accessibilityRole="tab"
        accessibilityState={{ selected: isScanActive }}
        accessibilityLabel="Scan QR"
      >
        <View style={[
          styles.scanButtonHalo,
          isScanActive && styles.scanButtonHaloActive,
        ]}>
          <View style={[
            styles.scanButtonCore,
            isScanActive && styles.scanButtonCoreActive,
          ]}>
            <Ionicons name="qr-code" size={21} color="#FFFFFF" />
            <Typography variant="caption" weight="bold" color="#FFFFFF" style={styles.scanLabel}>
              Scan
            </Typography>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[
      styles.container,
      appearance === 'resident' && styles.residentContainer,
      { paddingBottom: Math.max(insets.bottom, 6) },
    ]}>
      <View style={styles.navigation}>
        {showScan ? (
          <>
            {renderTabItem({
              key: 'home',
              label: 'Home',
              activeIcon: 'home',
              inactiveIcon: 'home-outline',
            })}

            {renderScanButton()}

            {renderTabItem({
              key: 'profile',
              label: 'Profile',
              activeIcon: 'person',
              inactiveIcon: 'person-outline',
            })}
          </>
        ) : (
          DEFAULT_TABS.filter((tab) => showDistributions || tab.key !== 'distributions').map(renderTabItem)
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    overflow: 'visible',
  },
  navigation: {
    minHeight: 58,
    paddingTop: 7,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'visible',
  },
  residentContainer: {
    backgroundColor: residentTheme.colors.surface,
    borderTopColor: residentTheme.colors.borderAccent,
  },
  item: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    width: 18,
    height: 3,
    borderRadius: 2,
    backgroundColor: residentTheme.colors.accent,
  },
  label: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 14,
  },
  scanButtonWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  scanButtonHalo: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 6,
  },
  scanButtonHaloActive: {
    borderColor: residentTheme.colors.brandDark,
    shadowColor: residentTheme.colors.brandDark,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
  },
  scanButtonCore: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  scanButtonCoreActive: {
    backgroundColor: theme.colors.primaryDark,
  },
  scanLabel: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 12,
  },
});


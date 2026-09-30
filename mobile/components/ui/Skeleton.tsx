import React, { useEffect, useRef } from 'react';
import {
  Animated,
  DimensionValue,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { residentTheme, theme } from '../../theme';

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  tone?: 'default' | 'muted' | 'brand' | 'dark';
  style?: StyleProp<ViewStyle>;
}

/**
 * Base animated skeleton block with a smooth, 60fps pulsing shimmer.
 */
export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 6,
  tone = 'default',
  style,
}: SkeletonProps) {
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.85,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 750,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => animation.stop();
  }, [pulseAnim]);

  const toneColor =
    tone === 'muted'
      ? '#E2EDE5'
      : tone === 'brand'
      ? '#D3EADB'
      : tone === 'dark'
      ? 'rgba(255, 255, 255, 0.16)'
      : '#E5E7EB';

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: toneColor,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
}

/**
 * Text line skeleton.
 */
export function SkeletonText({
  width = '100%',
  height = 14,
  style,
  tone = 'default',
}: SkeletonProps) {
  return <Skeleton width={width} height={height} borderRadius={4} tone={tone} style={style} />;
}

/**
 * Circular avatar / badge skeleton.
 */
export function SkeletonCircle({
  size = 40,
  tone = 'default',
  style,
}: {
  size?: number;
  tone?: 'default' | 'muted' | 'brand' | 'dark';
  style?: StyleProp<ViewStyle>;
}) {
  return <Skeleton width={size} height={size} borderRadius={size / 2} tone={tone} style={style} />;
}

/**
 * Skeleton placeholder for the Virtual Resident ID card.
 */
export function VirtualIdCardSkeleton() {
  return (
    <View style={styles.idCardSkeleton} accessibilityLabel="Loading virtual credential...">
      <View style={styles.idCardGoldRail} />

      {/* Header */}
      <View style={styles.idCardHeader}>
        <View style={styles.idCardBrandRow}>
          <SkeletonCircle size={28} tone="brand" />
          <View style={{ marginLeft: 8, gap: 4 }}>
            <Skeleton width={88} height={12} tone="brand" />
            <Skeleton width={56} height={9} tone="muted" />
          </View>
        </View>
        <Skeleton width={74} height={22} borderRadius={11} tone="brand" />
      </View>

      {/* Body */}
      <View style={styles.idCardBody}>
        <Skeleton width={76} height={76} borderRadius={14} tone="muted" />

        <View style={styles.idCardDetails}>
          <SkeletonText width="45%" height={10} tone="muted" style={{ marginBottom: 4 }} />
          <SkeletonText width="85%" height={16} tone="default" style={{ marginBottom: 10 }} />
          <SkeletonText width="35%" height={10} tone="muted" style={{ marginBottom: 4 }} />
          <SkeletonText width="60%" height={13} tone="default" />
        </View>

        <Skeleton width={68} height={68} borderRadius={10} tone="muted" />
      </View>

      {/* Footer */}
      <View style={styles.idCardFooter}>
        <SkeletonText width="55%" height={9} tone="muted" />
        <SkeletonText width="18%" height={9} tone="muted" />
      </View>
    </View>
  );
}

/**
 * Skeleton placeholder for a single distribution card.
 */
export function DistributionCardSkeleton({ tone = 'muted' }: { tone?: 'default' | 'muted' }) {
  return (
    <View style={styles.distributionCardSkeleton}>
      <View style={styles.cardGoldAccent} />

      <View style={styles.distIconSkeleton}>
        <SkeletonCircle size={40} tone="brand" />
      </View>

      <View style={styles.distBodySkeleton}>
        <View style={styles.distTopRow}>
          <SkeletonText width={90} height={10} tone="brand" />
          <Skeleton width={64} height={18} borderRadius={9} tone="brand" />
        </View>
        <SkeletonText width="78%" height={16} tone="default" style={{ marginTop: 6, marginBottom: 6 }} />
        <SkeletonText width="55%" height={12} tone="muted" style={{ marginBottom: 8 }} />
        <View style={styles.distLocationRow}>
          <SkeletonCircle size={14} tone="muted" />
          <SkeletonText width="40%" height={11} tone="muted" style={{ marginLeft: 6 }} />
        </View>
      </View>
    </View>
  );
}

/**
 * Stacked skeleton list for DistributionScreen while schedules are loading.
 */
export function DistributionListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.listContainer}>
      {Array.from({ length: count }).map((_, index) => (
        <DistributionCardSkeleton key={`dist-skel-${index}`} />
      ))}
    </View>
  );
}

/**
 * Skeleton placeholder for the volunteer dashboard metrics.
 */
export function VolunteerDashboardSkeleton() {
  return (
    <View style={styles.volunteerSkeletonContainer}>
      {/* Progress Card Skeleton */}
      <View style={styles.volCardSkeleton}>
        <View style={styles.cardGoldAccent} />
        <View style={styles.volProgressTop}>
          <SkeletonText width="60%" height={14} tone="default" />
          <SkeletonText width="15%" height={14} tone="brand" />
        </View>
        <Skeleton width="100%" height={8} borderRadius={4} tone="muted" style={{ marginTop: 12 }} />
      </View>

      {/* 2 Stat Cards Row */}
      <View style={styles.volStatsRow}>
        <View style={styles.volStatBox}>
          <View style={styles.cardGoldAccent} />
          <SkeletonText width="50%" height={11} tone="muted" />
          <Skeleton width="45%" height={26} tone="default" style={{ marginVertical: 6 }} />
          <SkeletonText width="70%" height={11} tone="muted" />
        </View>

        <View style={styles.volStatBox}>
          <View style={styles.cardGoldAccent} />
          <SkeletonText width="50%" height={11} tone="muted" />
          <Skeleton width="45%" height={26} tone="default" style={{ marginVertical: 6 }} />
          <SkeletonText width="70%" height={11} tone="muted" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listContainer: {
    gap: 12,
  },
  idCardSkeleton: {
    minHeight: 182,
    padding: 16,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: residentTheme.colors.borderAccent,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'space-between',
  },
  idCardGoldRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: residentTheme.colors.accentDark,
  },
  idCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 4,
  },
  idCardBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  idCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    marginVertical: 10,
    gap: 12,
  },
  idCardDetails: {
    flex: 1,
  },
  idCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: residentTheme.colors.divider,
  },
  distributionCardSkeleton: {
    position: 'relative',
    flexDirection: 'row',
    padding: 16,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: residentTheme.colors.border,
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  cardGoldAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: residentTheme.colors.accentDark,
  },
  distIconSkeleton: {
    marginRight: 12,
    marginLeft: 4,
    paddingTop: 2,
  },
  distBodySkeleton: {
    flex: 1,
  },
  distTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  distLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  volunteerSkeletonContainer: {
    gap: 12,
    marginBottom: 16,
  },
  volCardSkeleton: {
    position: 'relative',
    padding: 16,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: residentTheme.colors.border,
    overflow: 'hidden',
  },
  volProgressTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  volStatsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  volStatBox: {
    flex: 1,
    position: 'relative',
    padding: 14,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: residentTheme.colors.border,
    overflow: 'hidden',
  },
});

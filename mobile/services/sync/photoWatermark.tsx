/**
 * photoWatermark
 *
 * Applies a timestamp + barangay watermark to proof photos before submission.
 * Uses react-native-view-shot (already installed) to render a React Native
 * View with the photo + text overlay, then captures it as a new image.
 *
 * Usage:
 *   const watermarkedUri = await applyWatermark(photoUri, 'San Jose');
 */

import { captureRef } from 'react-native-view-shot';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

/**
 * Format a date for the watermark text.
 */
function formatWatermarkDate(date: Date): string {
  return date.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Calculate scaled dimensions that fit within maxDimension while preserving original aspect ratio.
 */
export function getScaledWatermarkDimensions(
  origWidth: number,
  origHeight: number,
  maxDimension = 1080,
): { width: number; height: number } {
  if (!origWidth || !origHeight) {
    return { width: 720, height: 960 };
  }
  const scale = Math.min(1, maxDimension / Math.max(origWidth, origHeight));
  return {
    width: Math.max(320, Math.round(origWidth * scale)),
    height: Math.max(320, Math.round(origHeight * scale)),
  };
}

/**
 * The watermark overlay component. This is rendered off-screen and captured
 * via react-native-view-shot.
 */
export function WatermarkOverlay({
  uri,
  barangay,
  dateLabel,
  viewRef,
  width = 720,
  height = 960,
}: {
  uri: string;
  barangay: string;
  dateLabel: string;
  viewRef: React.RefObject<View | null>;
  width?: number;
  height?: number;
}) {
  return (
    <View ref={viewRef} style={[watermarkStyles.container, { width, height }]} collapsable={false}>
      <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
      <View style={watermarkStyles.overlay}>
        <Text style={watermarkStyles.text} numberOfLines={1}>
          {dateLabel} • Brgy. {barangay} • Kapit-Bisig
        </Text>
      </View>
    </View>
  );
}

const watermarkStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: -9999,
    top: -9999,
    backgroundColor: 'transparent',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

/**
 * Capture the watermark overlay view and return the resulting image URI.
 * This must be called after the WatermarkOverlay is mounted and rendered.
 */
export async function captureWatermarkedPhoto(
  viewRef: React.RefObject<View | null>,
  width?: number,
  height?: number,
): Promise<string> {
  const uri = await captureRef(viewRef, {
    format: 'jpg',
    quality: 0.85,
    ...(width && height ? { width, height } : {}),
  });
  return uri;
}

/**
 * Build the watermark date label for a given date.
 */
export function buildWatermarkLabel(date?: Date): string {
  return formatWatermarkDate(date || new Date());
}

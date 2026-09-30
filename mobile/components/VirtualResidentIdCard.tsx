import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import { type ResidentQrData } from '../services/api/ResidentQrService';
import { residentTheme } from '../theme';
import { formatResidentFullName } from '../utils/residentName';
import { saveViewToMediaLibrary } from '../utils/saveViewToMediaLibrary';
import ResidentBrandLockup from './ui/ResidentBrandLockup';
import { VirtualIdCardSkeleton } from './ui/Skeleton';

const residentColors = residentTheme.colors;

interface VirtualResidentIdCardProps {
  idData: ResidentQrData | null;
  isLoading?: boolean;
  error?: string | null;
  warning?: string | null;
  onRefresh?: (force?: boolean) => Promise<void>;
}

function formatIssuedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
}

export default function VirtualResidentIdCard({
  idData,
  isLoading = false,
  error = null,
  warning = null,
  onRefresh,
}: VirtualResidentIdCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [showLargeQr, setShowLargeQr] = useState(false);
  const idCardRef = useRef<any>(null);
  const autoRefreshAttemptedRef = useRef(false);
  const residentFullName = formatResidentFullName({ fullName: idData?.resident.fullName });

  useEffect(() => {
    if (idData) {
      autoRefreshAttemptedRef.current = false;
      return;
    }
    if (isLoading || error || !onRefresh || autoRefreshAttemptedRef.current) return;

    autoRefreshAttemptedRef.current = true;
    onRefresh(true).catch(() => undefined);
  }, [error, idData, isLoading, onRefresh]);

  const availabilityLabel = idData
    ? (isLoading ? 'UPDATING' : 'READY')
    : error
      ? 'UNAVAILABLE'
      : 'PREPARING';

  const handleDownload = async () => {
    if (!idCardRef.current || !idData || isDownloading) return;

    setIsDownloading(true);
    try {
      const result = await saveViewToMediaLibrary(idCardRef, {
        width: 1200,
        height: 720,
      });
      if (result === 'permission-denied') {
        Alert.alert(
          'Photos permission needed',
          'Allow photo access to save your virtual ID to your gallery.',
        );
        return;
      }
      Alert.alert(
        'Virtual ID downloaded',
        'A high-quality copy was saved to your gallery.',
      );
    } catch {
      Alert.alert('Download failed', 'The ID could not be saved. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <View>
          <Text style={styles.sectionEyebrow}>OFFICIAL RESIDENT CREDENTIAL</Text>
          <Text style={styles.sectionTitle}>My Virtual ID</Text>
        </View>
        <View style={[styles.alwaysReadyPill, !idData && error && styles.unavailablePill]}>
          <View
            style={[
              styles.liveDot,
              isLoading && styles.loadingDot,
              !idData && error && styles.unavailableDot,
            ]}
          />
          <Text style={[styles.alwaysReadyText, !idData && error && styles.unavailableText]}>
            {availabilityLabel}
          </Text>
        </View>
      </View>

      {isLoading && !idData ? (
        <VirtualIdCardSkeleton />
      ) : !idData && error ? (
        <View style={styles.stateCard}>
          <View style={styles.errorIcon}>
            <Ionicons name="lock-closed" size={21} color="#9A6700" />
          </View>
          <Text style={styles.stateTitle}>Virtual ID unavailable</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => onRefresh?.(true)}
            disabled={isLoading || !onRefresh}
            accessibilityRole="button"
          >
            <Ionicons name="refresh" size={16} color={residentColors.brandDark} />
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : idData ? (
        <>
          <ViewShot
            ref={idCardRef}
            options={{ format: 'png', quality: 1 }}
            style={styles.shot}
          >
            <View style={styles.idCard}>
              <View style={styles.goldRail} />
              <View style={styles.watermark}>
                <Ionicons name="people" size={142} color="rgba(22, 163, 74, 0.045)" />
              </View>

              <View style={styles.idHeader}>
                <ResidentBrandLockup size="credential" style={styles.brandLockup} />
                <View style={styles.verifiedPill}>
                  <Ionicons name="checkmark-circle" size={13} color={residentColors.brand} />
                  <Text style={styles.verifiedText}>VERIFIED</Text>
                </View>
              </View>

              <View style={styles.idBody}>
                <View style={styles.photoColumn}>
                  <View style={styles.photoFrame}>
                    {idData.resident.avatarUrl ? (
                      <Image
                        source={{ uri: idData.resident.avatarUrl }}
                        style={styles.photo}
                        resizeMode="cover"
                      />
                    ) : (
                      <Ionicons name="person" size={43} color="#244A3A" />
                    )}
                  </View>
                  <Text style={styles.photoCaption}>RESIDENT</Text>
                </View>

                <View style={styles.identityColumn}>
                  <Text style={styles.nameLabel}>RESIDENT NAME</Text>
                  <Text style={styles.residentName} numberOfLines={2}>
                    {residentFullName}
                  </Text>
                  <Text style={styles.residentCode}>{idData.residentCode}</Text>
                  <Text style={styles.detailLabel}>BARANGAY / CITY</Text>
                  <Text style={styles.detailValue} numberOfLines={2}>
                    {idData.resident.barangay}
                    {idData.resident.city ? `, ${idData.resident.city}` : ''}
                  </Text>
                  <Text style={styles.issuedLabel}>ISSUED</Text>
                  <Text style={styles.detailValue}>{formatIssuedDate(idData.issuedAt)}</Text>
                </View>

                <View style={styles.qrColumn}>
                  <TouchableOpacity
                    style={styles.qrFrame}
                    onPress={() => setShowLargeQr(true)}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="Enlarge virtual ID QR code"
                  >
                    <QRCode value={idData.qrData} size={72} backgroundColor={residentColors.surface} />
                  </TouchableOpacity>
                  <Text style={styles.scanLabel}>SCAN TO VERIFY</Text>
                  <Text style={styles.tapHint}>Tap to enlarge</Text>
                </View>
              </View>

              <View style={styles.idFooter}>
                <Text style={styles.disclaimer}>Kapit-Bisig Resident ID - Not a national ID</Text>
                <Text style={styles.version}>ID v{idData.qrVersion}</Text>
              </View>
            </View>
          </ViewShot>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.downloadButton, isDownloading && styles.downloadButtonDisabled]}
              onPress={handleDownload}
              disabled={isDownloading}
              accessibilityRole="button"
              accessibilityLabel="Download virtual ID as an image"
            >
              {isDownloading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={19} color="#FFFFFF" />
                  <Text style={styles.downloadText}>Download ID</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={styles.scanHint}>
              <Ionicons name="shield-checkmark-outline" size={17} color={residentColors.icon} />
              <Text style={styles.scanHintText}>Present this QR only to authorized staff.</Text>
            </View>
            {warning ? (
              <View style={styles.refreshWarning}>
                <Ionicons name="cloud-offline-outline" size={16} color="#9A6700" />
                <Text style={styles.refreshWarningText}>{warning} Your saved ID is still available.</Text>
                <TouchableOpacity
                  onPress={() => onRefresh?.(true)}
                  disabled={isLoading || !onRefresh}
                  accessibilityRole="button"
                  accessibilityLabel="Retry virtual ID refresh"
                >
                  <Text style={styles.refreshWarningAction}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.stateCard} accessibilityLabel="Preparing virtual ID">
          <View style={styles.preparingIcon}>
            <Ionicons name="id-card-outline" size={24} color={residentColors.brandDark} />
          </View>
          <Text style={styles.stateTitle}>Getting your ID ready</Text>
          <Text style={styles.stateText}>
            Your approved resident credential is being prepared. This usually takes only a moment.
          </Text>
          {onRefresh ? (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => onRefresh(true)}
              accessibilityRole="button"
            >
              <Ionicons name="refresh" size={16} color={residentColors.brandDark} />
              <Text style={styles.retryText}>Refresh ID</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      <Modal
        visible={showLargeQr}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLargeQr(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowLargeQr(false)}>
          <Pressable style={styles.qrModal} onPress={() => undefined}>
            <View style={styles.modalIcon}>
              <Ionicons name="scan-outline" size={22} color={residentColors.icon} />
            </View>
            <Text style={styles.qrModalTitle}>Scan Resident ID</Text>
            <Text style={styles.qrModalSubtitle}>Keep the code inside the scanner frame.</Text>
            {idData ? (
              <View style={styles.largeQr}>
                <QRCode value={idData.qrData} size={236} />
              </View>
            ) : null}
            <Text style={styles.qrModalCode}>{idData?.residentCode}</Text>
            <TouchableOpacity style={styles.modalClose} onPress={() => setShowLargeQr(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 20, marginBottom: 22 },
  sectionHeading: {
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionEyebrow: { fontSize: 8, fontWeight: '800', letterSpacing: 1.1, color: '#6B7280' },
  sectionTitle: { marginTop: 2, fontSize: 19, fontWeight: '800', color: '#111827' },
  alwaysReadyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: residentColors.accentSoft,
    borderWidth: 1,
    borderColor: residentColors.accent,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: residentColors.brand },
  loadingDot: { backgroundColor: '#F59E0B' },
  unavailablePill: { backgroundColor: '#FEF2F2' },
  unavailableDot: { backgroundColor: '#EF4444' },
  alwaysReadyText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.7, color: residentColors.brandDark },
  unavailableText: { color: '#B91C1C' },
  stateCard: {
    minHeight: 190,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: residentColors.surface,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  skeletonHeader: { width: '100%', height: 32, borderRadius: 9, backgroundColor: residentColors.surfaceMuted },
  skeletonBody: { width: '100%', marginTop: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  skeletonPhoto: { width: 52, height: 58, borderRadius: 11, backgroundColor: residentColors.brandSoft },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLineWide: { width: '85%', height: 12, borderRadius: 6, backgroundColor: '#E9F1EC' },
  skeletonLineShort: { width: '55%', height: 9, borderRadius: 5, backgroundColor: '#EEF4F0' },
  errorIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: residentColors.accentSoft },
  preparingIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: residentColors.brandSoft, borderWidth: 1, borderColor: residentColors.borderAccent },
  stateTitle: { marginTop: 10, fontSize: 16, fontWeight: '800', color: residentColors.ink },
  stateText: { marginTop: 7, fontSize: 12.5, lineHeight: 18, color: '#64746D', textAlign: 'center' },
  retryButton: { marginTop: 14, minHeight: 39, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent },
  retryText: { color: residentColors.brandDark, fontSize: 12.5, fontWeight: '800' },
  shot: { borderRadius: 20, backgroundColor: residentColors.surface },
  idCard: { height: 230, borderRadius: 20, backgroundColor: residentColors.surface, overflow: 'hidden', borderWidth: 1, borderColor: residentColors.borderAccent, shadowColor: residentColors.brandDark, shadowOpacity: 0.16, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 6 },
  goldRail: { height: 4, backgroundColor: residentColors.accent },
  watermark: { position: 'absolute', right: 70, bottom: -28, transform: [{ rotate: '-12deg' }] },
  idHeader: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, backgroundColor: residentColors.surface },
  brandLockup: { flex: 1 },
  verifiedPill: { flexDirection: 'row', gap: 3, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, backgroundColor: residentColors.accentSoft, borderWidth: 1, borderColor: residentColors.accent },
  verifiedText: { fontSize: 7.5, fontWeight: '900', color: residentColors.ink },
  idBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 12, paddingTop: 12, backgroundColor: residentColors.surface },
  photoColumn: { width: 65, alignItems: 'center' },
  photoFrame: { width: 60, height: 76, borderRadius: 11, backgroundColor: residentColors.iconSurface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: residentColors.borderAccent },
  photo: { width: '100%', height: '100%' },
  photoCaption: { marginTop: 4, fontSize: 6.5, fontWeight: '900', letterSpacing: 0.8, color: '#6B6558' },
  identityColumn: { flex: 1, minWidth: 0, paddingHorizontal: 10 },
  nameLabel: { fontSize: 6.5, fontWeight: '900', letterSpacing: 0.8, color: '#756F62' },
  residentName: { marginTop: 3, fontSize: 13, lineHeight: 15.5, fontWeight: '900', color: residentColors.ink },
  residentCode: { marginTop: 4, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.65, color: residentColors.brandDark },
  detailLabel: { marginTop: 8, fontSize: 6.3, fontWeight: '900', letterSpacing: 0.65, color: '#756F62' },
  issuedLabel: { marginTop: 6, fontSize: 6.3, fontWeight: '900', letterSpacing: 0.65, color: '#756F62' },
  detailValue: { marginTop: 1, fontSize: 8, lineHeight: 10.5, fontWeight: '700', color: '#3F463F' },
  qrColumn: { width: 84, alignItems: 'center' },
  qrFrame: { padding: 5, backgroundColor: residentColors.surface, borderRadius: 8, borderWidth: 1, borderColor: residentColors.borderAccent },
  scanLabel: { marginTop: 4, fontSize: 6.3, fontWeight: '900', letterSpacing: 0.65, color: residentColors.brandDark },
  tapHint: { marginTop: 1, fontSize: 5.8, color: '#777267' },
  idFooter: { height: 24, paddingHorizontal: 13, backgroundColor: residentColors.brandDark, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  disclaimer: { color: residentColors.inverse, fontSize: 7.2, fontWeight: '600' },
  version: { color: residentColors.accent, fontSize: 7.2, fontWeight: '700' },
  actions: { marginTop: 12 },
  downloadButton: { minHeight: 48, borderRadius: 14, backgroundColor: residentColors.brand, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', shadowColor: residentColors.brandDark, shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  downloadButtonDisabled: { opacity: 0.68 },
  downloadText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  scanHint: { marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  scanHintText: { fontSize: 10.5, color: '#6A7D73' },
  refreshWarning: { marginTop: 10, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 10, backgroundColor: '#FFF8E1' },
  refreshWarningText: { flex: 1, fontSize: 10.5, lineHeight: 15, color: '#76520A' },
  refreshWarningAction: { fontSize: 11, fontWeight: '800', color: residentColors.brandDark },
  modalOverlay: { flex: 1, padding: 24, backgroundColor: 'rgba(8, 24, 17, 0.76)', alignItems: 'center', justifyContent: 'center' },
  qrModal: { width: '100%', maxWidth: 340, borderRadius: 24, padding: 22, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: residentColors.borderAccent, alignItems: 'center' },
  modalIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: residentColors.iconSurface, borderWidth: 1, borderColor: residentColors.borderAccent, alignItems: 'center', justifyContent: 'center' },
  qrModalTitle: { marginTop: 10, fontSize: 19, fontWeight: '800', color: '#19382B' },
  qrModalSubtitle: { marginTop: 4, fontSize: 12, color: '#718079' },
  largeQr: { marginTop: 17, padding: 12, borderWidth: 1, borderColor: residentColors.borderAccent, borderRadius: 14 },
  qrModalCode: { marginTop: 13, fontSize: 14, fontWeight: '700', letterSpacing: 1, color: residentColors.brandDark },
  modalClose: { alignSelf: 'stretch', marginTop: 18, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: residentColors.surface, borderWidth: 1, borderColor: residentColors.borderAccent },
  modalCloseText: { color: residentColors.brandDark, fontWeight: '700' },
});

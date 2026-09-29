import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Typography } from './ui/Typography';
import { residentTheme, theme } from '../theme';
import {
  getResidentToken,
  ResidentProfile,
  submitResidentRegistrationRevision,
} from '../services/api/ResidentQrService';
import { getIdFormatInfo, sanitizeIdInput } from '../utils/idFormat';

const residentColors = residentTheme.colors;

type PickedImage = {
  uri: string;
};

const ID_TYPES = ['PhilSys ID', 'Driver\'s License', 'Passport', 'SSS ID', 'PhilHealth ID', 'Voter\'s ID'];

async function imageUriToDataUrl(uri: string): Promise<string> {
  const extensionMatch = uri.match(/\.(png|webp)$/i);
  const mimeType = extensionMatch?.[1]?.toLowerCase() === 'png'
    ? 'image/png'
    : extensionMatch?.[1]?.toLowerCase() === 'webp'
      ? 'image/webp'
      : 'image/jpeg';

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return `data:${mimeType};base64,${base64}`;
}

interface ResidentRegistrationRevisionScreenProps {
  residentNote?: string;
  onBack: () => void;
  onSubmitted: (profile: ResidentProfile) => void;
}

export default function ResidentRegistrationRevisionScreen({
  residentNote,
  onBack,
  onSubmitted,
}: ResidentRegistrationRevisionScreenProps) {
  const [selectedIdType, setSelectedIdType] = useState(ID_TYPES[0]);
  const [idNumber, setIdNumber] = useState('');
  const [frontIdImage, setFrontIdImage] = useState<PickedImage | null>(null);
  const [backIdImage, setBackIdImage] = useState<PickedImage | null>(null);
  const [faceImage, setFaceImage] = useState<PickedImage | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    return Boolean(
      selectedIdType.trim()
      && idNumber.trim()
      && frontIdImage?.uri
      && backIdImage?.uri
      && faceImage?.uri,
    );
  }, [backIdImage?.uri, faceImage?.uri, frontIdImage?.uri, idNumber, selectedIdType]);

  const pickImage = useCallback(async (
    target: 'front' | 'back' | 'face',
    source: 'camera' | 'gallery',
  ) => {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== 'granted') {
      Alert.alert('Permission needed', `Please allow ${source} access to continue.`);
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.9,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.9,
        });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    const nextValue = { uri: result.assets[0].uri };
    if (target === 'front') setFrontIdImage(nextValue);
    if (target === 'back') setBackIdImage(nextValue);
    if (target === 'face') setFaceImage(nextValue);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) {
      Alert.alert('Missing files', 'Please complete the ID details and upload front ID, back ID, and selfie files.');
      return;
    }

    const token = await getResidentToken();
    if (!token) {
      Alert.alert('Login required', 'Please log in again before sending corrected files.');
      return;
    }

    setSubmitting(true);
    try {
      const [frontIdImagePayload, backIdImagePayload, faceImagePayload] = await Promise.all([
        imageUriToDataUrl(frontIdImage!.uri),
        imageUriToDataUrl(backIdImage!.uri),
        imageUriToDataUrl(faceImage!.uri),
      ]);

      const result = await submitResidentRegistrationRevision(token, {
        idType: selectedIdType,
        idNumber: idNumber.trim(),
        frontIdImage: frontIdImagePayload,
        backIdImage: backIdImagePayload,
        faceImage: faceImagePayload,
      });

      if (!result.success || !result.data) {
        Alert.alert('Submission failed', result.message || 'Unable to submit corrected files right now.');
        return;
      }

      Alert.alert(
        'Submitted',
        result.message || 'Your corrected registration files were submitted and are now pending admin review.',
      );
      onSubmitted(result.data);
    } catch (error) {
      Alert.alert(
        'Submission failed',
        error instanceof Error ? error.message : 'Unable to submit corrected files right now.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [backIdImage, canSubmit, faceImage, frontIdImage, idNumber, onSubmitted, selectedIdType]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Ionicons name="arrow-back" size={20} color={residentColors.icon} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Typography variant="h3" weight="semiBold" color={residentColors.ink}>Registration Revision</Typography>
            <Typography variant="body" color={residentColors.secondary}>
              Upload corrected ID files and selfie so the admin can review your registration again.
            </Typography>
          </View>
        </View>

        {residentNote?.trim() ? (
          <Card variant="outlined" style={styles.noteCard}>
            <Ionicons name="document-text-outline" size={20} color={residentColors.icon} />
            <View style={{ flex: 1 }}>
              <Typography variant="body" weight="semiBold">Admin note</Typography>
              <Typography variant="body" color={residentColors.secondary}>
                {residentNote.trim()}
              </Typography>
            </View>
          </Card>
        ) : null}

        <Card style={styles.sectionCard}>
          <Typography variant="body" weight="semiBold">ID type</Typography>
          <View style={styles.chipWrap}>
            {ID_TYPES.map((type) => {
              const selected = type === selectedIdType;
              return (
                <Pressable
                  key={type}
                  onPress={() => setSelectedIdType(type)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{type}</Text>
                </Pressable>
              );
            })}
          </View>

          <Typography variant="body" weight="semiBold" style={styles.fieldLabel}>ID number</Typography>
          <TextInput
            value={idNumber}
            onChangeText={(text) => {
              const formatted = sanitizeIdInput(selectedIdType, text, idNumber);
              setIdNumber(formatted);
            }}
            placeholder={getIdFormatInfo(selectedIdType).placeholder || 'Enter the corrected ID number'}
            placeholderTextColor={theme.colors.textMuted}
            keyboardType={getIdFormatInfo(selectedIdType).keyboardType}
            maxLength={getIdFormatInfo(selectedIdType).maxLength}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
          />
          {!!selectedIdType && (
            <Typography variant="caption" color="muted" style={{ marginTop: 4 }}>
              Format: {getIdFormatInfo(selectedIdType).hint}
            </Typography>
          )}
        </Card>

        <UploadCard
          title="Front ID"
          image={frontIdImage}
          onPickCamera={() => pickImage('front', 'camera')}
          onPickGallery={() => pickImage('front', 'gallery')}
        />

        <UploadCard
          title="Back ID"
          image={backIdImage}
          onPickCamera={() => pickImage('back', 'camera')}
          onPickGallery={() => pickImage('back', 'gallery')}
        />

        <UploadCard
          title="Selfie / Face Capture"
          image={faceImage}
          onPickCamera={() => pickImage('face', 'camera')}
          onPickGallery={() => pickImage('face', 'gallery')}
        />

        <Button
          title={submitting ? 'Submitting...' : 'Submit corrected files'}
          onPress={() => {
            handleSubmit().catch(() => undefined);
          }}
          disabled={!canSubmit || submitting}
          icon="send-outline"
          appearance="resident"
          style={styles.submitButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function UploadCard({
  title,
  image,
  onPickCamera,
  onPickGallery,
}: {
  title: string;
  image: PickedImage | null;
  onPickCamera: () => void;
  onPickGallery: () => void;
}) {
  return (
    <Card style={styles.sectionCard}>
      <View style={styles.uploadHeader}>
        <Typography variant="body" weight="semiBold">{title}</Typography>
        <Text style={styles.uploadStatus}>{image ? 'Ready' : 'Required'}</Text>
      </View>

      <View style={styles.previewWrap}>
        {image?.uri ? (
          <Image source={{ uri: image.uri }} style={styles.previewImage} />
        ) : (
          <View style={styles.previewPlaceholder}>
            <Ionicons name="image-outline" size={24} color={residentColors.icon} />
            <Text style={styles.previewPlaceholderText}>No image selected</Text>
          </View>
        )}
      </View>

      <View style={styles.actionRow}>
        <Button title="Gallery" icon="images-outline" variant="secondary" appearance="resident" onPress={onPickGallery} style={styles.actionButton} />
        <Button title="Camera" icon="camera-outline" variant="outline" appearance="resident" onPress={onPickCamera} style={styles.actionButton} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: residentColors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: residentColors.surface,
    borderWidth: 1,
    borderColor: residentColors.border,
  },
  headerTextWrap: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    backgroundColor: residentColors.accentSoft,
    borderColor: residentColors.accent,
  },
  sectionCard: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: residentColors.border,
    shadowColor: residentTheme.shadow.shadowColor,
    shadowOffset: residentTheme.shadow.shadowOffset,
    shadowOpacity: residentTheme.shadow.shadowOpacity,
    shadowRadius: residentTheme.shadow.shadowRadius,
    elevation: residentTheme.shadow.elevation,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: residentColors.border,
    backgroundColor: residentColors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipSelected: {
    borderColor: residentColors.brand,
    backgroundColor: residentColors.brand,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: residentColors.secondary,
  },
  chipTextSelected: {
    color: residentColors.inverse,
  },
  fieldLabel: {
    marginTop: 4,
  },
  input: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: residentColors.border,
    backgroundColor: residentColors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: residentColors.ink,
  },
  uploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  uploadStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: residentColors.ink,
    backgroundColor: residentColors.surfaceMuted,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
  },
  previewWrap: {
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: residentColors.surfaceMuted,
    borderWidth: 1,
    borderColor: residentColors.borderAccent,
    minHeight: 190,
  },
  previewImage: {
    width: '100%',
    height: 220,
    resizeMode: 'cover',
  },
  previewPlaceholder: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  previewPlaceholderText: {
    fontSize: 13,
    color: residentColors.muted,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
  submitButton: {
    marginTop: theme.spacing.sm,
  },
});

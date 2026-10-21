import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

export interface HouseholdMemberItem {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  dateOfBirth?: string; // MM-DD-YYYY
  birthYear?: string;
  gender?: 'Male' | 'Female' | 'Other';
  vulnerabilities: string[];
}

interface HouseholdMembersEditorProps {
  members: HouseholdMemberItem[];
  onChange: (members: HouseholdMemberItem[]) => void;
  readOnly?: boolean;
  accentColor?: string;
  containerStyle?: any;
}

const RELATIONSHIP_OPTIONS = [
  'Spouse',
  'Child',
  'Parent',
  'Sibling',
  'Grandparent',
  'Relative',
  'Other',
];

const VULNERABILITY_OPTIONS = [
  { id: 'senior', label: 'Senior (60+)', icon: 'walk-outline' },
  { id: 'pwd', label: 'PWD', icon: 'accessibility-outline' },
  { id: 'pregnant', label: 'Pregnant', icon: 'woman-outline' },
  { id: 'children', label: 'Child (0-5)', icon: 'people-outline' },
  { id: 'solo_parent', label: 'Solo Parent', icon: 'person-outline' },
];

/**
 * Format digits as MM-DD-YYYY
 */
export const formatDateInput = (text: string): string => {
  const cleaned = text.replace(/\D/g, '').slice(0, 8);
  let formatted = '';
  if (cleaned.length > 0) {
    formatted = cleaned.substring(0, 2);
    if (cleaned.length > 2) {
      formatted += '-' + cleaned.substring(2, 4);
    }
    if (cleaned.length > 4) {
      formatted += '-' + cleaned.substring(4, 8);
    }
  }
  return formatted;
};

/**
 * Validates a MM-DD-YYYY or YYYY-MM-DD date string
 */
export const validateDateOfBirth = (dob: string): { valid: boolean; error?: string } => {
  if (!dob || dob.trim().length !== 10) {
    return { valid: false, error: 'Complete Date of Birth is required (MM-DD-YYYY).' };
  }
  const parts = dob.includes('-') ? dob.split('-') : dob.split('/');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid date format. Expected MM-DD-YYYY.' };
  }

  let month: number;
  let day: number;
  let year: number;

  if (parts[0].length === 4) {
    // YYYY-MM-DD
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    // MM-DD-YYYY
    month = parseInt(parts[0], 10);
    day = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }

  if (isNaN(month) || month < 1 || month > 12) {
    return { valid: false, error: 'Invalid month in Date of Birth (01-12).' };
  }
  if (isNaN(day) || day < 1 || day > 31) {
    return { valid: false, error: 'Invalid day in Date of Birth (01-31).' };
  }
  const currentYear = new Date().getFullYear();
  if (isNaN(year) || year < 1900 || year > currentYear) {
    return { valid: false, error: `Invalid year (1900-${currentYear}).` };
  }

  const dateObj = new Date(year, month - 1, day);
  if (isNaN(dateObj.getTime()) || dateObj > new Date()) {
    return { valid: false, error: 'Date of Birth cannot be in the future.' };
  }

  return { valid: true };
};

/**
 * Calculates integer age from MM-DD-YYYY or YYYY-MM-DD
 */
export const calculateMemberAge = (dob?: string | null): number | null => {
  if (!dob || dob.trim().length !== 10) return null;
  const parts = dob.includes('-') ? dob.split('-') : dob.split('/');
  if (parts.length !== 3) return null;

  let month: number;
  let day: number;
  let year: number;

  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    month = parseInt(parts[0], 10);
    day = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }

  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;

  const birthDate = new Date(year, month - 1, day);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

/**
 * Evaluates whether a vulnerability option is eligible based on age and gender
 */
export const getVulnerabilityEligibility = (
  vulnId: string,
  age: number | null,
  gender?: string | null
): { eligible: boolean; hint?: string } => {
  if (vulnId === 'pwd') {
    return { eligible: true };
  }

  if (vulnId === 'senior') {
    if (age !== null && age < 60) {
      return { eligible: false, hint: 'Requires age 60+' };
    }
    return { eligible: true };
  }

  if (vulnId === 'children') {
    if (age !== null && age > 5) {
      return { eligible: false, hint: 'Requires age 0–5' };
    }
    return { eligible: true };
  }

  if (vulnId === 'pregnant') {
    if (gender === 'Male') {
      return { eligible: false, hint: 'Female members only' };
    }
    if (age !== null && (age < 12 || age >= 60)) {
      return { eligible: false, hint: 'Applicable for ages 12–59' };
    }
    return { eligible: true };
  }

  if (vulnId === 'solo_parent') {
    if (age !== null && age < 15) {
      return { eligible: false, hint: 'Not applicable under age 15' };
    }
    return { eligible: true };
  }

  return { eligible: true };
};

export default function HouseholdMembersEditor({
  members,
  onChange,
  readOnly = false,
  accentColor = '#2E7D32',
  containerStyle,
}: HouseholdMembersEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [relationship, setRelationship] = useState('Child');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date(2000, 0, 1));
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [vulnerabilities, setVulnerabilities] = useState<string[]>([]);

  // Auto-prune ineligible vulnerabilities when dateOfBirth or gender changes
  useEffect(() => {
    const age = calculateMemberAge(dateOfBirth);
    setVulnerabilities((prev) =>
      prev.filter((v) => getVulnerabilityEligibility(v, age, gender).eligible)
    );
  }, [dateOfBirth, gender]);

  const openAddModal = () => {
    setEditingIndex(null);
    setFirstName('');
    setLastName('');
    setRelationship('Child');
    setDateOfBirth('');
    setDobError(null);
    setSelectedDate(new Date(2000, 0, 1));
    setGender('Male');
    setVulnerabilities([]);
    setIsModalOpen(true);
  };

  const openEditModal = (index: number) => {
    const item = members[index];
    if (!item) return;
    setEditingIndex(index);
    setFirstName(item.firstName || '');
    setLastName(item.lastName || '');
    setRelationship(item.relationship || 'Child');

    // Restore dateOfBirth or synthesize from birthYear
    let initDob = item.dateOfBirth || '';
    if (!initDob && item.birthYear) {
      initDob = `01-01-${item.birthYear}`;
    }
    setDateOfBirth(initDob);
    setDobError(null);

    if (initDob && initDob.length === 10) {
      const parts = initDob.includes('-') ? initDob.split('-') : initDob.split('/');
      if (parts.length === 3) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (!isNaN(m) && !isNaN(d) && !isNaN(y)) {
          setSelectedDate(new Date(y, m - 1, d));
        }
      }
    } else {
      setSelectedDate(new Date(2000, 0, 1));
    }

    setGender(item.gender || 'Male');
    setVulnerabilities(item.vulnerabilities || []);
    setIsModalOpen(true);
  };

  const handleSaveMember = () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!trimmedFirst) {
      Alert.alert('Required Field', "Please enter the member's first name.");
      return;
    }
    if (!trimmedLast) {
      Alert.alert('Required Field', "Please enter the member's last name.");
      return;
    }

    const dobValidation = validateDateOfBirth(dateOfBirth);
    if (!dobValidation.valid) {
      setDobError(dobValidation.error || 'Valid Date of Birth is required.');
      Alert.alert('Required Field', dobValidation.error || 'Please enter a valid Date of Birth (MM-DD-YYYY).');
      return;
    }

    // Extract year from MM-DD-YYYY or YYYY-MM-DD
    const parts = dateOfBirth.includes('-') ? dateOfBirth.split('-') : dateOfBirth.split('/');
    const derivedBirthYear = parts[0].length === 4 ? parts[0] : parts[2];

    const memberData: HouseholdMemberItem = {
      id: editingIndex !== null ? members[editingIndex].id : Date.now().toString(),
      firstName: trimmedFirst,
      lastName: trimmedLast,
      relationship,
      dateOfBirth: dateOfBirth.trim(),
      birthYear: derivedBirthYear,
      gender,
      vulnerabilities,
    };

    let updated: HouseholdMemberItem[];
    if (editingIndex !== null) {
      updated = [...members];
      updated[editingIndex] = memberData;
    } else {
      updated = [...members, memberData];
    }

    onChange(updated);
    setIsModalOpen(false);
  };

  const handleDeleteMember = (index: number) => {
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${members[index].firstName} ${members[index].lastName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const updated = members.filter((_, i) => i !== index);
            onChange(updated);
          },
        },
      ]
    );
  };

  const toggleVulnerability = (id: string) => {
    const age = calculateMemberAge(dateOfBirth);
    const eligibility = getVulnerabilityEligibility(id, age, gender);

    if (!eligibility.eligible) {
      Alert.alert(
        'Incompatible Category',
        eligibility.hint || 'This vulnerability does not align with the member details.'
      );
      return;
    }

    setVulnerabilities((prev) => {
      if (prev.includes(id)) {
        return prev.filter((v) => v !== id);
      }

      // Mutual exclusions
      let updated = [...prev];
      if (id === 'senior') {
        updated = updated.filter((v) => v !== 'children');
      } else if (id === 'children') {
        updated = updated.filter((v) => v !== 'senior' && v !== 'pregnant' && v !== 'solo_parent');
      } else if (id === 'pregnant') {
        updated = updated.filter((v) => v !== 'children');
      } else if (id === 'solo_parent') {
        updated = updated.filter((v) => v !== 'children');
      }
      return [...updated, id];
    });
  };

  const currentMemberAge = calculateMemberAge(dateOfBirth);

  return (
    <View style={[styles.container, containerStyle]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Household Members</Text>
          <Text style={styles.subtitle}>
            List every person living with you to protect relief quotas and prevent duplicate registration.
          </Text>
        </View>
        {!readOnly && (
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: accentColor }]}
            onPress={openAddModal}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color="#FFF" />
            <Text style={styles.addButtonText}>Add Member</Text>
          </TouchableOpacity>
        )}
      </View>

      {members.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={32} color="#9E9E9E" />
          <Text style={styles.emptyText}>No household members added yet.</Text>
          <Text style={styles.emptySubtext}>
            If you live with family, tap "+ Add Member" to register them under your household.
          </Text>
        </View>
      ) : (
        <View style={styles.listContainer}>
          {members.map((member, index) => {
            const age = calculateMemberAge(member.dateOfBirth);
            return (
              <View key={member.id || index} style={styles.memberCard}>
                <View style={styles.memberAvatar}>
                  <Ionicons name="person" size={20} color={accentColor} />
                </View>

                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>
                    {member.firstName} {member.lastName}
                  </Text>
                  <View style={styles.memberMetaRow}>
                    <Text style={styles.memberMetaBadge}>{member.relationship || 'Relative'}</Text>
                    {member.dateOfBirth ? (
                      <Text style={styles.memberMetaText}>
                        • {age !== null ? `Age ${age} (${member.dateOfBirth})` : member.dateOfBirth}
                      </Text>
                    ) : member.birthYear ? (
                      <Text style={styles.memberMetaText}>• Born {member.birthYear}</Text>
                    ) : null}
                    {member.gender ? (
                      <Text style={styles.memberMetaText}>• {member.gender}</Text>
                    ) : null}
                  </View>

                  {member.vulnerabilities && member.vulnerabilities.length > 0 && (
                    <View style={styles.vulnerabilityBadgesRow}>
                      {member.vulnerabilities.map((v) => {
                        const opt = VULNERABILITY_OPTIONS.find((item) => item.id === v);
                        return (
                          <View key={v} style={styles.vulnerabilityChip}>
                            <Text style={styles.vulnerabilityChipText}>
                              {opt ? opt.label : v}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                {!readOnly && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => openEditModal(index)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="pencil-outline" size={18} color="#1565C0" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleDeleteMember(index)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#D32F2F" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Add / Edit Member Modal */}
      <Modal
        visible={isModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingIndex !== null ? 'Edit Family Member' : 'Add Family Member'}
              </Text>
              <TouchableOpacity
                onPress={() => setIsModalOpen(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>First Name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Maria"
                placeholderTextColor="#999"
                value={firstName}
                onChangeText={setFirstName}
                autoCapitalize="words"
              />

              <Text style={styles.inputLabel}>Last Name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Dela Cruz"
                placeholderTextColor="#999"
                value={lastName}
                onChangeText={setLastName}
                autoCapitalize="words"
              />

              <Text style={styles.inputLabel}>Relationship to Household Head</Text>
              <View style={styles.relationshipGrid}>
                {RELATIONSHIP_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.relationshipChip,
                      relationship === opt && { backgroundColor: accentColor, borderColor: accentColor },
                    ]}
                    onPress={() => setRelationship(opt)}
                  >
                    <Text
                      style={[
                        styles.relationshipChipText,
                        relationship === opt && { color: '#FFF', fontWeight: 'bold' },
                      ]}
                    >
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Date of Birth (MM-DD-YYYY) & Gender */}
              <View style={styles.rowTwoCols}>
                <View style={{ flex: 1.2, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Date of Birth (MM-DD-YYYY) *</Text>
                  <View style={[styles.dateInputWrapper, dobError ? styles.dateInputWrapperError : null]}>
                    <TextInput
                      style={styles.dateInput}
                      placeholder="mm-dd-yyyy"
                      placeholderTextColor="#999"
                      keyboardType="numeric"
                      maxLength={10}
                      value={dateOfBirth}
                      onChangeText={(text) => {
                        const formatted = formatDateInput(text);
                        setDateOfBirth(formatted);
                        if (formatted.length === 10) {
                          const res = validateDateOfBirth(formatted);
                          setDobError(res.valid ? null : res.error || null);
                        } else {
                          setDobError(null);
                        }
                      }}
                      onBlur={() => {
                        if (dateOfBirth.length > 0) {
                          const res = validateDateOfBirth(dateOfBirth);
                          setDobError(res.valid ? null : res.error || null);
                        }
                      }}
                    />
                    <TouchableOpacity
                      style={styles.calendarIconBtn}
                      onPress={() => setShowDatePicker(true)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="calendar-outline" size={20} color={accentColor} />
                    </TouchableOpacity>
                  </View>
                  {dobError ? (
                    <Text style={styles.fieldErrorText}>{dobError}</Text>
                  ) : currentMemberAge !== null ? (
                    <Text style={styles.fieldAgeHint}>Age: {currentMemberAge} yrs old</Text>
                  ) : null}
                </View>

                <View style={{ flex: 0.9, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Gender</Text>
                  <View style={styles.genderRow}>
                    {(['Male', 'Female'] as const).map((g) => (
                      <TouchableOpacity
                        key={g}
                        style={[
                          styles.genderBtn,
                          gender === g && { backgroundColor: accentColor, borderColor: accentColor },
                        ]}
                        onPress={() => setGender(g)}
                      >
                        <Text
                          style={[
                            styles.genderBtnText,
                            gender === g && { color: '#FFF', fontWeight: 'bold' },
                          ]}
                        >
                          {g}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {showDatePicker && (
                <DateTimePicker
                  value={selectedDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, date) => {
                    setShowDatePicker(Platform.OS === 'ios');
                    if (date) {
                      setSelectedDate(date);
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const day = String(date.getDate()).padStart(2, '0');
                      const year = date.getFullYear();
                      const formatted = `${month}-${day}-${year}`;
                      setDateOfBirth(formatted);
                      const res = validateDateOfBirth(formatted);
                      setDobError(res.valid ? null : res.error || null);
                    }
                  }}
                  maximumDate={new Date()}
                />
              )}

              {/* Priority / Vulnerabilities with Auto-Filtering */}
              <Text style={[styles.inputLabel, { marginTop: 14 }]}>
                Priority / Vulnerabilities (Optional)
              </Text>
              <View style={styles.vulnerabilitiesGrid}>
                {VULNERABILITY_OPTIONS.map((v) => {
                  const isChecked = vulnerabilities.includes(v.id);
                  const eligibility = getVulnerabilityEligibility(v.id, currentMemberAge, gender);
                  const isDisabled = !eligibility.eligible;

                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[
                        styles.vulnerabilityOption,
                        isChecked && { borderColor: accentColor, backgroundColor: '#E8F5E9' },
                        isDisabled && styles.vulnerabilityOptionDisabled,
                      ]}
                      onPress={() => toggleVulnerability(v.id)}
                      activeOpacity={isDisabled ? 0.9 : 0.7}
                    >
                      <Ionicons
                        name={isChecked ? 'checkbox' : isDisabled ? 'lock-closed-outline' : 'square-outline'}
                        size={18}
                        color={isChecked ? accentColor : isDisabled ? '#BDBDBD' : '#888'}
                      />
                      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text
                          style={[
                            styles.vulnerabilityOptionText,
                            isChecked && { color: accentColor, fontWeight: 'bold' },
                            isDisabled && styles.vulnerabilityOptionTextDisabled,
                          ]}
                        >
                          {v.label}
                        </Text>
                        {isDisabled && eligibility.hint ? (
                          <Text style={styles.vulnerabilityDisabledHint}>{eligibility.hint}</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsModalOpen(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: accentColor }]}
                  onPress={handleSaveMember}
                >
                  <Text style={styles.saveBtnText}>Save Member</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1B5E20',
  },
  subtitle: {
    fontSize: 12,
    color: '#616161',
    marginTop: 2,
    lineHeight: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 4,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#757575',
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 11,
    color: '#9E9E9E',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 15,
  },
  listContainer: {
    gap: 8,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#212121',
  },
  memberMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 3,
  },
  memberMetaBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2E7D32',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  memberMetaText: {
    fontSize: 11,
    color: '#757575',
  },
  vulnerabilityBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  vulnerabilityChip: {
    backgroundColor: '#FFF3E0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  vulnerabilityChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#E65100',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#F5F5F5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  modalContent: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 20 : 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#212121',
  },
  modalScroll: {
    padding: 20,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#424242',
    marginBottom: 6,
    marginTop: 10,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#212121',
    backgroundColor: '#FAFAFA',
  },
  relationshipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  relationshipChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#F5F5F5',
  },
  relationshipChipText: {
    fontSize: 12,
    color: '#424242',
  },
  rowTwoCols: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dateInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 8,
  },
  dateInputWrapperError: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFEBEE',
  },
  dateInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    fontSize: 13,
    color: '#212121',
  },
  calendarIconBtn: {
    padding: 6,
  },
  fieldErrorText: {
    fontSize: 10,
    color: '#D32F2F',
    marginTop: 3,
  },
  fieldAgeHint: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2E7D32',
    marginTop: 3,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 6,
  },
  genderBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D4D4D4',
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
  },
  genderBtnText: {
    fontSize: 13,
    color: '#424242',
  },
  vulnerabilitiesGrid: {
    gap: 8,
    marginBottom: 20,
  },
  vulnerabilityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    gap: 8,
  },
  vulnerabilityOptionDisabled: {
    backgroundColor: '#F5F5F5',
    borderColor: '#EEEEEE',
    opacity: 0.6,
  },
  vulnerabilityOptionText: {
    fontSize: 13,
    color: '#424242',
  },
  vulnerabilityOptionTextDisabled: {
    color: '#9E9E9E',
  },
  vulnerabilityDisabledHint: {
    fontSize: 10,
    color: '#9E9E9E',
    fontStyle: 'italic',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#616161',
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
});

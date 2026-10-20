import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface HouseholdMemberItem {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
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
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [vulnerabilities, setVulnerabilities] = useState<string[]>([]);

  const openAddModal = () => {
    setEditingIndex(null);
    setFirstName('');
    setLastName('');
    setRelationship('Child');
    setBirthYear('');
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
    setBirthYear(item.birthYear ? String(item.birthYear) : '');
    setGender(item.gender || 'Male');
    setVulnerabilities(item.vulnerabilities || []);
    setIsModalOpen(true);
  };

  const handleSaveMember = () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();

    if (!trimmedFirst) {
      Alert.alert('Required Field', 'Please enter the member\'s first name.');
      return;
    }
    if (!trimmedLast) {
      Alert.alert('Required Field', 'Please enter the member\'s last name.');
      return;
    }

    const memberData: HouseholdMemberItem = {
      id: editingIndex !== null ? members[editingIndex].id : Date.now().toString(),
      firstName: trimmedFirst,
      lastName: trimmedLast,
      relationship,
      birthYear: birthYear.trim() || undefined,
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
    setVulnerabilities((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

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
          {members.map((member, index) => (
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
                  {member.birthYear ? (
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
          ))}
        </View>
      )}

      {/* Add / Edit Member Modal */}
      <Modal visible={isModalOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingIndex !== null ? 'Edit Family Member' : 'Add Household Member'}
              </Text>
              <TouchableOpacity onPress={() => setIsModalOpen(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalScroll}>
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

              <View style={styles.rowTwoCols}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Birth Year</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. 1995"
                    placeholderTextColor="#999"
                    keyboardType="numeric"
                    maxLength={4}
                    value={birthYear}
                    onChangeText={setBirthYear}
                  />
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
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

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>
                Priority / Vulnerabilities (Optional)
              </Text>
              <View style={styles.vulnerabilitiesGrid}>
                {VULNERABILITY_OPTIONS.map((v) => {
                  const isChecked = vulnerabilities.includes(v.id);
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[
                        styles.vulnerabilityOption,
                        isChecked && { borderColor: accentColor, backgroundColor: '#E8F5E9' },
                      ]}
                      onPress={() => toggleVulnerability(v.id)}
                    >
                      <Ionicons
                        name={isChecked ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={isChecked ? accentColor : '#888'}
                      />
                      <Text
                        style={[
                          styles.vulnerabilityOptionText,
                          isChecked && { color: accentColor, fontWeight: 'bold' },
                        ]}
                      >
                        {v.label}
                      </Text>
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
                  <Text style={styles.saveBtnText}>
                    {editingIndex !== null ? 'Save Changes' : 'Add Member'}
                  </Text>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#212121',
  },
  subtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
    lineHeight: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 4,
  },
  addButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    padding: 20,
    backgroundColor: '#F9FBE7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E7D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#424242',
    marginTop: 6,
  },
  emptySubtext: {
    fontSize: 12,
    color: '#757575',
    textAlign: 'center',
    marginTop: 2,
    maxWidth: 280,
  },
  listContainer: {
    gap: 8,
    marginTop: 4,
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    gap: 12,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 2,
    flexWrap: 'wrap',
    gap: 6,
  },
  memberMetaBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2E7D32',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 6,
    paddingVertical: 1,
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
    paddingVertical: 1,
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
    gap: 6,
  },
  actionBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#F5F5F5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingTop: 16,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
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
    fontSize: 13,
    fontWeight: '600',
    color: '#424242',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#D4D4D4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: '#212121',
    backgroundColor: '#FAFAFA',
    marginBottom: 12,
  },
  relationshipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  relationshipChip: {
    paddingHorizontal: 12,
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
    alignItems: 'center',
  },
  genderRow: {
    flexDirection: 'row',
    gap: 6,
  },
  genderBtn: {
    flex: 1,
    paddingVertical: 9,
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
  vulnerabilityOptionText: {
    fontSize: 13,
    color: '#424242',
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

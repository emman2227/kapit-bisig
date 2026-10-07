/**
 * ID normalization and validation helpers used by registration flows.
 */

export const SUPPORTED_ID_TYPES = [
  'PhilSys ID',
  'Philippine National ID', // Compatibility alias
  "Driver's License",
  'Passport',
  'SSS ID',
  'PhilHealth ID',
  "Voter's ID",
] as const;

export type SupportedIdType = (typeof SUPPORTED_ID_TYPES)[number];

export const ASSISTED_ID_TYPES = [
  'Barangay Certification',
  'Certificate of Indigency',
  'Tribal / NCIP Endorsement',
  'STAFF_ATTESTATION',
] as const;

export type AssistedIdType = (typeof ASSISTED_ID_TYPES)[number];

export const ALL_VALID_ID_TYPES = [
  ...SUPPORTED_ID_TYPES,
  ...ASSISTED_ID_TYPES,
] as const;

export type AllValidIdType = (typeof ALL_VALID_ID_TYPES)[number];

export function isAssistedIdType(idType: string): boolean {
  return ASSISTED_ID_TYPES.includes(idType as AssistedIdType);
}

function normalizeForGeneric(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeIdNumber(idType: string, idNumber: string): string {
  const normalizedType = String(idType || '').trim();
  const raw = String(idNumber || '').trim().toUpperCase();

  switch (normalizedType) {
    case 'PhilSys ID':
    case 'Philippine National ID':
    case 'SSS ID':
    case 'PhilHealth ID':
      return raw.replace(/\D/g, '');
    case "Driver's License":
    case "Voter's ID":
    case 'Passport':
      return raw.replace(/[^A-Z0-9]/g, '');
    default:
      return normalizeForGeneric(raw);
  }
}

export function validateIdType(idType: string, allowAssisted = false): boolean {
  if (allowAssisted) {
    return ALL_VALID_ID_TYPES.includes(idType as AllValidIdType);
  }
  return SUPPORTED_ID_TYPES.includes(idType as SupportedIdType);
}

export function validateIdNumberFormat(idType: string, idNumber: string): boolean {
  if (isAssistedIdType(idType)) {
    return true;
  }

  const normalized = normalizeIdNumber(idType, idNumber);

  switch (idType) {
    case 'PhilSys ID':
    case 'Philippine National ID':
      return /^(?:\d{12}|\d{16})$/.test(normalized);
    case "Driver's License":
      return /^[A-Z]\d{10}$/.test(normalized);
    case 'Passport':
      return /^[A-Z]\d{7}$/.test(normalized);
    case 'SSS ID':
      return /^\d{10}$/.test(normalized);
    case 'PhilHealth ID':
      return /^\d{12}$/.test(normalized);
    case "Voter's ID":
      return /^[A-Z0-9]{6,25}$/.test(normalized);
    default:
      return false;
  }
}

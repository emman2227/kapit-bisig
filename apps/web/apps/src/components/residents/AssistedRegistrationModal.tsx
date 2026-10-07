'use client';

import React, { useState } from 'react';
import {
  X,
  User,
  MapPin,
  CreditCard,
  Camera,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Upload,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import api, { BARANGAY_OPTIONS } from '@/lib/api';

const STANDARD_ID_TYPES = [
  'PhilSys ID',
  "Driver's License",
  'Passport',
  'SSS ID',
  'PhilHealth ID',
  "Voter's ID",
];

const ALTERNATIVE_ID_TYPES = [
  { value: 'STAFF_ATTESTATION', label: 'Staff Attestation (No Physical ID)' },
  { value: 'Barangay Certification', label: 'Barangay Certification' },
  { value: 'Certificate of Indigency', label: 'Certificate of Indigency' },
  { value: 'Tribal / NCIP Endorsement', label: 'Tribal / NCIP Endorsement' },
];

interface AssistedRegistrationModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (residentCode: string) => void;
}

export default function AssistedRegistrationModal({
  open,
  onClose,
  onSuccess,
}: AssistedRegistrationModalProps) {
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Personal Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');
  const [hasPhone, setHasPhone] = useState(false);
  const [mobileNumber, setMobileNumber] = useState('');
  const [email, setEmail] = useState('');

  // Step 2: Address
  const [barangay, setBarangay] = useState<string>(BARANGAY_OPTIONS[0]);
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('Antipolo');
  const [householdSize, setHouseholdSize] = useState('1');

  // Step 3: Identification
  const [idType, setIdType] = useState<string>('STAFF_ATTESTATION');
  const [idNumber, setIdNumber] = useState('');
  const [frontIdImage, setFrontIdImage] = useState<string>('');
  const [backIdImage, setBackIdImage] = useState<string>('');
  const [attestationReason, setAttestationReason] = useState(
    'Resident lacks formal civil registration or government ID (elderly / indigent / indigenous resident).'
  );

  // Step 4: Face Photo
  const [faceImage, setFaceImage] = useState<string>('');

  // State
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!open) return null;

  const resetForm = () => {
    setCurrentStep(1);
    setFirstName('');
    setLastName('');
    setDateOfBirth('');
    setGender('Male');
    setHasPhone(false);
    setMobileNumber('');
    setEmail('');
    setBarangay(BARANGAY_OPTIONS[0]);
    setStreetAddress('');
    setCity('Antipolo');
    setHouseholdSize('1');
    setIdType('STAFF_ATTESTATION');
    setIdNumber('');
    setFrontIdImage('');
    setBackIdImage('');
    setAttestationReason(
      'Resident lacks formal civil registration or government ID (elderly / indigent / indigenous resident).'
    );
    setFaceImage('');
    setErrorMsg('');
    setSubmitting(false);
  };

  const handleModalClose = () => {
    resetForm();
    onClose();
  };

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (base64: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select a valid image file (JPG, PNG, WebP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Image size must be less than 5MB.');
      return;
    }

    setErrorMsg('');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setter(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const validateStep = (step: number): boolean => {
    setErrorMsg('');

    if (step === 1) {
      if (!firstName.trim() || !lastName.trim()) {
        setErrorMsg('First name and last name are required.');
        return false;
      }
      if (!dateOfBirth) {
        setErrorMsg('Date of birth is required.');
        return false;
      }
      if (hasPhone) {
        const clean = mobileNumber.replace(/\D/g, '');
        if (!/^09\d{9}$/.test(clean) && !/^9\d{9}$/.test(clean)) {
          setErrorMsg('Please enter a valid Philippine mobile number (09XXXXXXXXX).');
          return false;
        }
      }
      return true;
    }

    if (step === 2) {
      if (!streetAddress.trim()) {
        setErrorMsg('Street address is required.');
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (idType === 'STAFF_ATTESTATION') {
        if (!attestationReason.trim()) {
          setErrorMsg('Attestation reason is required for residents without government ID.');
          return false;
        }
      } else {
        if (!idNumber.trim()) {
          setErrorMsg('ID number is required for the chosen ID type.');
          return false;
        }
      }
      return true;
    }

    if (step === 4) {
      if (!faceImage) {
        setErrorMsg('Face photo is mandatory for biometric authentication.');
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 5));
    }
  };

  const handleBack = () => {
    setErrorMsg('');
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) {
      setCurrentStep(4);
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    const payload: Record<string, unknown> = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dateOfBirth,
      gender,
      mobileNumber: hasPhone && mobileNumber.trim() ? mobileNumber.trim() : undefined,
      email: email.trim() ? email.trim() : undefined,
      barangay,
      streetAddress: streetAddress.trim(),
      city: city.trim() || 'Antipolo',
      householdSize: parseInt(householdSize, 10) || 1,
      idType,
      idNumber: idType !== 'STAFF_ATTESTATION' ? idNumber.trim() : undefined,
      frontIdImage: frontIdImage || undefined,
      backIdImage: backIdImage || undefined,
      faceImage,
      attestationReason: idType === 'STAFF_ATTESTATION' ? attestationReason.trim() : undefined,
    };

    try {
      const response = await api.submitAssistedRegistration(payload);
      setSubmitting(false);

      if (!response.success) {
        setErrorMsg(response.message || 'Registration failed.');
        return;
      }

      const generatedCode = response.data?.residentCode || 'Generated';
      resetForm();
      onSuccess(generatedCode);
    } catch (err: any) {
      setSubmitting(false);
      setErrorMsg(err.message || 'Network error occurred during registration.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-md">
                Walk-In Registration
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">Step {currentStep} of 5</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">
              Assisted Resident Registration
            </h2>
          </div>
          <button
            onClick={handleModalClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5">
          <div
            className="bg-emerald-600 h-1.5 transition-all duration-300 ease-out"
            style={{ width: `${(currentStep / 5) * 100}%` }}
          />
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center gap-3 text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Body Form */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* STEP 1: Personal Info */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                <User className="w-4 h-4 text-emerald-600" />
                <span>Personal Information</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter beneficiary identity details. Mobile phone is optional for assisted walk-ins.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Maria"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Santos"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date of Birth *
                  </label>
                  <input
                    type="date"
                    required
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Gender *
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as 'Male' | 'Female')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
              </div>

              {/* Mobile Phone Checkbox */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasPhone}
                    onChange={(e) => setHasPhone(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Beneficiary has a mobile phone number
                  </span>
                </label>

                {hasPhone ? (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Mobile Number (09XXXXXXXXX) *
                    </label>
                    <input
                      type="tel"
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(e.target.value)}
                      placeholder="09171234567"
                      maxLength={11}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="mt-3 p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/40 rounded-lg text-xs text-emerald-800 dark:text-emerald-300">
                    <strong>No mobile number required.</strong> The resident will receive a unique Resident Code (e.g. SJ-2026-000042) to identify themselves during distribution and staff assistance.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="resident@example.com"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Address */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                <MapPin className="w-4 h-4 text-emerald-600" />
                <span>Barangay & Address</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Location information ensures proper barangay relief scoping and distribution entitlement.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Barangay *
                </label>
                <select
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  {BARANGAY_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Street Address / Sitio *
                </label>
                <textarea
                  rows={2}
                  required
                  value={streetAddress}
                  onChange={(e) => setStreetAddress(e.target.value)}
                  placeholder="House #, Street, Sitio, Purok..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    City / Municipality
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Antipolo"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Household Size
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={householdSize}
                    onChange={(e) => setHouseholdSize(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Identification */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                <span>Identification Documents</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select document type. For indigent, tribal, or undocumented residents, use Staff Attestation.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ID / Document Type *
                </label>
                <select
                  value={idType}
                  onChange={(e) => setIdType(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-medium"
                >
                  <optgroup label="Alternative / Assisted (No Government ID)">
                    {ALTERNATIVE_ID_TYPES.map((alt) => (
                      <option key={alt.value} value={alt.value}>
                        {alt.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Standard Government IDs">
                    {STANDARD_ID_TYPES.map((std) => (
                      <option key={std} value={std}>
                        {std}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {idType === 'STAFF_ATTESTATION' ? (
                <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200 font-semibold text-sm">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <span>Staff Attestation Mode Active</span>
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    A surrogate ID number (<code className="font-mono bg-emerald-100/80 dark:bg-emerald-900/60 px-1 py-0.5 rounded">ATTEST-SJ-2026-XXXXXX</code>) will automatically be generated upon registration. No physical government card or document photo upload is required.
                  </p>

                  <div>
                    <label className="block text-xs font-medium text-emerald-900 dark:text-emerald-200 mb-1">
                      Attestation Reason / Justification *
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={attestationReason}
                      onChange={(e) => setAttestationReason(e.target.value)}
                      placeholder="e.g. Elderly indigent resident without documents, indigenous family, etc."
                      className="w-full px-3 py-2 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      ID Number *
                    </label>
                    <input
                      type="text"
                      required
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      placeholder="Enter ID number"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Front ID Photo (Optional)
                      </label>
                      <label className="flex flex-col items-center justify-center p-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-emerald-500 cursor-pointer bg-slate-50 dark:bg-slate-800/50 transition-colors">
                        <Upload className="w-5 h-5 text-slate-400 mb-1" />
                        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                          {frontIdImage ? 'Change Front Photo' : 'Upload Front'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileUpload(e, setFrontIdImage)}
                        />
                      </label>
                      {frontIdImage && (
                        <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Front photo attached
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                        Back ID Photo (Optional)
                      </label>
                      <label className="flex flex-col items-center justify-center p-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg hover:border-emerald-500 cursor-pointer bg-slate-50 dark:bg-slate-800/50 transition-colors">
                        <Upload className="w-5 h-5 text-slate-400 mb-1" />
                        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                          {backIdImage ? 'Change Back Photo' : 'Upload Back'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileUpload(e, setBackIdImage)}
                        />
                      </label>
                      {backIdImage && (
                        <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Back photo attached
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Face Photo (Mandatory) */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                <Camera className="w-4 h-4 text-emerald-600" />
                <span>Beneficiary Face Photo</span>
              </div>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" />
                <span>
                  <strong>Face scan is mandatory for all registrations.</strong> This provides biometrics for duplicate prevention and secure QR verification at relief relief distribution sites.
                </span>
              </div>

              <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40">
                {faceImage ? (
                  <div className="flex flex-col items-center space-y-3">
                    <img
                      src={faceImage}
                      alt="Beneficiary Face"
                      className="w-36 h-36 rounded-full object-cover border-4 border-emerald-500 shadow-md"
                    />
                    <label className="px-4 py-1.5 text-xs font-medium bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-full cursor-pointer transition-colors">
                      Change Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFileUpload(e, setFaceImage)}
                      />
                    </label>
                  </div>
                ) : (
                  <label className="flex flex-col items-center cursor-pointer space-y-3">
                    <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                      <Camera className="w-10 h-10" />
                    </div>
                    <div className="text-center">
                      <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        Upload or Take Face Photo
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">JPG, PNG, or WebP up to 5MB</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, setFaceImage)}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: Review & Submit */}
          {currentStep === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Review & Confirm Registration</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Please verify beneficiary information before generating their resident profile.
              </p>

              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 text-xs">
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">Full Name</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {firstName} {lastName}
                  </span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">Date of Birth</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{dateOfBirth}</span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">Gender</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{gender}</span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">Mobile Number</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {hasPhone && mobileNumber ? mobileNumber : 'None (Walk-In Assisted)'}
                  </span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">Barangay</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{barangay}</span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">Address</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{streetAddress}</span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">ID Type</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {idType === 'STAFF_ATTESTATION' ? 'Staff Attestation (No Physical ID)' : idType}
                  </span>
                </div>
                <div className="flex justify-between p-3">
                  <span className="text-slate-500 dark:text-slate-400">ID Number</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {idType === 'STAFF_ATTESTATION' ? 'Auto-generated Surrogate ID' : idNumber}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3">
                  <span className="text-slate-500 dark:text-slate-400">Face Photo</span>
                  {faceImage ? (
                    <div className="flex items-center gap-2">
                      <img src={faceImage} alt="Face" className="w-7 h-7 rounded-full object-cover" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">Ready ✓</span>
                    </div>
                  ) : (
                    <span className="text-red-500 font-medium">Missing ✗</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <div />
          )}

          {currentStep < 5 ? (
            <button
              type="button"
              onClick={handleNext}
              className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !faceImage}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm hover:shadow transition-all disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Registering...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Complete Registration
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

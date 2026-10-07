'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Video,
  RefreshCw,
} from 'lucide-react';
import api, { BARANGAY_OPTIONS } from '@/lib/api';
import SelectDropdown from '@/components/ui/SelectDropdown';
import ConfirmModal from '@/components/ui/ConfirmModal';

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

const BARANGAY_DROPDOWN_OPTIONS = BARANGAY_OPTIONS.map((b) => ({
  value: b,
  label: b,
}));

const ID_TYPE_OPTIONS = [
  // Alternative / Assisted
  { value: 'STAFF_ATTESTATION', label: 'Staff Attestation (No Physical ID)' },
  { value: 'Barangay Certification', label: 'Barangay Certification' },
  { value: 'Certificate of Indigency', label: 'Certificate of Indigency' },
  { value: 'Tribal / NCIP Endorsement', label: 'Tribal / NCIP Endorsement' },
  // Standard Government IDs
  { value: 'PhilSys ID', label: 'PhilSys ID (National ID)' },
  { value: "Driver's License", label: "Driver's License (LTO)" },
  { value: 'Passport', label: 'Philippine Passport (DFA)' },
  { value: 'SSS ID', label: 'SSS / UMID Card' },
  { value: 'PhilHealth ID', label: 'PhilHealth ID Card' },
  { value: "Voter's ID", label: "Voter's ID / COMELEC Certification" },
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

  // Step 4: Face Photo & Webcam
  const [faceImage, setFaceImage] = useState<string>('');
  const [cameraMode, setCameraMode] = useState<'webcam' | 'upload'>('webcam');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // UI States
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Reset form
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
    stopCamera();
  };

  // Check if form has data entered
  const hasUnsavedChanges = useMemo(() => {
    return (
      currentStep > 1 ||
      firstName.trim().length > 0 ||
      lastName.trim().length > 0 ||
      dateOfBirth.length > 0 ||
      streetAddress.trim().length > 0 ||
      faceImage.length > 0 ||
      frontIdImage.length > 0 ||
      mobileNumber.trim().length > 0
    );
  }, [
    currentStep,
    firstName,
    lastName,
    dateOfBirth,
    streetAddress,
    faceImage,
    frontIdImage,
    mobileNumber,
  ]);

  const handleRequestClose = () => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      stopCamera();
      resetForm();
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmClose(false);
    stopCamera();
    resetForm();
    onClose();
  };

  // Webcam Controls
  const startCamera = async () => {
    setCameraError('');
    setCameraLoading(true);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Webcam is not supported on this browser or requires HTTPS.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 640 },
          facingMode: 'user',
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setCameraActive(true);
    } catch (err: any) {
      console.warn('[AssistedRegistration] Camera access error:', err);
      setCameraError(
        err.message || 'Cannot access webcam. Please check permissions or switch to file upload.'
      );
      setCameraActive(false);
    } finally {
      setCameraLoading(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraLoading(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const size = Math.min(video.videoWidth || 640, video.videoHeight || 640);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Center crop and mirror so it looks natural
    const sx = Math.max(0, ((video.videoWidth || 640) - size) / 2);
    const sy = Math.max(0, ((video.videoHeight || 640) - size) / 2);
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    const base64 = canvas.toDataURL('image/jpeg', 0.88);
    setFaceImage(base64);
    stopCamera();
  };

  // Stop camera when navigating away from Step 4
  useEffect(() => {
    if (currentStep !== 4 && cameraActive) {
      stopCamera();
    }
  }, [currentStep, cameraActive]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

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
        setErrorMsg('First and last name are required.');
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
        setErrorMsg('Face photo is mandatory for biometric authentication and relief security.');
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep === 4) {
        stopCamera();
      }
      setCurrentStep((prev) => Math.min(prev + 1, 5));
    }
  };

  const handleBack = () => {
    setErrorMsg('');
    if (currentStep === 4) {
      stopCamera();
    }
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
      email: email.trim() || undefined,
      barangay,
      streetAddress: streetAddress.trim(),
      city: city.trim() || 'Antipolo',
      householdSize: parseInt(householdSize, 10) || 1,
      idType,
      idNumber: idType !== 'STAFF_ATTESTATION' && idNumber.trim() ? idNumber.trim() : undefined,
      attestationReason:
        idType === 'STAFF_ATTESTATION'
          ? attestationReason.trim()
          : 'Self/Assisted physical document provided',
      faceImage,
      frontIdImage: frontIdImage || undefined,
      backIdImage: backIdImage || undefined,
    };

    try {
      const response = await api.submitAssistedRegistration(payload);
      setSubmitting(false);

      if (!response.success) {
        setErrorMsg(response.message || 'Registration failed. Please check the details.');
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

  if (!open || typeof document === 'undefined') return null;

  const modalContent = (
    <>
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={handleRequestClose}
        />

        {/* Modal Card */}
        <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
          {/* Top Brand Accent Line */}
          <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 overflow-hidden shrink-0">
            <div className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-[#0F533A] shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
          </div>

          {/* Header */}
          <div className="border-b border-gray-100 dark:border-slate-800 px-6 pt-5 pb-4 shrink-0 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[#0F533A] dark:text-emerald-400 text-[11px] font-bold uppercase tracking-wider border border-emerald-200/60 dark:border-emerald-800/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Walk-In Registration • Step {currentStep} of 5
                  </span>
                </div>
                <h3 className="mt-1.5 text-xl font-black text-gray-900 dark:text-slate-100 tracking-tight">
                  Assisted Resident Registration
                </h3>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                  Register walk-in beneficiaries without mobile phone or physical ID via staff verification.
                </p>
              </div>

              <button
                type="button"
                onClick={handleRequestClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stepper Dots / Pill Progress */}
            <div className="mt-4 flex items-center justify-between gap-1.5 pt-3 border-t border-gray-100 dark:border-slate-800">
              {[
                { step: 1, label: 'Personal' },
                { step: 2, label: 'Address' },
                { step: 3, label: 'Identity' },
                { step: 4, label: 'Biometrics' },
                { step: 5, label: 'Confirm' },
              ].map((item) => (
                <div key={item.step} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`h-1.5 w-full rounded-full transition-all duration-300 ${
                      item.step <= currentStep
                        ? 'bg-[#0F533A] dark:bg-emerald-500 shadow-sm shadow-emerald-900/20'
                        : 'bg-gray-200 dark:bg-slate-800'
                    }`}
                  />
                  <span
                    className={`text-[10px] font-bold ${
                      item.step === currentStep
                        ? 'text-[#0F533A] dark:text-emerald-400'
                        : item.step < currentStep
                        ? 'text-gray-700 dark:text-slate-300'
                        : 'text-gray-400 dark:text-slate-600'
                    }`}
                  >
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Error Alert */}
          {errorMsg && (
            <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-2xl flex items-center gap-3 text-xs text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form Body */}
          <div className="p-6 overflow-y-auto flex-1 space-y-5">
            {/* STEP 1: Personal Info */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-slate-100">
                  <User className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                  <span>Personal Information</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Enter beneficiary identity details. Mobile number is optional for assisted walk-ins.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="e.g. Maria"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="e.g. Santos"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Date of Birth <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Gender <span className="text-red-500">*</span>
                    </label>
                    <SelectDropdown
                      value={gender}
                      options={GENDER_OPTIONS}
                      onChange={(val) => setGender(val as 'Male' | 'Female')}
                      placeholder="Select Gender"
                    />
                  </div>
                </div>

                {/* Mobile Phone Checkbox */}
                <div className="pt-3 border-t border-gray-100 dark:border-slate-800">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasPhone}
                      onChange={(e) => setHasPhone(e.target.checked)}
                      className="w-4 h-4 rounded text-[#0F533A] focus:ring-[#0F533A] border-slate-300 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Beneficiary has an active mobile number
                    </span>
                  </label>

                  {hasPhone ? (
                    <div className="mt-3">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        Mobile Number (09XXXXXXXXX) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        placeholder="09171234567"
                        maxLength={11}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                      />
                    </div>
                  ) : (
                    <div className="mt-3 p-3 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/40 rounded-2xl text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                      <strong>No mobile number required.</strong> The resident will receive a unique Resident Code (e.g. <code>SJ-2026-000042</code>) to identify themselves during distribution and staff assistance.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Email Address (Optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="resident@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>
              </div>
            )}

            {/* STEP 2: Address */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-slate-100">
                  <MapPin className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                  <span>Barangay & Address</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Location details guarantee correct barangay allocation and relief scoping.
                </p>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Barangay <span className="text-red-500">*</span>
                  </label>
                  <SelectDropdown
                    value={barangay}
                    options={BARANGAY_DROPDOWN_OPTIONS}
                    onChange={(val) => setBarangay(val)}
                    placeholder="Select Barangay"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Street Address / Sitio / Purok <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                    placeholder="House #, Street name, Sitio, Purok..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Municipality / City
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Antipolo"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                      Household Members Count
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={householdSize}
                      onChange={(e) => setHouseholdSize(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Identification */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-slate-100">
                  <CreditCard className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                  <span>Document & Identification Verification</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Select document type. For indigent, tribal, or undocumented residents, use Staff Attestation.
                </p>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    ID / Document Type <span className="text-red-500">*</span>
                  </label>
                  <SelectDropdown
                    value={idType}
                    options={ID_TYPE_OPTIONS}
                    onChange={(val) => setIdType(val)}
                    placeholder="Select Document Type"
                  />
                </div>

                {idType === 'STAFF_ATTESTATION' ? (
                  <div className="p-4 bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl space-y-3">
                    <div className="flex items-center gap-2 text-[#0F533A] dark:text-emerald-300 font-bold text-xs uppercase tracking-wide">
                      <ShieldCheck className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                      <span>Staff Attestation Mode Active</span>
                    </div>
                    <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                      A surrogate ID number (<code>ATTEST-SJ-2026-XXXXXX</code>) will automatically be generated upon registration. No physical government card or document photo upload is required.
                    </p>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200 mb-1.5">
                        Attestation Reason / Justification <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={attestationReason}
                        onChange={(e) => setAttestationReason(e.target.value)}
                        placeholder="e.g. Elderly indigent resident without documents, indigenous family, fire evacuee..."
                        className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                        ID Number <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={idNumber}
                        onChange={(e) => setIdNumber(e.target.value)}
                        placeholder="Enter ID number"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                          Front ID Photo (Optional)
                        </label>
                        <label className="flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl hover:border-emerald-500 cursor-pointer bg-slate-50 dark:bg-slate-800/50 transition-colors">
                          <Upload className="w-5 h-5 text-slate-400 mb-1" />
                          <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">
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
                          <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Front photo attached
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                          Back ID Photo (Optional)
                        </label>
                        <label className="flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl hover:border-emerald-500 cursor-pointer bg-slate-50 dark:bg-slate-800/50 transition-colors">
                          <Upload className="w-5 h-5 text-slate-400 mb-1" />
                          <span className="text-xs text-slate-600 dark:text-slate-400 font-semibold">
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
                          <div className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Back photo attached
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: Face Photo (Mandatory Biometric) */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-slate-100">
                  <Camera className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                  <span>Beneficiary Face Biometrics</span>
                </div>

                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    <strong>Face capture is mandatory.</strong> This photo creates the resident&apos;s biometric profile for duplicate prevention and secure QR verification at relief relief sites.
                  </span>
                </div>

                {/* Webcam vs File Upload Switcher */}
                <div className="flex items-center justify-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl max-w-sm mx-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setCameraMode('webcam');
                      if (!faceImage && !cameraActive) startCamera();
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-xl transition-all ${
                      cameraMode === 'webcam'
                        ? 'bg-white dark:bg-slate-900 text-[#0F533A] dark:text-emerald-400 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800'
                    }`}
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Webcam Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCameraMode('upload');
                      stopCamera();
                    }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold rounded-xl transition-all ${
                      cameraMode === 'upload'
                        ? 'bg-white dark:bg-slate-900 text-[#0F533A] dark:text-emerald-400 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                  </button>
                </div>

                {cameraError && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{cameraError}</span>
                  </div>
                )}

                {/* Preview / Capture Area */}
                <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-3xl bg-slate-50/70 dark:bg-slate-800/40">
                  {faceImage ? (
                    <div className="flex flex-col items-center space-y-3">
                      <div className="relative">
                        <img
                          src={faceImage}
                          alt="Beneficiary Face"
                          className="w-44 h-44 rounded-full object-cover border-4 border-[#0F533A] shadow-xl"
                        />
                        <div className="absolute bottom-1 right-1 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        {cameraMode === 'webcam' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setFaceImage('');
                              startCamera();
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors shadow-xs"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Retake Photo
                          </button>
                        ) : (
                          <label className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 cursor-pointer transition-colors shadow-xs">
                            <Upload className="w-3.5 h-3.5" /> Change Photo File
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
                  ) : cameraMode === 'webcam' ? (
                    <div className="flex flex-col items-center space-y-4">
                      {cameraActive ? (
                        <>
                          <div className="relative w-56 h-56 rounded-full overflow-hidden border-4 border-[#0F533A] shadow-xl bg-black">
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-full object-cover scale-x-[-1]"
                            />
                            {/* Face Alignment Ring Overlay */}
                            <div className="pointer-events-none absolute inset-4 rounded-full border-2 border-dashed border-white/60 animate-pulse" />
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-slate-400 font-medium">
                            Position the resident&apos;s face inside the circle
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={capturePhoto}
                              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white text-xs font-bold shadow-md shadow-emerald-900/20 transition-all cursor-pointer"
                            >
                              <Camera className="w-4 h-4" />
                              <span>Capture Photo</span>
                            </button>
                            <button
                              type="button"
                              onClick={stopCamera}
                              className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-gray-600 dark:text-slate-300 hover:bg-gray-50 transition-colors"
                            >
                              Cancel Camera
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center space-y-3 py-4">
                          <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-[#0F533A] dark:text-emerald-400">
                            <Camera className="w-9 h-9" />
                          </div>
                          <div className="text-center">
                            <span className="text-sm font-bold text-gray-900 dark:text-slate-100">
                              LGU Staff Desk Webcam
                            </span>
                            <p className="text-xs text-gray-400 dark:text-slate-400 mt-0.5">
                              Snap frontal photo directly from laptop or desk camera
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={startCamera}
                            disabled={cameraLoading}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white text-xs font-bold shadow-md shadow-emerald-900/20 transition-all cursor-pointer disabled:opacity-50"
                          >
                            {cameraLoading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Video className="w-4 h-4" />
                            )}
                            <span>Start Webcam</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <label className="flex flex-col items-center cursor-pointer space-y-3 py-4">
                      <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-[#0F533A] dark:text-emerald-400">
                        <Upload className="w-8 h-8" />
                      </div>
                      <div className="text-center">
                        <span className="text-sm font-bold text-[#0F533A] dark:text-emerald-400">
                          Upload Resident Face Photo
                        </span>
                        <p className="text-xs text-gray-400 mt-0.5">JPG, PNG, or WebP up to 5MB</p>
                      </div>
                      <span className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition-colors">
                        Browse Files
                      </span>
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
                <div className="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-slate-100">
                  <CheckCircle2 className="w-4 h-4 text-[#0F533A] dark:text-emerald-400" />
                  <span>Review & Confirm Registration</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Please verify beneficiary details before generating their resident profile.
                </p>

                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-700 text-xs">
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Full Name</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {firstName} {lastName}
                    </span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Date of Birth</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{dateOfBirth}</span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Gender</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{gender}</span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Mobile Number</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {hasPhone && mobileNumber ? mobileNumber : 'None (Walk-In Assisted)'}
                    </span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Barangay</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{barangay}</span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Address</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{streetAddress}</span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Document / ID Type</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {idType === 'STAFF_ATTESTATION' ? 'Staff Attestation (No Physical ID)' : idType}
                    </span>
                  </div>
                  <div className="flex justify-between p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">ID Number</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {idType === 'STAFF_ATTESTATION' ? 'Auto-generated Surrogate ID' : idNumber}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Biometric Photo</span>
                    {faceImage ? (
                      <div className="flex items-center gap-2">
                        <img src={faceImage} alt="Face" className="w-8 h-8 rounded-full object-cover border border-emerald-500" />
                        <span className="text-[#0F533A] dark:text-emerald-400 font-bold">Ready ✓</span>
                      </div>
                    ) : (
                      <span className="text-red-500 font-bold">Missing ✗</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="border-t border-gray-100 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 flex items-center justify-between">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 shadow-xs flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRequestClose}
                className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-xs"
              >
                Cancel
              </button>
            )}

            {currentStep < 5 ? (
              <button
                type="button"
                onClick={handleNext}
                className="rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white px-5 py-2.5 text-sm font-bold shadow-md shadow-emerald-900/20 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !faceImage}
                className="rounded-xl bg-[#0F533A] hover:bg-[#0c4430] text-white px-6 py-2.5 text-sm font-bold shadow-md shadow-emerald-900/20 transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Registering…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Complete Registration</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal on Discard / Exit */}
      <ConfirmModal
        isOpen={showConfirmClose}
        title="Discard Assisted Registration?"
        body="Any resident details, documents, and biometric photos entered so far will be lost. Are you sure you want to exit?"
        confirmLabel="Yes, Discard"
        cancelLabel="Continue Editing"
        onConfirm={handleConfirmDiscard}
        onCancel={() => setShowConfirmClose(false)}
      />
    </>
  );

  return createPortal(modalContent, document.body);
}

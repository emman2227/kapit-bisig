'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Camera,
  Upload,
  RefreshCw,
  AlertCircle,
  FileText,
  User,
  ShieldAlert,
  CheckCircle2,
  Video,
  Loader2,
} from 'lucide-react'
import api, { ResidentRecord } from '@/lib/api'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { showToast } from '@/lib/toast'

const ID_TYPE_OPTIONS = [
  { value: 'STAFF_ATTESTATION', label: 'Staff Attestation (No Physical ID)' },
  { value: 'Barangay Certification', label: 'Barangay Certification' },
  { value: 'Certificate of Indigency', label: 'Certificate of Indigency' },
  { value: 'Tribal / NCIP Endorsement', label: 'Tribal / NCIP Endorsement' },
  { value: 'PhilSys ID', label: 'PhilSys ID (National ID)' },
  { value: "Driver's License", label: "Driver's License (LTO)" },
  { value: 'Passport', label: 'Philippine Passport (DFA)' },
  { value: 'SSS ID', label: 'SSS / UMID Card' },
  { value: 'PhilHealth ID', label: 'PhilHealth ID Card' },
  { value: "Voter's ID", label: "Voter's ID / COMELEC Certification" },
]

interface AssistedRevisionModalProps {
  isOpen: boolean
  resident: ResidentRecord | null
  onClose: () => void
  onSuccess: () => void
}

export default function AssistedRevisionModal({
  isOpen,
  resident,
  onClose,
  onSuccess,
}: AssistedRevisionModalProps) {
  const [idType, setIdType] = useState('STAFF_ATTESTATION')
  const [idNumber, setIdNumber] = useState('')
  const [attestationReason, setAttestationReason] = useState('')
  const [staffNote, setStaffNote] = useState('')

  // Replacement images
  const [faceImage, setFaceImage] = useState<string>('')
  const [frontIdImage, setFrontIdImage] = useState<string>('')
  const [backIdImage, setBackIdImage] = useState<string>('')

  // Webcam state
  const [activeCameraTarget, setActiveCameraTarget] = useState<'face' | 'frontId' | 'backId' | null>(null)
  const [cameraLoading, setCameraLoading] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [validatingFace, setValidatingFace] = useState(false)
  const [faceValidationError, setFaceValidationError] = useState<string | null>(null)
  const [videoReady, setVideoReady] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (resident) {
      setIdType(resident.idType || 'STAFF_ATTESTATION')
      setIdNumber(resident.idNumber || '')
      setAttestationReason(
        (resident as any).attestationReason ||
        (resident as any).metadata?.assistedRegistration?.attestationReason ||
        ''
      )
      setStaffNote('')
      setFaceImage('')
      setFrontIdImage('')
      setBackIdImage('')
      setErrorMsg('')
      setFaceValidationError(null)
      setValidatingFace(false)
    }
  }, [resident])

  // Stop camera helper
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setActiveCameraTarget(null)
    setCameraLoading(false)
    setVideoReady(false)
    setCameraError('')
  }

  // Close handler with cleanup
  const handleClose = () => {
    if (submitting) return
    stopCamera()
    onClose()
  }

  // Real-time Biometric Face Validation
  const validateFacePhoto = async (base64: string): Promise<boolean> => {
    setValidatingFace(true)
    setFaceValidationError(null)
    try {
      const res = await api.detectFace(
        base64,
        resident?.householdToken || resident?.mobileNumber || 'assisted-revision'
      )
      if (!res.has_face || !res.is_valid) {
        setFaceValidationError(
          res.message || 'Face validation failed. Please ensure face is centered, clearly visible, and not covered.'
        )
        setValidatingFace(false)
        return false
      }
      setFaceValidationError(null)
      setValidatingFace(false)
      return true
    } catch (err: any) {
      console.warn('[AssistedRevision] Face validation error:', err)
      setFaceValidationError(
        err.message || 'Face analysis failed. Please ensure the image is clear and try again.'
      )
      setValidatingFace(false)
      return false
    }
  }

  // Start webcam for a specific target
  const startCameraFor = async (target: 'face' | 'frontId' | 'backId') => {
    stopCamera()
    setActiveCameraTarget(target)
    setCameraLoading(true)
    setCameraError('')
    setFaceValidationError(null)
    setVideoReady(false)

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera access is not supported by your browser.')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: target === 'face' ? 'user' : 'environment',
        },
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
      }
      setCameraLoading(false)
      setVideoReady(true)
    } catch (err: any) {
      console.error('Camera error:', err)
      setCameraLoading(false)
      setCameraError(err.message || 'Unable to access camera device.')
    }
  }

  // Capture frame from webcam
  const capturePhoto = async () => {
    if (!videoRef.current || !activeCameraTarget || validatingFace) return
    try {
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)

      if (activeCameraTarget === 'face') {
        const isValid = await validateFacePhoto(dataUrl)
        if (!isValid) {
          // Keep camera active so staff can immediately adjust lighting/angle and retake!
          return
        }
        setFaceImage(dataUrl)
      } else if (activeCameraTarget === 'frontId') {
        setFrontIdImage(dataUrl)
      } else if (activeCameraTarget === 'backId') {
        setBackIdImage(dataUrl)
      }

      stopCamera()
    } catch (err: any) {
      console.error('Failed to capture frame:', err)
      setCameraError('Failed to capture snapshot. Please try again.')
    }
  }

  // File upload reader
  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'face' | 'frontId' | 'backId'
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setErrorMsg('Selected file must be an image (JPEG, PNG, or WebP).')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Image size must be less than 10MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = async (event) => {
      const result = event.target?.result as string
      if (target === 'face') {
        const isValid = await validateFacePhoto(result)
        if (isValid) {
          setFaceImage(result)
          setErrorMsg('')
        }
      } else if (target === 'frontId') {
        setFrontIdImage(result)
        setErrorMsg('')
      } else if (target === 'backId') {
        setBackIdImage(result)
        setErrorMsg('')
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resident) return

    const residentId = resident._id || resident.id
    if (!residentId) {
      setErrorMsg('Resident ID missing.')
      return
    }

    // At least one field should be provided for revision
    const hasAnyChange =
      faceImage ||
      frontIdImage ||
      backIdImage ||
      idType !== resident.idType ||
      idNumber !== resident.idNumber ||
      staffNote.trim() ||
      attestationReason.trim()

    if (!hasAnyChange) {
      setErrorMsg('Please update at least one photo, document, ID detail, or revision note before resubmitting.')
      return
    }

    setSubmitting(true)
    setErrorMsg('')

    try {
      const res = await api.submitAssistedRevision(residentId, {
        idType,
        idNumber,
        frontIdImage: frontIdImage || undefined,
        backIdImage: backIdImage || undefined,
        faceImage: faceImage || undefined,
        attestationReason: attestationReason.trim() || undefined,
        staffNote: staffNote.trim() || undefined,
      })

      if (res.success) {
        showToast.success('Walk-in revision submitted. Registration is now pending review.')
        stopCamera()
        onSuccess()
        onClose()
      } else {
        setErrorMsg(res.message || 'Failed to submit assisted revision.')
      }
    } catch (err: any) {
      console.error('Error submitting assisted revision:', err)
      setErrorMsg(err.message || 'Network error occurred while submitting revision.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen || !resident || typeof document === 'undefined') return null

  const residentName = resident.fullName || `${resident.firstName || ''} ${resident.lastName || ''}`.trim() || 'Resident'
  const isAttestation = idType === 'STAFF_ATTESTATION' || idType.toLowerCase().includes('certification') || idType.toLowerCase().includes('endorsement')

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900 dark:border dark:border-slate-800 z-10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
                Staff Assisted Revision
              </span>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {resident.residentCode || resident.householdToken || 'Walk-In'}
              </span>
              {resident.assistedByName && (
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Assisted by: {resident.assistedByName}
                </span>
              )}
            </div>
            <h2 className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">
              Revise Walk-In: {residentName}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Reason for Return Notice */}
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Return Note from Reviewer
                </p>
                <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                  {resident.rejectionReason || 'No specific return reason provided. Please verify resident documents and retake clear photos.'}
                </p>
              </div>
            </div>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/50 dark:bg-rose-950/30">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* Active Camera Viewport if Camera Open */}
          {activeCameraTarget && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900/40 dark:bg-indigo-950/20">
              <div className="flex items-center justify-between pb-3">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
                    Live Camera: Retaking {activeCameraTarget === 'face' ? 'Face Photo' : activeCameraTarget === 'frontId' ? 'Front ID' : 'Back ID'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={stopCamera}
                  disabled={validatingFace}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 disabled:opacity-50"
                >
                  Cancel Camera
                </button>
              </div>

              {activeCameraTarget === 'face' && faceValidationError && (
                <div className="mb-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2 animate-fadeIn">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-bold block text-rose-800 dark:text-rose-200">Face Check Issue</span>
                    <span className="text-[11px] leading-relaxed">{faceValidationError}</span>
                  </div>
                </div>
              )}

              {cameraError ? (
                <div className="p-4 text-center text-sm font-medium text-rose-600">{cameraError}</div>
              ) : (
                <div className={`relative mx-auto aspect-video max-w-md overflow-hidden rounded-xl bg-black border-2 transition-colors ${
                  activeCameraTarget === 'face' && faceValidationError ? 'border-rose-500' : 'border-transparent'
                }`}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                  {cameraLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-xs font-semibold">
                      Initializing camera...
                    </div>
                  )}
                  {validatingFace && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/65 backdrop-blur-xs text-white p-4 text-center z-10 animate-fadeIn">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-400 mb-2" />
                      <span className="text-xs font-bold uppercase tracking-wider">
                        Analyzing Face...
                      </span>
                      <span className="text-[10px] text-slate-300 mt-0.5">
                        Checking centering, quality & anti-spoofing
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={capturePhoto}
                  disabled={!videoReady || validatingFace}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white shadow-md transition-all hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {validatingFace ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Validating Face...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="h-4 w-4" />
                      <span>Snap Photo</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  disabled={validatingFace}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Section: Photos & Biometrics */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Camera className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Retake or Replace Registration Photos
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Face Selfie */}
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Face Photo</span>
                  {faceImage ? (
                    <span className="text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded dark:bg-emerald-950/40">
                      Replaced
                    </span>
                  ) : resident.faceImage ? (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded dark:bg-slate-800">
                      On file
                    </span>
                  ) : null}
                </div>

                <div className="aspect-square w-full rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center relative">
                  {validatingFace && !activeCameraTarget ? (
                    <div className="flex flex-col items-center justify-center p-3 text-center">
                      <Loader2 className="h-7 w-7 animate-spin text-indigo-600 mb-1" />
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Validating Photo...
                      </span>
                    </div>
                  ) : faceImage ? (
                    <img src={faceImage} alt="New Face" className="h-full w-full object-cover" />
                  ) : resident.faceImage ? (
                    <img src={resident.faceImage} alt="Current Face" className="h-full w-full object-cover opacity-80" />
                  ) : (
                    <User className="h-10 w-10 text-slate-400" />
                  )}
                </div>

                {faceValidationError && !activeCameraTarget && (
                  <div className="mt-2 p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg text-[11px] text-rose-700 dark:text-rose-300 flex items-start gap-1.5 animate-fadeIn">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600 mt-0.5" />
                    <span>{faceValidationError}</span>
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => startCameraFor('face')}
                    disabled={validatingFace}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Camera
                  </button>
                  <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, 'face')}
                    />
                  </label>
                </div>
              </div>

              {/* 2. Front ID */}
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Front ID Photo</span>
                  {frontIdImage ? (
                    <span className="text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded dark:bg-emerald-950/40">
                      Replaced
                    </span>
                  ) : resident.frontIdImage ? (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded dark:bg-slate-800">
                      On file
                    </span>
                  ) : null}
                </div>

                <div className="aspect-square w-full rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center relative">
                  {frontIdImage ? (
                    <img src={frontIdImage} alt="New Front ID" className="h-full w-full object-cover" />
                  ) : resident.frontIdImage ? (
                    <img src={resident.frontIdImage} alt="Current Front ID" className="h-full w-full object-cover opacity-80" />
                  ) : (
                    <FileText className="h-10 w-10 text-slate-400" />
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => startCameraFor('frontId')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Camera
                  </button>
                  <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, 'frontId')}
                    />
                  </label>
                </div>
              </div>

              {/* 3. Back ID */}
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Back ID (Optional)</span>
                  {backIdImage ? (
                    <span className="text-[10px] font-bold uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded dark:bg-emerald-950/40">
                      Replaced
                    </span>
                  ) : resident.backIdImage ? (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded dark:bg-slate-800">
                      On file
                    </span>
                  ) : null}
                </div>

                <div className="aspect-square w-full rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-800 flex items-center justify-center relative">
                  {backIdImage ? (
                    <img src={backIdImage} alt="New Back ID" className="h-full w-full object-cover" />
                  ) : resident.backIdImage ? (
                    <img src={resident.backIdImage} alt="Current Back ID" className="h-full w-full object-cover opacity-80" />
                  ) : (
                    <FileText className="h-10 w-10 text-slate-400" />
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => startCameraFor('backId')}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Camera
                  </button>
                  <label className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, 'backId')}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Section: Identification Details */}
          <div className="space-y-4 pt-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Identification Credentials
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  ID Type
                </label>
                <SelectDropdown
                  value={idType}
                  options={ID_TYPE_OPTIONS}
                  onChange={(val) => setIdType(val)}
                  placeholder="Select ID Type"
                />
              </div>

              {!isAttestation && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                    ID Number
                  </label>
                  <input
                    type="text"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="e.g. 1234-5678-9012"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  />
                </div>
              )}
            </div>

            {isAttestation && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Staff Attestation Justification
                </label>
                <textarea
                  rows={2}
                  value={attestationReason}
                  onChange={(e) => setAttestationReason(e.target.value)}
                  placeholder="Explain why the resident lacks physical government ID..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            )}
          </div>

          {/* Section: Staff Notes */}
          <div className="space-y-1.5 pt-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Staff Revision Summary / Audit Note
            </label>
            <textarea
              rows={3}
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              placeholder="Describe corrections made (e.g. 'Retook front ID photo due to glare; updated ID number and re-verified physical certificate')."
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
        </form>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Resubmission resets status to <span className="font-semibold text-amber-600 dark:text-amber-400">Pending Review</span> with zero auto-approval.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {submitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Update & Resubmit</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

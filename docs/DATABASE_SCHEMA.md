# Database Schema

This project uses MongoDB (via Mongoose). Main application data is in the `kapit-bisig` database.

## Core Collections

### `residents`
- Source model: `server/models/Resident.ts`
- Primary fields:
  - `residentCode` (unique, sparse)
  - `firstName`, `lastName`, `fullName`, `dateOfBirth`, `gender`
  - `mobileNumber`
  - `email`, `emailLower` (unique, sparse)
  - `password` (hashed, hidden in JSON)
  - `city`, `barangay`, `streetAddress`, `householdSize`
  - `vulnerableMembers[]`, `vulnerableCounts` (map)
  - `idType`, `idNumber` (unique), `frontIdImage`, `backIdImage`
  - `faceImage`, `faceDescriptor[512]`, `faceDescriptorMetadata`
  - `verification` (confidence, riskScore, isVerified, idCheckDecision, screeningConfidence, detectedIdType, typeMatch, idNumberMatch, ocrConfidence, qualityScore, warnings, riskFactors)
  - `status` (`Pending|Approved|Needs Revision|Rejected`), `rejectionReason`, `verifiedBy`, `verifiedAt`
  - `qrVersion`, `qrIssuedAt`, `qrStatus` (`ACTIVE|REVOKED`)
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ residentCode: 1 }` unique+sparse
  - `{ idNumber: 1 }` unique
  - `{ emailLower: 1 }` unique+sparse
  - `{ barangay: 1, createdAt: -1 }`
  - `{ status: 1, createdAt: -1 }`
  - `{ faceDescriptor: 1 }`
  - `{ qrStatus: 1 }`

### `face_registration_logs`
- Source: MongoDB collection managed by Python AI Service (`backend/main.py`)
- Primary fields:
  - `timestamp` (ISODate)
  - `client_ip` (string)
  - `action` (`ALLOW|BLOCK|ERROR`)
  - `reason` (string, e.g. "Duplicate face detected (similarity: 0.912)")
  - `matched_resident_id` (ObjectId ref `Resident`)
  - `device_info` (string)
  - `similarity_score` (number)
- Indexes:
  - `{ timestamp: -1 }`
  - `{ action: 1 }`
  - `{ matched_resident_id: 1 }`

### `householdtokens`
- Source model: `server/models/HouseholdToken.ts`
- Primary fields:
  - `tokenHash` (unique), `tokenPrefix`
  - `status` (`UNUSED|LOCKED|USED|EXPIRED`)
  - `lockedAt`, `lockedBy`, `lockExpiresAt`
  - `expiresAt`, `usedAt`
  - `usedBy.residentId` (ref `Resident`), `usedBy.ipAddress`, `usedBy.userAgent`
  - `duplicateBlockAttempts`, `duplicateBlockedAt`, `duplicateBlockedUntil`
  - `householdInfo.headOfHousehold`, `householdInfo.address`, `householdInfo.barangay`, `householdInfo.distributionId`, `householdInfo.expectedMembers`, `householdInfo.notes`
  - `issuedBy`, `issuedAt`, `version`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ tokenHash: 1 }` unique
  - `{ tokenPrefix: 1 }`
  - `{ status: 1 }`
  - `{ status: 1, expiresAt: 1 }`
  - `{ "householdInfo.barangay": 1, status: 1 }`
  - `{ lockedAt: 1, lockExpiresAt: 1 }`
  - `{ duplicateBlockedUntil: 1 }`
  - TTL: `{ expiresAt: 1 }`, `expireAfterSeconds: 604800`, partial for `status in [EXPIRED, USED]`

### `distributions`
- Source model: `server/models/Distribution.ts`
- Primary fields:
  - `barangay`
  - `assignedBarangays[]`
  - `assignedStaffIds[]` (ObjectId refs)
  - `scheduled` (string)
  - `households` (number)
  - `notes`
  - `status` (`Unclaimed|Partially Claimed|Claimed`)
  - `claimedAt`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ barangay: 1, createdAt: -1 }`
  - `{ status: 1, createdAt: -1 }`
  - `{ assignedStaffIds: 1, createdAt: -1 }`

### `distributionclaims`
- Source model: `server/models/DistributionClaim.ts`
- Primary fields:
  - `distributionId` (ObjectId ref `Distribution`)
  - `householdId` (ObjectId ref `Resident`)
  - `claimedAt`
  - `claimedBy.id`, `claimedBy.name`
  - `proofMethod` (`QR|FACE|null`)
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ distributionId: 1 }`
  - `{ householdId: 1 }`
  - `{ distributionId: 1, householdId: 1 }` unique

### `claims`
- Source model: `server/models/Claim.ts`
- Primary fields:
  - `claimId` (unique)
  - `householdId`, `residentId`, `householdCode`
  - `barangay`, `distributionId`, `distributionSite`
  - `staffUserId`, `staffName`
  - `claimCategory` (`DISTRIBUTION|DISASTER_EVENT`)
  - `claimStatus` (`Not Claimed|Claimed`)
  - `disasterEventId`
  - `scannedBy`, `scannedAt`
  - `source` (`ONLINE|OFFLINE_SYNC`)
  - `syncMetadata.deviceId`, `syncMetadata.clientGeneratedId`, `syncMetadata.offlineCapturedAt`, `syncMetadata.syncedAt`
  - `status` (`PENDING_CHAIN|CHAIN_SUBMITTED|CONFIRMED|CHAIN_FAILED`)
  - `blockchain.txHash`, `blockchain.blockNumber`, `blockchain.chainId`, `blockchain.contractAddress`, `blockchain.householdHash`, `blockchain.eventHash`, `blockchain.staffSigner`
  - `errorMessage`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ claimId: 1 }` unique
  - `{ householdId: 1 }`
  - `{ residentId: 1 }`
  - `{ barangay: 1 }`
  - `{ status: 1 }`
  - `{ householdId: 1, distributionId: 1 }` unique
  - `{ claimCategory: 1, disasterEventId: 1, residentId: 1 }`

### `disasterevents`
- Source model: `server/models/DisasterEvent.ts`
- Primary fields:
  - `name`, `disasterType`, `description`
  - `barangays[]`
  - `eventDate`, `submissionDeadline`
  - `status` (`Draft|Active|Closed`)
  - `createdBy`, `updatedBy`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ status: 1, eventDate: -1 }`
  - `{ barangays: 1, status: 1, eventDate: -1 }`

### `proofsubmissions`
- Source model: `server/models/ProofSubmission.ts`
- Primary fields:
  - `residentId` (ref `Resident`)
  - `disasterEventId` (ref `DisasterEvent`)
  - `damageType`, `description`, `supportingInfo`
  - `dateSubmitted`, `photoProofUrl`
  - `status` (`Pending Sync|Pending Verification|Approved|Rejected`)
  - `syncSource` (`ONLINE|OFFLINE_SYNC`)
  - `submissionVersion`
  - `clientGeneratedId`, `submittedViaDeviceId`
  - `rejectionReason`, `reviewedBy`, `reviewedAt`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ residentId: 1, disasterEventId: 1 }` unique
  - `{ disasterEventId: 1, status: 1, createdAt: -1 }`

### `beneficiaryeligibilities`
- Source model: `server/models/BeneficiaryEligibility.ts`
- Primary fields:
  - `residentId` (ref `Resident`)
  - `disasterEventId` (ref `DisasterEvent`)
  - `proofSubmissionId` (ref `ProofSubmission`)
  - `status` (`Eligible|Not Eligible`)
  - `registrationStatus`, `proofStatus`
  - `rejectionReason`, `reviewedBy`, `reviewedAt`, `lastQualifiedAt`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ residentId: 1, disasterEventId: 1 }` unique
  - `{ disasterEventId: 1, status: 1 }`

### `offlinesyncqueues`
- Source model: `server/models/OfflineSyncQueue.ts`
- Primary fields:
  - `queueType` (`PROOF_SUBMISSION|CLAIM`)
  - `syncStatus` (`Pending|Processing|Synced|Failed`)
  - `actorId`, `actorRole`
  - `residentId`, `disasterEventId`
  - `proofSubmissionId`, `claimMongoId`, `claimId`
  - `clientGeneratedId`, `deviceId`
  - `payload`, `errorMessage`, `syncedAt`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ actorId: 1, queueType: 1, clientGeneratedId: 1 }` unique
  - `{ disasterEventId: 1, queueType: 1, syncStatus: 1 }`

## Auth and User Collections

### `staffusers`
- Source model: `server/models/StaffUser.ts`
- Primary fields:
  - `email`, `emailLower` (unique), `passwordHash`
  - `forcePasswordReset`
  - `firstName`, `lastName`, `avatarUrl`
  - `role` (`LGU_STAFF`)
  - `assignedBarangays[]`
  - `isActive`, `emailVerified`, `lastOtpVerifiedAt`, `lastLoginAt`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ emailLower: 1 }` unique
  - `{ role: 1, isActive: 1 }`
  - `{ assignedBarangays: 1, isActive: 1 }`
  - `{ firstName: 1, lastName: 1 }`

### `users`
- Source model: `server/models/User.ts`
- Primary fields:
  - `email` (unique), `password` (hashed, hidden in JSON)
  - `firstName`, `lastName`
  - `role` (`Admin|Staff|Volunteer`)
  - `status` (`Active|Inactive|Suspended`)
  - `barangay`, `phoneNumber`, `lastLogin`
  - `createdBy` (ObjectId ref `User`)
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ email: 1 }` unique (from field constraint)

### `passwordresetotps`
- Source model: `server/models/PasswordResetOtp.ts`
- Primary fields:
  - `userId` (ObjectId ref `StaffUser`)
  - `emailLower`, `otpHash`, `expiresAt`, `attemptsLeft`, `createdAt`, `lastSentAt`
- Indexes:
  - `{ emailLower: 1 }`
  - `{ userId: 1 }`
  - TTL: `{ expiresAt: 1 }`, `expireAfterSeconds: 0`

### `residentpasswordresetotps`
- Source model: `server/models/ResidentPasswordResetOtp.ts`
- Primary fields:
  - `residentId` (ObjectId ref `Resident`)
  - `emailLower`, `otpHash`, `expiresAt`, `attemptsLeft`, `createdAt`, `lastSentAt`
- Indexes:
  - `{ residentId: 1 }`
  - `{ emailLower: 1 }`
  - TTL: `{ expiresAt: 1 }`, `expireAfterSeconds: 0`

### `loginverifyotps`
- Source model: `server/models/LoginVerifyOtp.ts`
- Primary fields:
  - `userId` (optional ObjectId ref `StaffUser`)
  - `emailLower`
  - `purpose` (`FIRST_LOGIN|LOGIN_2FA|SUPERADMIN_LOGIN_2FA|PASSWORD_CHANGE_2FA`)
  - `otpHash`, `expiresAt`, `usedAt`, `attemptsLeft`, `createdAt`, `lastSentAt`
- Indexes:
  - `{ emailLower: 1, purpose: 1 }`
  - `{ userId: 1, purpose: 1 }`
  - TTL: `{ expiresAt: 1 }`, `expireAfterSeconds: 0`

### `revokedtokens`
- Source model: `server/models/RevokedToken.ts`
- Primary fields:
  - `jti` (unique)
  - `tokenType` (`access|session`)
  - `expiresAt`, `revokedAt`
- Indexes:
  - `{ jti: 1 }` unique
  - TTL: `{ expiresAt: 1 }`, `expireAfterSeconds: 0`

## Logging and Support Collections

### `auditlogs`
- Source model: `server/models/AuditLog.ts`
- Primary fields:
  - `actorId`, `actorRole`, `actorName`
  - `action`, `entityType`, `entityId`
  - `metadata`, `ip`, `userAgent`
  - `createdAt` (immutable)
- Indexes:
  - `{ action: 1, createdAt: -1 }`
  - `{ actorId: 1, createdAt: -1 }`
  - `{ entityType: 1, entityId: 1, createdAt: -1 }`
  - `{ createdAt: -1 }`
  - TTL: `{ createdAt: 1 }`, `expireAfterSeconds: 63072000` (2 years)

### `registrationauditlogs`
- Source model: `server/models/RegistrationAuditLog.ts`
- Primary fields:
  - `eventType`, `severity`
  - `tokenPrefix`, `tokenId` (ObjectId ref `HouseholdToken`)
  - `ipAddress`, `userAgent`, `requestId`
  - `geoLocation.country`, `geoLocation.region`, `geoLocation.city`
  - `details.message`, `details.metadata`
  - `success`, `errorCode`, `errorMessage`
  - `residentId` (ObjectId ref `Resident`), `adminId`
  - `processingTimeMs`
  - `timestamp` (immutable)
- Indexes:
  - `{ eventType: 1 }`
  - `{ severity: 1 }`
  - `{ tokenPrefix: 1 }`
  - `{ tokenId: 1 }`
  - `{ ipAddress: 1 }`
  - `{ requestId: 1 }`
  - `{ success: 1 }`
  - `{ residentId: 1 }`
  - `{ adminId: 1 }`
  - `{ ipAddress: 1, timestamp: -1 }`
  - `{ eventType: 1, timestamp: -1 }`
  - `{ tokenPrefix: 1, timestamp: -1 }`
  - `{ severity: 1, timestamp: -1 }`
  - TTL: `{ timestamp: 1 }`, `expireAfterSeconds: 63072000` (2 years)

### `residentqrscanlogs`
- Source model: `server/models/ResidentQrScanLog.ts`
- Primary fields:
  - `residentId` (ObjectId ref `Resident`)
  - `residentCode`
  - `scannerId`, `scannerRole`
  - `result` (`VALID|INVALID|NOT_FOUND`)
  - `ipAddress`, `userAgent`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ residentId: 1 }`
  - `{ residentCode: 1 }`
  - `{ scannerId: 1 }`
  - `{ scannerRole: 1 }`
  - `{ result: 1 }`
  - `{ createdAt: -1 }`
  - `{ residentCode: 1, createdAt: -1 }`

### `notifications`
- Source model: `server/models/Notification.ts`
- Primary fields:
  - `userId` (ObjectId ref `StaffUser`, nullable for broadcast)
  - `title`, `message`
  - `type` (`dispatch|status_update|volunteer|system|security|info`)
  - `isRead`
  - `meta`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ userId: 1 }`
  - `{ userId: 1, createdAt: -1 }`
  - TTL: `{ createdAt: 1 }`, `expireAfterSeconds: 7776000` (90 days)

### `residentcounters`
- Source model: `server/models/ResidentCounter.ts`
- Primary fields:
  - `key` (unique)
  - `seq`
  - `createdAt`, `updatedAt`
- Indexes:
  - `{ key: 1 }` unique

## High-Level Relationships

- `distributionclaims.distributionId -> distributions._id`
- `distributionclaims.householdId -> residents._id`
- `householdtokens.usedBy.residentId -> residents._id`
- `registrationauditlogs.tokenId -> householdtokens._id`
- `registrationauditlogs.residentId -> residents._id`
- `residentqrscanlogs.residentId -> residents._id`
- `notifications.userId -> staffusers._id`
- `passwordresetotps.userId -> staffusers._id`
- `residentpasswordresetotps.residentId -> residents._id`
- `loginverifyotps.userId -> staffusers._id`
- `users.createdBy -> users._id`

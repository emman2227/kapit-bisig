import { Router, Response } from 'express';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import StaffUser from '../models/StaffUser';
import Distribution from '../models/Distribution';
import Resident from '../models/Resident';
import Claim from '../models/Claim';
import { AuthRequest } from '../middleware/unifiedAuth';

const SECURITY_ACTIONS = [
  'LOGIN_FAILURE',
  'ACCESS_DENIED',
  'LOGIN_OTP_VERIFY_FAILED',
  'FORGOT_PASSWORD_OTP_VERIFIED_FAILED',
];

const ACCOUNT_ACTIONS = [
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_DISABLED',
  'STAFF_DELETED',
  'STAFF_PASSWORD_RESET',
  'STAFF_PASSWORD_RESET_OTP_SENT',
  'STAFF_ACTIVATION_OTP_RESENT',
];

const RECORD_ACTIONS = [
  'RESIDENT_STATUS_UPDATED',
  'RESIDENT_ASSISTED_REVISED',
  'HOUSEHOLD_UPDATED',
  'HOUSEHOLD_MEMBERS_REVISION_APPROVED',
  'HOUSEHOLD_MEMBERS_REVISION_REJECTED',
  'BENEFICIARY_ELIGIBILITY_UPDATED',
  'PROOF_SUBMISSION_REVIEWED',
];

const router = Router();

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    // Check if user is SUPERADMIN
    if (req.authUser?.role !== 'SUPERADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Only SUPERADMIN can access audit logs.',
      });
    }

    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const skip = (page - 1) * limit;

    // Optional filters
    const action = req.query.action as string;
    const actorRole = req.query.actorRole as string;
    const actor = req.query.actor as string;
    const target = req.query.target as string;
    const ip = req.query.ip as string;
    const date = req.query.date as string;
    const category = req.query.category as string;
    const entityType = req.query.entityType as string;

    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const andConditions: Record<string, unknown>[] = [];

    if (action) {
      if (action.includes(',')) {
        andConditions.push({ action: { $in: action.split(',').map((a) => a.trim()) } });
      } else {
        andConditions.push({ action });
      }
    }
    if (entityType) {
      if (entityType.includes(',')) {
        andConditions.push({ entityType: { $in: entityType.split(',').map((e) => e.trim()) } });
      } else {
        andConditions.push({ entityType });
      }
    }
    if (category === 'security') {
      andConditions.push({ action: { $in: SECURITY_ACTIONS } });
    } else if (category === 'account') {
      andConditions.push({
        $or: [
          { entityType: 'StaffUser' },
          { action: { $in: ACCOUNT_ACTIONS } },
        ],
      });
    } else if (category === 'record') {
      andConditions.push({
        $or: [
          { action: { $in: RECORD_ACTIONS } },
          { entityType: { $in: ['Resident', 'Household', 'HouseholdToken'] } },
        ],
      });
    }
    if (actorRole) andConditions.push({ actorRole });
    if (actor) {
      const escaped = escapeRegex(actor.trim());
      const staffMatches = await StaffUser.collection
        .find(
          {
            $or: [
              { firstName: { $regex: escaped, $options: 'i' } },
              { lastName: { $regex: escaped, $options: 'i' } },
              { fullName: { $regex: escaped, $options: 'i' } },
              { email: { $regex: escaped, $options: 'i' } },
            ],
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      const staffIds = staffMatches.map((s) => s._id.toString());

      andConditions.push({
        $or: [
          { actorName: { $regex: escaped, $options: 'i' } },
          { actorId: { $regex: escaped, $options: 'i' } },
          { actorRole: { $regex: escaped, $options: 'i' } },
          ...(staffIds.length > 0 ? [{ actorId: { $in: staffIds } }] : []),
        ],
      });
    }
    if (target) {
      const escaped = escapeRegex(target.trim());
      const distMatches = await Distribution.collection
        .find(
          {
            $or: [
              { barangay: { $regex: escaped, $options: 'i' } },
              { notes: { $regex: escaped, $options: 'i' } },
              { location: { $regex: escaped, $options: 'i' } },
            ],
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      const distIds = distMatches.map((d) => d._id.toString());

      andConditions.push({
        $or: [
          { entityType: { $regex: escaped, $options: 'i' } },
          { entityId: { $regex: escaped, $options: 'i' } },
          { entityLabel: { $regex: escaped, $options: 'i' } },
          ...(distIds.length > 0 ? [{ entityId: { $in: distIds } }] : []),
        ],
      });
    }
    if (ip) {
      const escaped = escapeRegex(ip.trim());
      andConditions.push({
        $or: [
          { ip: { $regex: escaped, $options: 'i' } },
          { userAgent: { $regex: escaped, $options: 'i' } },
        ],
      });
    }
    if (date) {
      const start = new Date(date);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        andConditions.push({
          createdAt: { $gte: start, $lt: end },
        });
      }
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const [rawLogs, total, summaryTotal, summarySecurity, summaryAccount, summaryRecord] = await Promise.all([
      AuditLog.collection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      AuditLog.collection.countDocuments(query),
      AuditLog.collection.countDocuments({}),
      AuditLog.collection.countDocuments({ action: { $in: SECURITY_ACTIONS } }),
      AuditLog.collection.countDocuments({
        $or: [
          { entityType: 'StaffUser' },
          { action: { $in: ACCOUNT_ACTIONS } },
        ],
      }),
      AuditLog.collection.countDocuments({
        $or: [
          { action: { $in: RECORD_ACTIONS } },
          { entityType: { $in: ['Resident', 'Household', 'HouseholdToken'] } },
        ],
      }),
    ]);

    const logs = rawLogs.map((doc: any) => ({
      ...doc,
      _id: doc._id.toString(),
    }));

    // Batch resolve missing actor names and entity labels
    const isObjectId = (id: string | null | undefined): boolean =>
      Boolean(id && mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id));

    const actorStaffIds = new Set<string>();
    const distIds = new Set<string>();
    const residentIds = new Set<string>();
    const staffTargetIds = new Set<string>();
    const claimIds = new Set<string>();

    for (const log of logs) {
      // If actorName is missing, empty, or equals a 24-hex ObjectId, resolve from StaffUser
      if (!log.actorName || isObjectId(log.actorName)) {
        if (isObjectId(log.actorId)) {
          actorStaffIds.add(log.actorId!);
        } else if (isObjectId(log.actorName)) {
          actorStaffIds.add(log.actorName!);
        }
      }

      // If entityLabel is missing, resolve by entityType
      if (!log.entityLabel) {
        if (log.entityType === 'Distribution' && isObjectId(log.entityId)) {
          distIds.add(log.entityId);
        } else if (log.entityType === 'Resident' && isObjectId(log.entityId)) {
          residentIds.add(log.entityId);
        } else if (log.entityType === 'StaffUser' && isObjectId(log.entityId)) {
          staffTargetIds.add(log.entityId);
        } else if (log.entityType === 'Claim' && log.entityId) {
          claimIds.add(log.entityId);
        }
      }
    }

    const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);

    // Parallel batch lookups via native collection driver (bypasses Mongoose sanitizeFilter CastErrors)
    const [staffUsers, distributions, residents, targetStaff, claims] = await Promise.all([
      actorStaffIds.size > 0
        ? StaffUser.collection
            .find(
              { _id: { $in: Array.from(actorStaffIds).map(toObjectId) } },
              { projection: { firstName: 1, lastName: 1, fullName: 1, email: 1 } },
            )
            .toArray()
        : [],
      distIds.size > 0
        ? Distribution.collection
            .find(
              { _id: { $in: Array.from(distIds).map(toObjectId) } },
              { projection: { barangay: 1, scheduled: 1, notes: 1, location: 1 } },
            )
            .toArray()
        : [],
      residentIds.size > 0
        ? Resident.collection
            .find(
              { _id: { $in: Array.from(residentIds).map(toObjectId) } },
              { projection: { firstName: 1, lastName: 1, fullName: 1, residentCode: 1 } },
            )
            .toArray()
        : [],
      staffTargetIds.size > 0
        ? StaffUser.collection
            .find(
              { _id: { $in: Array.from(staffTargetIds).map(toObjectId) } },
              { projection: { firstName: 1, lastName: 1, fullName: 1, email: 1 } },
            )
            .toArray()
        : [],
      claimIds.size > 0
        ? Claim.collection
            .find(
              {
                $or: [
                  { _id: { $in: Array.from(claimIds).filter((id) => isObjectId(id)).map(toObjectId) } },
                  { claimId: { $in: Array.from(claimIds) } },
                ],
              },
              { projection: { claimId: 1, householdCode: 1, barangay: 1, staffName: 1 } },
            )
            .toArray()
        : [],
    ]);

    const staffMap = new Map<string, string>();
    for (const s of staffUsers) {
      staffMap.set(
        s._id.toString(),
        s.fullName || `${s.firstName || ''} ${s.lastName || ''}`.trim() || s.email,
      );
    }

    const distMap = new Map<string, string>();
    for (const d of distributions) {
      const sched = d.scheduled ? ` (${d.scheduled})` : '';
      distMap.set(d._id.toString(), `${d.notes || 'Relief Distribution'} - Brgy. ${d.barangay}${sched}`);
    }

    const residentMap = new Map<string, string>();
    for (const r of residents) {
      const name = r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim();
      residentMap.set(r._id.toString(), `Resident: ${name}${r.residentCode ? ` (${r.residentCode})` : ''}`);
    }

    const targetStaffMap = new Map<string, string>();
    for (const s of targetStaff) {
      targetStaffMap.set(
        s._id.toString(),
        `Staff: ${s.fullName || `${s.firstName || ''} ${s.lastName || ''}`.trim()}`,
      );
    }

    const claimMap = new Map<string, string>();
    for (const c of claims) {
      const label = `Claim: ${c.householdCode || c.claimId} (${c.barangay})`;
      claimMap.set(c._id.toString(), label);
      if (c.claimId) claimMap.set(c.claimId, label);
    }

    // Attach resolved properties
    const resolvedLogs = logs.map((log) => {
      let resolvedActorName = log.actorName;
      if (log.actorRole === 'SUPERADMIN') {
        resolvedActorName = 'Superadmin';
      } else if (log.actorId && staffMap.has(log.actorId)) {
        resolvedActorName = staffMap.get(log.actorId)!;
      } else if (log.actorName && staffMap.has(log.actorName)) {
        resolvedActorName = staffMap.get(log.actorName)!;
      } else if (isObjectId(resolvedActorName)) {
        resolvedActorName = `Staff (${log.actorRole || 'LGU'})`;
      } else if (!resolvedActorName) {
        resolvedActorName = log.actorRole === 'ANONYMOUS' ? 'System' : (log.actorId || 'System');
      }

      let resolvedEntityLabel = log.entityLabel;
      if (!resolvedEntityLabel) {
        if (log.entityType === 'Distribution') {
          resolvedEntityLabel =
            distMap.get(log.entityId) ||
            (log.entityId ? `Distribution (${log.entityId.slice(-6)})` : 'Distribution');
        } else if (log.entityType === 'Resident') {
          resolvedEntityLabel =
            residentMap.get(log.entityId) ||
            (log.entityId ? `Resident (${log.entityId.slice(-6)})` : 'Resident');
        } else if (log.entityType === 'StaffUser') {
          resolvedEntityLabel =
            targetStaffMap.get(log.entityId) ||
            (log.entityId ? `Staff (${log.entityId.slice(-6)})` : 'Staff User');
        } else if (log.entityType === 'Claim') {
          resolvedEntityLabel =
            claimMap.get(log.entityId) ||
            (log.entityId ? `Claim (${log.entityId})` : 'Relief Claim');
        } else if (log.entityType === 'Auth') {
          resolvedEntityLabel = 'Authentication Session';
        } else if (log.entityType === 'Face') {
          resolvedEntityLabel = 'Biometric Face Verification';
        } else {
          resolvedEntityLabel = log.entityType + (log.entityId ? ` (${log.entityId.slice(-6)})` : '');
        }
      }

      return {
        ...log,
        actorName: resolvedActorName,
        entityLabel: resolvedEntityLabel,
      };
    });

    return res.json({
      success: true,
      data: resolvedLogs,
      summary: {
        total: summaryTotal,
        securityEvents: summarySecurity,
        accountActivities: summaryAccount,
        recordModifications: summaryRecord,
      },
      pagination: {
        page,
        limit,
        totalDocs: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[AuditLogRoutes] Fetch error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
  }
});

export default router;


/**
 * Audit Logging Utility
 *
 * [SECURITY CHECKLIST §3.3] Audit Logging Enabled
 *
 * Provides a single `logAudit()` helper that creates an AuditLog entry.
 * Never throws - audit writes are best-effort so they do not break the
 * primary request flow.
 */

import { Request } from 'express';
import mongoose from 'mongoose';
import AuditLog, { AuditAction } from '../models/AuditLog';
import StaffUser from '../models/StaffUser';
import Distribution from '../models/Distribution';
import Resident from '../models/Resident';
import { AuthRequest } from '../middleware/unifiedAuth';
import { sanitizeForLogs } from './logSanitizer';

/**
 * Append an audit entry. Never throws.
 *
 * @param req         Express request (used for IP / user-agent / auth context)
 * @param action      Audit action constant
 * @param entityType  E.g. "Auth", "StaffUser", "Distribution", "Claim", "Resident"
 * @param entityId    DB _id or other identifier of the affected entity
 * @param metadata    Extra context (sensitive fields are auto-sanitized)
 * @param entityLabel Optional human-readable description of the target entity
 */
export async function logAudit(
  req: Request | AuthRequest,
  action: AuditAction,
  entityType: string,
  entityId: string = '',
  metadata: Record<string, unknown> = {},
  entityLabel: string = '',
): Promise<void> {
  try {
    const authReq = req as AuthRequest;
    const reqAny = req as any;
    const actorId =
      authReq.authUser?.userId ??
      authReq.authUser?.sub ??
      reqAny.user?.userId ??
      reqAny.user?.id ??
      null;
    const actorRole = authReq.authUser?.role ?? reqAny.user?.role ?? 'ANONYMOUS';

    let actorName = '';
    if (actorRole === 'SUPERADMIN') {
      actorName = 'Superadmin';
    } else if (actorId && mongoose.Types.ObjectId.isValid(actorId)) {
      try {
        const staff = await StaffUser.findById(actorId).select('firstName lastName fullName').lean();
        if (staff) {
          actorName = staff.fullName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim();
        }
      } catch {
        // Best effort lookup
      }
    }

    if (!actorName) {
      actorName = authReq.authUser?.sub ?? reqAny.user?.email ?? 'System';
    }

    let resolvedLabel = entityLabel?.trim() || '';
    if (!resolvedLabel && entityId && mongoose.Types.ObjectId.isValid(entityId)) {
      try {
        if (entityType === 'Distribution') {
          const dist = await Distribution.findById(entityId).select('barangay scheduled notes').lean();
          if (dist) {
            resolvedLabel = `${dist.notes || 'Relief Distribution'} - Brgy. ${dist.barangay} (${dist.scheduled})`;
          }
        } else if (entityType === 'Resident') {
          const resDoc = await Resident.findById(entityId).select('firstName lastName fullName residentCode').lean();
          if (resDoc) {
            const name = resDoc.fullName || `${resDoc.firstName || ''} ${resDoc.lastName || ''}`.trim();
            resolvedLabel = `Resident: ${name}${resDoc.residentCode ? ` (${resDoc.residentCode})` : ''}`;
          }
        } else if (entityType === 'StaffUser') {
          const st = await StaffUser.findById(entityId).select('firstName lastName fullName email').lean();
          if (st) {
            const name = st.fullName || `${st.firstName || ''} ${st.lastName || ''}`.trim();
            resolvedLabel = `Staff: ${name}${st.email ? ` (${st.email})` : ''}`;
          }
        }
      } catch {
        // Fall back gracefully
      }
    }

    await AuditLog.create({
      actorId: actorId ? String(actorId) : null,
      actorRole,
      actorName,
      action,
      entityType,
      entityId,
      entityLabel: resolvedLabel,
      // [RISK-2 MITIGATION] Sanitize metadata before persistence.
      metadata: sanitizeForLogs<Record<string, unknown>>(metadata),
      ip: req.ip || req.socket?.remoteAddress || 'unknown',
      userAgent: (req.headers['user-agent'] ?? '').substring(0, 512),
    });
  } catch (err) {
    // Best-effort - never let audit failure break the main flow.
    console.error('[AuditLog] write failed:', (err as Error).message);
  }
}


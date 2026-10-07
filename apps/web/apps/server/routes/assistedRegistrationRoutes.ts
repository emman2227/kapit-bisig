/**
 * Assisted Registration Routes
 * 
 * Staff/Volunteer endpoints to register residents who lack mobile phones or government IDs.
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { validateRequest } from '../validation/validateRequest';
import { assistedRegistrationBody } from '../validation/assistedRegistration.schema';
import { registerAssistedResident } from '../services/assistedRegistrationService';

export interface StaffAuthRequest extends Request {
  staffUser?: {
    userId: string;
    role: string;
    name?: string;
  };
}

const router = Router();
const ALLOWED_STAFF_ROLES = ['Admin', 'LGU_STAFF', 'Volunteer', 'SUPERADMIN', 'Staff'];

/**
 * Middleware ensuring caller is an authenticated staff member or volunteer
 */
function requireStaffRole(req: StaffAuthRequest, res: Response, next: NextFunction): void {
  const token =
    req.cookies?.sa_token ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : null);

  if (!token || token === 'null' || token === 'undefined') {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' ? 'fallback_secret_key_for_development_only_replace_in_production_min32chars' : '');
    if (!secret) {
      res.status(500).json({ success: false, message: 'Server configuration error' });
      return;
    }

    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<string, any>;
    const role = decoded.role;

    if (!role || !ALLOWED_STAFF_ROLES.includes(role)) {
      res.status(403).json({
        success: false,
        message: 'Forbidden: Assisted registration requires Staff or Volunteer privileges.',
      });
      return;
    }

    req.staffUser = {
      userId: decoded.userId || decoded.sub || 'staff',
      role,
      name: decoded.name || decoded.sub || decoded.email,
    };

    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired authentication token' });
  }
}

/**
 * POST /api/assisted-registration/register
 * Register a resident without mobile phone or standard ID (Staff/Volunteer only)
 */
router.post(
  '/register',
  requireStaffRole,
  validateRequest({ body: assistedRegistrationBody }),
  async (req: StaffAuthRequest, res: Response) => {
    try {
      const staffUser = req.staffUser || { userId: 'staff', role: 'LGU_STAFF' };
      const result = await registerAssistedResident(req.body, staffUser);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
          code: result.errorCode,
        });
      }

      return res.status(201).json({
        success: true,
        message: result.message,
        data: {
          residentId: result.residentId,
          residentCode: result.residentCode,
          qrToken: result.qrToken,
          tempPassword: result.tempPassword,
        },
      });
    } catch (error) {
      console.error('[AssistedRegistrationRoutes] Route error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during assisted registration.',
      });
    }
  }
);

export default router;

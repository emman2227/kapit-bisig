/**
 * Report Routes (/api/reports)
 *
 * Aggregation endpoints for the Reports module.
 *
 * Endpoints:
 * - GET /api/reports/summary  — Distribution summary with stats, trends, breakdowns
 */

import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Distribution from '../models/Distribution';
import DistributionClaim from '../models/DistributionClaim';
import Resident from '../models/Resident';
import Claim from '../models/Claim';
import { AuthRequest } from '../middleware/unifiedAuth';
import { BARANGAY_OPTIONS } from '../models/Distribution';
import { deriveDistributionLifecycle } from '../utils/distributionLifecycle';

const router = Router();

/**
 * GET /api/reports/summary
 *
 * Query params:
 *   - startDate  (YYYY-MM-DD) optional
 *   - endDate    (YYYY-MM-DD) optional
 *   - barangay   (string)     optional — filter to a single barangay
 *   - reportType ('distribution' | 'barangay')  optional, default 'distribution'
 */
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate, barangay, reportType = 'distribution' } = req.query as {
      startDate?: string;
      endDate?: string;
      barangay?: string;
      reportType?: string;
    };

    // ── Build date filter ───────────────────────────────────────
    const dateFilter: Record<string, unknown> = {};
    if (startDate) {
      const start = new Date(startDate as string);
      if (!isNaN(start.getTime())) {
        dateFilter.$gte = start;
      }
    }
    if (endDate) {
      const end = new Date(endDate as string);
      if (!isNaN(end.getTime())) {
        // Include the full end day
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }
    }

    // ── Build match stage ───────────────────────────────────────
    const matchStage: Record<string, unknown> = {};
    if (Object.keys(dateFilter).length > 0) {
      matchStage.createdAt = dateFilter;
    }
    if (barangay && barangay !== 'All') {
      matchStage.barangay = barangay;
    }

    // Scope filtering for staff/volunteer
    if (req.authUser?.role === 'LGU_STAFF' || req.authUser?.role === 'Volunteer') {
      const assigned = req.authUser.assignedBarangays ?? [];
      if (assigned.length > 0) {
        if (matchStage.barangay) {
          // If they filtered to a specific barangay, ensure it's in their scope
          if (!assigned.includes(matchStage.barangay as string)) {
            return res.status(403).json({
              success: false,
              message: 'You do not have access to this barangay',
            });
          }
        } else {
          matchStage.barangay = { $in: assigned };
        }
      }
    }

    // ── Fetch distributions (use aggregate to avoid Mongoose enum cast issues with $in) ──
    const distributions = await Distribution.aggregate([
      { $match: matchStage },
      { $sort: { createdAt: -1 as const } },
    ]);

    const distributionIds = distributions.map((d) => d._id);

    // ── Aggregate claim counts per distribution ─────────────────
    const claimAgg = await DistributionClaim.aggregate([
      { $match: { distributionId: { $in: distributionIds } } },
      {
        $group: {
          _id: '$distributionId',
          claimedCount: { $sum: 1 },
          qrCount: {
            $sum: { $cond: [{ $eq: ['$proofMethod', 'QR'] }, 1, 0] },
          },
          faceCount: {
            $sum: { $cond: [{ $eq: ['$proofMethod', 'FACE'] }, 1, 0] },
          },
          nullMethodCount: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$proofMethod', 'QR'] }, { $ne: ['$proofMethod', 'FACE'] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const claimMap = new Map(
      claimAgg.map((c) => [
        c._id.toString(),
        {
          claimed: c.claimedCount,
          qr: c.qrCount,
          face: c.faceCount,
          unknown: c.nullMethodCount,
        },
      ]),
    );

    // ── Aggregate registered (approved) residents per barangay ──
    const barangayFilter: Record<string, unknown> = { status: 'Approved' };
    if (matchStage.barangay) {
      barangayFilter.barangay = matchStage.barangay;
    }

    const residentAgg = await Resident.aggregate([
      { $match: barangayFilter },
      { $group: { _id: '$barangay', count: { $sum: 1 } } },
    ]);
    const residentMap = new Map(residentAgg.map((r) => [r._id, r.count]));

    // ── Build distribution rows ─────────────────────────────────
    let totalQR = 0;
    let totalFace = 0;
    let totalUnknownMethod = 0;

    const rows = distributions.map((d) => {
      const id = d._id.toString();
      const claims = claimMap.get(id) || { claimed: 0, qr: 0, face: 0, unknown: 0 };
      const registered = residentMap.get(d.barangay) || d.households || 0;
      const claimed = claims.claimed;
      const unclaimed = Math.max(0, registered - claimed);
      const claimRate = registered > 0 ? Math.round((claimed / registered) * 100) : 0;

      totalQR += claims.qr;
      totalFace += claims.face;
      totalUnknownMethod += claims.unknown;

      const lifecycle = deriveDistributionLifecycle({
        scheduled: d.scheduled,
        endsAt: d.endsAt,
        archivedAt: d.archivedAt,
        status: d.status,
        claimedHouseholds: claimed,
        registeredHouseholds: registered,
      });

      const derivedStatus = lifecycle === 'Upcoming' ? 'Scheduled' : lifecycle;

      return {
        id,
        scheduled: d.scheduled,
        barangay: d.barangay,
        assignedBarangays: d.assignedBarangays || [],
        households: d.households,
        registeredHouseholds: registered,
        claimedHouseholds: claimed,
        unclaimedHouseholds: unclaimed,
        claimRate,
        status: derivedStatus,
        createdAt: d.createdAt,
      };
    });

    // ── Overview stats ──────────────────────────────────────────
    const totalDistributions = rows.length;
    const totalRegistered = rows.reduce((a, r) => a + r.registeredHouseholds, 0);
    const totalClaimed = rows.reduce((a, r) => a + r.claimedHouseholds, 0);
    const totalUnclaimed = rows.reduce((a, r) => a + r.unclaimedHouseholds, 0);
    const overallClaimRate =
      totalRegistered > 0 ? Math.round((totalClaimed / totalRegistered) * 100) : 0;

    // ── Compute completedToday ────────────────
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    
    // We apply matchStage (like barangay filter) to Claim queries as well
    const claimMatchStage: Record<string, unknown> = {};
    if (matchStage.barangay) claimMatchStage.barangay = matchStage.barangay;

    const completedToday = await Distribution.countDocuments({
      ...matchStage,
      status: 'Claimed',
      claimedAt: { $gte: startOfToday }
    });


    // ── Monthly trends (last 6 months) ──────────────────────────
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const monthlyDistAgg = await Distribution.aggregate([
      {
        $match: {
          ...matchStage,
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          distributions: { $sum: 1 },
          households: { $sum: '$households' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Build claims-per-month aggregation
    const monthlyClaimAgg = await DistributionClaim.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo },
          ...(distributionIds.length > 0
            ? { distributionId: { $in: distributionIds } }
            : {}),
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          claimed: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTrends: { month: string; distributions: number; claimed: number }[] = [];

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      const y = d.getFullYear();
      const m = d.getMonth() + 1; // 1-based
      const label = `${monthNames[m - 1]} ${y}`;

      const distEntry = monthlyDistAgg.find(
        (e) => e._id.year === y && e._id.month === m,
      );
      const claimEntry = monthlyClaimAgg.find(
        (e) => e._id.year === y && e._id.month === m,
      );

      monthlyTrends.push({
        month: label,
        distributions: distEntry?.distributions || 0,
        claimed: claimEntry?.claimed || 0,
      });
    }

    // ── Barangay breakdown ──────────────────────────────────────
    const barangayBreakdown = BARANGAY_OPTIONS.map((b) => {
      const bRows = rows.filter((r) => r.barangay === b);
      return {
        barangay: b,
        distributions: bRows.length,
        registeredHouseholds: bRows.reduce((a, r) => a + r.registeredHouseholds, 0),
        claimedHouseholds: bRows.reduce((a, r) => a + r.claimedHouseholds, 0),
      };
    }).filter((b) => b.distributions > 0);

    // ── Verification method breakdown ───────────────────────────
    const verificationMethods = {
      qr: totalQR,
      face: totalFace,
      unknown: totalUnknownMethod,
    };

    return res.json({
      success: true,
      data: {
        overview: {
          totalDistributions,
          totalRegisteredHouseholds: totalRegistered,
          totalClaimedHouseholds: totalClaimed,
          totalUnclaimedHouseholds: totalUnclaimed,
          claimRate: overallClaimRate,
          completedToday,

        },
        distributions: rows,
        monthlyTrends,
        barangayBreakdown,
        verificationMethods,
      },
    });
  } catch (error) {
    console.error('[Reports] Summary error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate report summary',
    });
  }
});

export default router;

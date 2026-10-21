/**
 * Household List Routes
 *
 * GET /api/households – returns registered households (from the `residents`
 * collection) with optional search, barangay, and status filters.
 *
 * Each row is a "registered household" represented by a Resident document.
 * The claim status is derived by cross-referencing the Claims collection.
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Resident from '../models/Resident';
import Claim from '../models/Claim';
import Distribution from '../models/Distribution';
import { AuthRequest } from '../middleware/unifiedAuth';
import { validateRequest } from '../validation/validateRequest';
import { escapeRegex } from '../validation/mongoSanitize';
import { listHouseholdsQuery } from '../validation/householdList.schema';

const router = Router();

function getFamilyHeadName(input: { firstName?: string; lastName?: string; fullName?: string }): string {
  const first = String(input.firstName || '').trim();
  const last = String(input.lastName || '').trim();
  if (first || last) {
    return `${first} ${last}`.trim();
  }
  return String(input.fullName || '').trim();
}

/* ------------------------------------------------------------------ */
/*  GET /api/households                                                */
/* ------------------------------------------------------------------ */

router.get('/', validateRequest({ query: listHouseholdsQuery }), async (req: AuthRequest, res: Response) => {
  try {
    const { search, barangay, status, distributionId } = req.query as {
      search?: string;
      barangay?: string;
      status?: string; // "Claimed" | "Unclaimed" | "Not Claimed"
      distributionId?: string;
    };

    // Build MongoDB filter - Only approved resident households appear in the Relief Registry
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {
      status: 'Approved',
    };

    // RBAC: LGU_STAFF can only see their assigned barangays
    if (req.authUser?.role === 'LGU_STAFF') {
      const assigned = req.authUser.assignedBarangays ?? [];
      filter.barangay = mongoose.trusted({ $in: assigned });
    }

    if (barangay && barangay !== 'All Barangays') {
      // If staff, ensure the requested barangay is within their scope
      if (req.authUser?.role === 'LGU_STAFF') {
        const assigned = req.authUser.assignedBarangays ?? [];
        if (!assigned.includes(barangay)) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to the requested barangay',
          });
        }
      }
      filter.barangay = barangay;
    }

    if (search) {
      const re = new RegExp(escapeRegex(search), 'i');
      filter.$or = mongoose.trusted([
        { fullName: re },
        { firstName: re },
        { lastName: re },
        { barangay: re },
        { streetAddress: re },
        { mobileNumber: re },
      ]);
    }

    // Resolve target distribution if specified
    let targetDistributionId: string | null = null;
    if (distributionId && distributionId !== 'all') {
      if (distributionId === 'active' || distributionId === 'latest') {
        // Find the active (or most recent) distribution for scope
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const distFilter: Record<string, any> = { archivedAt: null };
        if (barangay && barangay !== 'All Barangays') {
          distFilter.$or = mongoose.trusted([
            { barangay },
            { assignedBarangays: barangay },
          ]);
        }
        const activeDist = await Distribution.findOne({
          ...distFilter,
          status: mongoose.trusted({ $in: ['Unclaimed', 'Partially Claimed'] }),
        })
          .setOptions({ sanitizeFilter: false })
          .sort({ createdAt: -1 })
          .lean();

        const resolved =
          activeDist ||
          (await Distribution.findOne(distFilter)
            .setOptions({ sanitizeFilter: false })
            .sort({ createdAt: -1 })
            .lean());
        if (resolved) {
          targetDistributionId = (resolved as any)._id.toString();
        }
      } else if (mongoose.Types.ObjectId.isValid(distributionId)) {
        targetDistributionId = distributionId;
      }
    }

    // ── Pagination ──────────────────────────────────────────────
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const rawLimit = parseInt(req.query.limit as string, 10) || 50;
    const limit = Math.min(rawLimit, 50);   // hard cap
    const skip = (page - 1) * limit;

    // Fetch residents (exclude heavy fields like images)
    const total = await Resident.countDocuments(filter).setOptions({ sanitizeFilter: false });
    const residents = await Resident.find(filter)
      .setOptions({ sanitizeFilter: false })
      .select(
        'firstName lastName fullName barangay streetAddress city householdSize ' +
        'mobileNumber status verification.overallConfidence verification.isVerified ' +
        'verification.aiVerificationStatus createdAt updatedAt'
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Fetch confirmed claims for the current residents page
    const residentIds = residents.map((r) => r._id.toString());
    const confirmedClaims = await Claim.find({
      claimCategory: 'DISTRIBUTION',
      residentId: mongoose.trusted({ $in: residentIds }),
      status: 'CONFIRMED',
    })
      .setOptions({ sanitizeFilter: false })
      .select('residentId distributionId createdAt updatedAt')
      .lean();

    // Map: residentId -> latest lifetime claim timestamp
    const latestClaimTimeMap = new Map<string, number>();
    // Set: residentIds that claimed the target distribution (or claimed any if no targetDistributionId)
    const cycleClaimedSet = new Set<string>();

    for (const c of confirmedClaims) {
      const ridRaw = (c as any).residentId;
      const rid =
        typeof ridRaw === 'string'
          ? ridRaw
          : ridRaw && typeof ridRaw.toString === 'function'
            ? ridRaw.toString()
            : null;
      if (!rid) continue;

      const rawDate = c.createdAt || c.updatedAt;
      if (rawDate) {
        const cDate = rawDate instanceof Date ? rawDate : new Date(rawDate);
        const cTime = cDate.getTime();
        if (!Number.isNaN(cTime)) {
          const existing = latestClaimTimeMap.get(rid);
          if (existing === undefined || cTime > existing) {
            latestClaimTimeMap.set(rid, cTime);
          }
        }
      }

      // Check if this claim satisfies the distribution scope
      const claimDistId = (c as any).distributionId ? String((c as any).distributionId) : '';
      if (!targetDistributionId) {
        // Lifetime view (all distributions)
        cycleClaimedSet.add(rid);
      } else if (claimDistId === targetDistributionId) {
        // Specific distribution cycle view
        cycleClaimedSet.add(rid);
      }
    }

    // Build response rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let households = residents.map((r: any) => {
      const id = r._id.toString();
      const hasClaim = cycleClaimedSet.has(id);
      const lastClaimTime = latestClaimTimeMap.get(id);

      return {
        id,
        householdCode: `HH-${r.barangay?.substring(0, 2).toUpperCase() || 'XX'}-${id.slice(-4).toUpperCase()}`,
        familyHeadName: getFamilyHeadName({
          firstName: r.firstName,
          lastName: r.lastName,
          fullName: r.fullName,
        }),
        barangay: r.barangay || '—',
        address: r.streetAddress || '—',
        familyMembersCount: r.householdSize || 1,
        contact: r.mobileNumber || '—',
        verificationStatus: r.verification?.aiVerificationStatus || '—',
        verificationScore: r.verification?.overallConfidence ?? null,
        claimStatus: hasClaim ? 'Claimed' as const : 'Unclaimed' as const,
        lastClaimedAt: typeof lastClaimTime === 'number' && lastClaimTime > 0 ? new Date(lastClaimTime).toISOString() : null,
        registeredAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      };
    });

    // Client-requested status filter
    if (status === 'Claimed') {
      households = households.filter((h) => h.claimStatus === 'Claimed');
    } else if (status === 'Unclaimed' || status === 'Not Claimed') {
      households = households.filter((h) => h.claimStatus === 'Unclaimed' || (h.claimStatus as string) === 'Not Claimed');
    }

    return res.json({
      success: true,
      data: households,
      total: households.length,
      distributionId: targetDistributionId,
      pagination: {
        page,
        limit,
        totalDocs: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('GET /api/households error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch households',
    });
  }
});

export default router;

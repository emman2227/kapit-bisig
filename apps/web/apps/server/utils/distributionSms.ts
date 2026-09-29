import mongoose from 'mongoose';
import Resident from '../models/Resident';
import { isSmsConfigured, sendSms } from './smsService';
import {
  isValidPhilippineMobileNumber,
  normalizePhilippineMobileNumber,
} from './mobileNumber';

export type DeliveryChannelStatus =
  | 'sent_successfully'
  | 'partially_delivered'
  | 'no_eligible_recipients'
  | 'provider_not_configured'
  | 'provider_request_failed';

export interface SmsDeliverySummary {
  status: DeliveryChannelStatus;
  attempted: number;
  sent: number;
  skipped: number;  failed: number;
}

interface DistributionSmsPayload {
  targetBarangays: string[];
  scheduled: string | Date;
}

interface DistributionSmsDependencies {
  configured?: boolean;
  send?: (to: string, message: string) => Promise<void>;
  recipients?: Array<{ mobileNumber?: string | null }>;
}

function uniqueBarangays(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatSchedule(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Best-effort SMS broadcast for a newly-created distribution.
 * Distribution creation must never be rolled back because an SMS provider is unavailable.
 */
export async function broadcastDistributionSms(
  payload: DistributionSmsPayload,
  dependencies: DistributionSmsDependencies = {},
): Promise<SmsDeliverySummary> {
  const targetBarangays = uniqueBarangays(payload.targetBarangays);
  if (targetBarangays.length === 0) {
    return { status: 'no_eligible_recipients', attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const recipients = dependencies.recipients ?? await Resident.find({    barangay: mongoose.trusted({ $in: targetBarangays }),
    status: 'Approved',
  })
    .setOptions({ sanitizeFilter: false })
    .select('mobileNumber')
    .lean();

  const numbers = new Set<string>();
  let skipped = 0;
  for (const recipient of recipients) {
    const normalized = normalizePhilippineMobileNumber(String(recipient.mobileNumber ?? ''));
    if (!isValidPhilippineMobileNumber(normalized)) {
      skipped += 1;
      continue;
    }
    if (numbers.has(normalized)) {
      skipped += 1;
      continue;
    }
    numbers.add(normalized);
  }

  const attempted = numbers.size;
  if (attempted === 0) {
    return { status: 'no_eligible_recipients', attempted, sent: 0, skipped, failed: 0 };
  }

  const location = targetBarangays.join(', ');
  const message = `[KapitBisig] New relief distribution for ${location} on ${formatSchedule(payload.scheduled)}. Open the app and submit your proof/application before claiming aid.`;
  const sender = dependencies.send ?? sendSms;
  const results = await Promise.allSettled([...numbers].map((number) => sender(number, message)));
  const sent = results.filter((result) => result.status === 'fulfilled').length;

  const configured = dependencies.configured ?? isSmsConfigured();
  if (!configured) {
    return {
      status: 'provider_not_configured',
      attempted,
      sent: 0,
      skipped,
      failed: attempted,
    };
  }

  return {
    status: sent === attempted
      ? 'sent_successfully'
      : sent > 0
        ? 'partially_delivered'
        : 'provider_request_failed',
    attempted,
    sent,
    skipped,
    failed: attempted - sent,
  };
}

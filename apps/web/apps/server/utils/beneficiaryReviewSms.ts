import { isSmsConfigured, sendSms } from './smsService';

export type BeneficiaryReviewSmsStatus =
  | 'sent_successfully'
  | 'no_eligible_recipient'
  | 'provider_not_configured'
  | 'provider_request_failed';

export interface BeneficiaryReviewSmsDeliverySummary {
  status: BeneficiaryReviewSmsStatus;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface BeneficiaryReviewSmsInput {
  mobileNumber?: string | null;
  decision: 'Approved' | 'Rejected';
  scopeName: string;
  rejectionReason?: string;
  residentName?: string;
}

interface BeneficiaryReviewSmsDependencies {
  configured?: boolean;
  send?: (to: string, message: string) => Promise<void>;
}

function normalizePhilippineMobile(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63')) digits = `0${digits.slice(2)}`;
  if (/^9\d{9}$/.test(digits)) digits = `0${digits}`;
  return /^09\d{9}$/.test(digits) ? digits : null;
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function buildMessage(input: BeneficiaryReviewSmsInput): string {
  const nameGreeting = input.residentName ? `Hi ${input.residentName}, ` : '';
  const scopeName = compactText(input.scopeName || 'your relief request', 60);

  if (input.decision === 'Approved') {
    return `[KapitBisig] ${nameGreeting}your proof for ${scopeName} was approved. You are now eligible for relief distribution. Please check your Kapit-Bisig app for details.`;
  }

  const reason = compactText(input.rejectionReason || '', 70);
  return reason
    ? `[KapitBisig] ${nameGreeting}your proof for ${scopeName} needs an update. Reason: ${reason}. Please open the app to review and resubmit.`
    : `[KapitBisig] ${nameGreeting}your proof for ${scopeName} needs an update. Please open the app to review and resubmit.`;
}

/**
 * Best-effort status SMS sent after proof review. Review decisions must never
 * be rolled back because a phone number is missing or the provider is down.
 */
export async function sendBeneficiaryReviewSms(
  input: BeneficiaryReviewSmsInput,
  dependencies: BeneficiaryReviewSmsDependencies = {},
): Promise<BeneficiaryReviewSmsDeliverySummary> {
  const mobileNumber = normalizePhilippineMobile(input.mobileNumber);
  if (!mobileNumber) {
    return {
      status: 'no_eligible_recipient',
      attempted: 0,
      sent: 0,
      skipped: 1,
      failed: 0,
    };
  }

  const configured = dependencies.configured
    ?? (process.env.NODE_ENV === 'test' ? false : isSmsConfigured());
  if (!configured) {
    return {
      status: 'provider_not_configured',
      attempted: 1,
      sent: 0,
      skipped: 0,
      failed: 1,
    };
  }

  try {
    await (dependencies.send ?? sendSms)(mobileNumber, buildMessage(input));
    return { status: 'sent_successfully', attempted: 1, sent: 1, skipped: 0, failed: 0 };
  } catch (error) {
    console.warn('[beneficiaryReviewSms] Provider request failed:', error instanceof Error ? error.message : error);
    return { status: 'provider_request_failed', attempted: 1, sent: 0, skipped: 0, failed: 1 };
  }
}

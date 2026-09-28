import mongoose from 'mongoose';
import Resident from '../models/Resident';
import ResidentPushDevice from '../models/ResidentPushDevice';
import { DeliveryChannelStatus } from './distributionSms';

export interface PushDeliverySummary {
  status: DeliveryChannelStatus;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface DistributionPushPayload {
  distributionId: string;
  targetBarangays: string[];
  scheduled: string | Date;
  requiresBeneficiaryApproval?: boolean;
}

function isExpoPushToken(value: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(value);
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

export async function broadcastDistributionPush(
  payload: DistributionPushPayload,
): Promise<PushDeliverySummary> {
  const targetBarangays = [...new Set(payload.targetBarangays.map((value) => value.trim()).filter(Boolean))];
  if (targetBarangays.length === 0) {
    return { status: 'no_eligible_recipients', attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const residents = await Resident.find({
    barangay: mongoose.trusted({ $in: targetBarangays }),
    status: 'Approved',
  }).select('_id').lean();
  const residentIds = residents.map((resident) => resident._id);
  const devices = residentIds.length > 0
    ? await ResidentPushDevice.find({ residentId: mongoose.trusted({ $in: residentIds }), active: true }).lean()
    : [];

  const validDevices = devices.filter((device) => isExpoPushToken(device.expoPushToken));
  const invalidDevices = devices.filter((device) => !isExpoPushToken(device.expoPushToken));
  if (invalidDevices.length > 0) {
    await ResidentPushDevice.updateMany(
      { _id: mongoose.trusted({ $in: invalidDevices.map((device) => device._id) }) },
      { $set: { active: false, disabledReason: 'INVALID_TOKEN' } },
    );
  }

  const attempted = validDevices.length;
  const skipped = invalidDevices.length;
  if (attempted === 0) {
    return { status: 'no_eligible_recipients', attempted, sent: 0, skipped, failed: 0 };
  }
  if (process.env.EXPO_PUSH_ENABLED !== 'true') {
    return { status: 'provider_not_configured', attempted, sent: 0, skipped, failed: attempted };
  }

  const isTargeted = payload.requiresBeneficiaryApproval === true;
  const messages = validDevices.map((device) => ({
    to: device.expoPushToken,
    sound: 'default',
    channelId: 'default',
    title: isTargeted ? 'Targeted Relief Distribution • Proof Required' : 'New Relief Distribution',
    body: isTargeted
      ? `Relief distribution for ${targetBarangays.join(', ')} on ${formatSchedule(payload.scheduled)}. Damage assessment proof is required before claiming aid.`
      : `Relief distribution for ${targetBarangays.join(', ')} on ${formatSchedule(payload.scheduled)}. Open to all verified residents.`,
    data: {
      screen: isTargeted ? 'proof-request' : 'distributions',
      distributionId: payload.distributionId,
      requiresBeneficiaryApproval: isTargeted,
    },
  }));

  try {
    const tickets: Array<{ status?: string; details?: { error?: string } }> = [];
    for (let index = 0; index < messages.length; index += 100) {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(index, index + 100)),
      });
      if (!response.ok) throw new Error(`Expo push provider returned HTTP ${response.status}`);
      const result = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
      tickets.push(...(Array.isArray(result.data) ? result.data : []));
    }

    const rejectedIndexes: number[] = [];
    let sent = 0;
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') sent += 1;
      if (ticket.details?.error === 'DeviceNotRegistered') rejectedIndexes.push(index);
    });
    if (rejectedIndexes.length > 0) {
      const rejectedTokens = rejectedIndexes.map((index) => validDevices[index]?.expoPushToken).filter(Boolean);
      await ResidentPushDevice.updateMany(
        { expoPushToken: mongoose.trusted({ $in: rejectedTokens }) },
        { $set: { active: false, disabledReason: 'DEVICE_NOT_REGISTERED' } },
      );
    }

    const failed = attempted - sent;
    return {
      status: sent === attempted ? 'sent_successfully' : sent > 0 ? 'partially_delivered' : 'provider_request_failed',
      attempted,
      sent,
      skipped,
      failed,
    };
  } catch (error) {
    console.warn('[distributionPush] Provider request failed:', error instanceof Error ? error.message : error);
    return { status: 'provider_request_failed', attempted, sent: 0, skipped, failed: attempted };
  }
}
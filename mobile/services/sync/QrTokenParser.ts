/**
 * Client-Side QR Token Parser
 *
 * Extracts residentCode and qrVersion from Kapit-Bisig QR tokens.
 *
 * Supported formats:
 *   KBQR2.<base64url-payload>.<signature>  →  signed V2 token
 *   KBQR1.<base64url-payload>              →  unsigned V1 token
 *   XX-YYYY-NNNNNN                         →  raw resident code (legacy)
 *
 * IMPORTANT: This parser does NOT verify the HMAC signature on KBQR2 tokens
 * because the signing secret must not be shipped to client devices. The offline
 * scanner trusts the server-built roster for eligibility checks; this parser
 * only extracts the residentCode so the client can look it up in the roster.
 */

export interface ParsedQrToken {
  residentCode: string;
  qrVersion?: number;
  legacy: boolean;
}

function base64UrlDecode(input: string): string {
  // Replace base64url chars with standard base64, then decode
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  // atob is available in React Native's JS engine
  const binary = atob(base64);
  // Convert binary string to UTF-8
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Decode UTF-8 bytes
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes);
}

/**
 * Parse a scanned QR code string into a residentCode + qrVersion.
 *
 * Returns null if the QR data is not a recognized Kapit-Bisig token.
 */
export function parseQrToken(qrData: string): ParsedQrToken | null {
  if (!qrData || typeof qrData !== 'string') return null;
  const trimmed = qrData.trim();

  // Legacy raw resident code: XX-YYYY-NNNNNN
  if (/^[A-Z]{2}-\d{4}-\d{6}$/.test(trimmed)) {
    return { residentCode: trimmed, legacy: true };
  }

  // KBQR2 — signed V2 token
  if (trimmed.startsWith('KBQR2.')) {
    try {
      const parts = trimmed.split('.');
      if (parts.length !== 3 || !parts[1]) return null;
      const decoded = base64UrlDecode(parts[1]);
      const parsed = JSON.parse(decoded) as {
        v?: number;
        t?: string;
        rid?: string;
        qv?: number;
      };
      if (
        parsed.v !== 2 ||
        parsed.t !== 'resident' ||
        typeof parsed.rid !== 'string' ||
        typeof parsed.qv !== 'number'
      ) {
        return null;
      }
      return {
        residentCode: parsed.rid.toUpperCase(),
        qrVersion: parsed.qv,
        legacy: false,
      };
    } catch {
      return null;
    }
  }

  // KBQR1 — unsigned V1 token
  if (trimmed.startsWith('KBQR1.')) {
    try {
      const decoded = base64UrlDecode(trimmed.slice('KBQR1.'.length));
      const parsed = JSON.parse(decoded) as {
        v?: number;
        t?: string;
        rid?: string;
      };
      if (
        parsed.v !== 1 ||
        parsed.t !== 'resident' ||
        typeof parsed.rid !== 'string'
      ) {
        return null;
      }
      return { residentCode: parsed.rid.toUpperCase(), legacy: true };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * generateResidentQrSheet.js
 *
 * Checks all seeded resident accounts in MongoDB, generates signed QR tokens (KBQR2)
 * for each resident, renders vector SVG QR codes, and compiles an interactive,
 * print-ready HTML testing sheet separated per barangay.
 *
 * Usage:
 *   node server/scripts/generateResidentQrSheet.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Resolve .env.local
const envLocalPath = path.resolve(__dirname, '../../.env.local');
require('dotenv').config({ path: envLocalPath });

// Resolve QRCode generator
let QRCode;
try {
  QRCode = require('qrcode');
} catch (e) {
  QRCode = require(path.resolve(__dirname, '../../../../../mobile/node_modules/qrcode'));
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';
const SIGNING_SECRET =
  process.env.RESIDENT_QR_SECRET ||
  process.env.JWT_SECRET ||
  'c84f2e9a7b3d1f06e8a54c2d9f7b3e1a06d8c4f2a9b7e3d1f5c8a2e6b0d4f8a1';

function sign(encodedPayload) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(encodedPayload).digest('base64url');
}

function buildResidentQrToken(residentCode, qrVersion = 1, issuedAt = new Date()) {
  const payload = {
    v: 2,
    t: 'resident',
    rid: String(residentCode || '').toUpperCase(),
    qv: Math.max(1, Number(qrVersion) || 1),
    iat: Math.floor(issuedAt.getTime() / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `KBQR2.${encoded}.${sign(encoded)}`;
}

async function generateSvgQr(text) {
  return await QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: 170,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const ResidentCollection = mongoose.connection.collection('residents');
  const residents = await ResidentCollection.find({})
    .sort({ barangay: 1, residentCode: 1 })
    .toArray();

  console.log(`Found ${residents.length} total resident accounts in database.`);

  // Group by barangay
  const barangayMap = {};
  for (const r of residents) {
    const b = r.barangay ? r.barangay.trim() : 'Unknown';
    if (!barangayMap[b]) barangayMap[b] = [];
    barangayMap[b].push(r);
  }

  const barangayNames = Object.keys(barangayMap).sort();
  console.log(`Organizing across ${barangayNames.length} barangays:`, barangayNames.join(', '));

  // Process and generate QR codes
  const processedBarangays = [];
  let totalProcessed = 0;

  for (const brgyName of barangayNames) {
    const rawList = barangayMap[brgyName];
    const items = [];

    for (const r of rawList) {
      const code = (r.residentCode || `RES-${String(r._id).slice(-6)}`).toUpperCase();
      const qrVer = r.qrVersion || 1;
      const issuedAt = r.qrIssuedAt ? new Date(r.qrIssuedAt) : new Date();
      const token = buildResidentQrToken(code, qrVer, issuedAt);
      const svg = await generateSvgQr(token);

      const fullName =
        r.fullName ||
        [r.firstName, r.lastName].filter(Boolean).join(' ') ||
        'Resident';

      items.push({
        id: String(r._id),
        residentCode: code,
        fullName,
        mobileNumber: r.mobileNumber || 'N/A',
        email: r.email || '',
        streetAddress: r.streetAddress || 'N/A',
        householdSize: r.householdSize || 1,
        vulnerableMembers: Array.isArray(r.vulnerableMembers) ? r.vulnerableMembers : [],
        status: r.status || 'Approved',
        qrStatus: r.qrStatus || 'ACTIVE',
        qrVersion: qrVer,
        qrToken: token,
        svgMarkup: svg,
      });
      totalProcessed++;
    }

    processedBarangays.push({
      barangay: brgyName,
      count: items.length,
      residents: items,
    });
  }

  console.log(`Generated QR codes for all ${totalProcessed} residents.`);

  // Build the self-contained HTML
  const jsonCatalog = JSON.stringify(
    processedBarangays.map((b) => ({
      barangay: b.barangay,
      count: b.count,
      residents: b.residents.map((r) => ({
        residentCode: r.residentCode,
        fullName: r.fullName,
        mobileNumber: r.mobileNumber,
        barangay: b.barangay,
        streetAddress: r.streetAddress,
        householdSize: r.householdSize,
        vulnerableMembers: r.vulnerableMembers,
        qrToken: r.qrToken,
      })),
    }))
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kapit-Bisig | Resident QR Code Directory (Testing Sheet)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #0F766E;
      --primary-dark: #0D5D56;
      --primary-light: #CCFBF1;
      --primary-accent: #14B8A6;
      --bg: #F8FAFC;
      --surface: #FFFFFF;
      --surface-subtle: #F1F5F9;
      --border: #E2E8F0;
      --border-focus: #0F766E;
      --text-main: #0F172A;
      --text-muted: #64748B;
      --text-subtle: #94A3B8;
      --success-bg: #DCFCE7;
      --success-text: #166534;
      --warning-bg: #FEF3C7;
      --warning-text: #92400E;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.05);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* Sticky Header */
    .top-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      box-shadow: var(--shadow-sm);
      padding: 14px 24px;
    }

    .header-inner {
      max-width: 1440px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .brand-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .brand-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #0F766E 0%, #14B8A6 100%);
      color: white;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      box-shadow: 0 2px 8px rgba(15, 118, 110, 0.3);
    }

    .brand-title h1 {
      font-size: 18px;
      font-weight: 800;
      color: var(--text-main);
      letter-spacing: -0.02em;
    }

    .brand-title p {
      font-size: 12px;
      color: var(--text-muted);
    }

    .header-stats {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .stat-pill {
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 9999px;
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stat-pill strong {
      color: var(--primary);
    }

    .action-btn {
      font-size: 12px;
      font-weight: 600;
      padding: 7px 14px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      border: 1px solid var(--border);
      background: white;
      color: var(--text-main);
    }

    .action-btn:hover {
      background: var(--surface-subtle);
      border-color: var(--text-subtle);
    }

    .action-btn-primary {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }

    .action-btn-primary:hover {
      background: var(--primary-dark);
      border-color: var(--primary-dark);
      color: white;
    }

    /* Search & Filter Row */
    .controls-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }

    .search-input-wrap {
      flex: 1;
      min-width: 280px;
      position: relative;
    }

    .search-input {
      width: 100%;
      padding: 9px 14px 9px 36px;
      font-size: 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text-main);
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .search-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.15);
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-subtle);
      pointer-events: none;
    }

    /* Barangay Filter Tabs */
    .barangay-tabs {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
      max-width: 100%;
      scrollbar-width: thin;
    }

    .tab-btn {
      white-space: nowrap;
      padding: 6px 12px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: white;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .tab-btn:hover {
      border-color: var(--primary);
      color: var(--primary);
    }

    .tab-btn.active {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
      box-shadow: 0 2px 6px rgba(15, 118, 110, 0.25);
    }

    .tab-btn .tab-count {
      background: rgba(0, 0, 0, 0.08);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
    }

    .tab-btn.active .tab-count {
      background: rgba(255, 255, 255, 0.25);
      color: white;
    }

    /* Main Container */
    .container {
      max-width: 1440px;
      margin: 24px auto;
      padding: 0 24px;
    }

    /* Instructions Alert */
    .notice-card {
      background: linear-gradient(135deg, #F0FDFA 0%, #E6FFFA 100%);
      border: 1px solid #99F6E4;
      border-radius: 12px;
      padding: 14px 20px;
      margin-bottom: 28px;
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .notice-icon {
      font-size: 20px;
      line-height: 1;
      margin-top: 2px;
    }

    .notice-text h3 {
      font-size: 14px;
      font-weight: 700;
      color: #0F766E;
      margin-bottom: 2px;
    }

    .notice-text p {
      font-size: 12.5px;
      color: #115E59;
      line-height: 1.4;
    }

    /* Barangay Section */
    .barangay-section {
      margin-bottom: 40px;
      scroll-margin-top: 150px;
    }

    .barangay-section.hidden {
      display: none;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 18px;
      background: white;
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      box-shadow: var(--shadow-sm);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-title h2 {
      font-size: 18px;
      font-weight: 800;
      color: var(--text-main);
      letter-spacing: -0.01em;
    }

    .section-title .brgy-badge {
      background: var(--primary-light);
      color: var(--primary-dark);
      font-size: 12px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 9999px;
    }

    .section-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .section-actions button {
      font-size: 11px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface-subtle);
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .section-actions button:hover {
      background: white;
      color: var(--text-main);
      border-color: var(--text-subtle);
    }

    /* Cards Grid */
    .resident-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
      gap: 16px;
    }

    /* Individual Resident Card */
    .resident-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-sm);
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      position: relative;
    }

    .resident-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: #CBD5E1;
    }

    .resident-card.match-highlight {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px var(--primary-light);
    }

    /* Card Top: QR Code Container */
    .qr-frame {
      width: 100%;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      cursor: pointer;
      margin-bottom: 14px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .qr-frame:hover {
      border-color: var(--primary);
      background: #F8FAFC;
    }

    .qr-frame svg {
      width: 170px;
      height: 170px;
      display: block;
    }

    .qr-overlay-hint {
      position: absolute;
      bottom: 6px;
      background: rgba(15, 23, 42, 0.75);
      color: white;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
    }

    .qr-frame:hover .qr-overlay-hint {
      opacity: 1;
    }

    /* Card Details */
    .resident-header {
      margin-bottom: 10px;
    }

    .resident-name {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .resident-code-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      color: var(--primary);
      background: var(--primary-light);
      padding: 3px 8px;
      border-radius: 6px;
      display: inline-block;
      letter-spacing: -0.01em;
    }

    .badge-approved {
      font-size: 10.5px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--success-bg);
      color: var(--success-text);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    /* Details Rows */
    .info-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
      font-size: 12px;
      flex-grow: 1;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px dashed #F1F5F9;
    }

    .info-row:last-child {
      border-bottom: none;
    }

    .info-label {
      color: var(--text-muted);
      font-weight: 500;
      white-space: nowrap;
    }

    .info-value {
      font-weight: 600;
      color: var(--text-main);
      text-align: right;
      word-break: break-word;
    }

    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      justify-content: flex-end;
    }

    .tag {
      background: #FEF3C7;
      color: #92400E;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }

    /* Action Buttons in Card */
    .card-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 6px;
    }

    .btn-card {
      padding: 7px 10px;
      font-size: 11.5px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface-subtle);
      color: var(--text-main);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .btn-card:hover {
      background: #E2E8F0;
    }

    .btn-card-primary {
      background: #F0FDFA;
      color: var(--primary);
      border-color: #99F6E4;
    }

    .btn-card-primary:hover {
      background: var(--primary);
      color: white;
      border-color: var(--primary);
    }

    /* Zoom / Enlarge Modal */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .modal-backdrop.open {
      display: flex;
    }

    .modal-box {
      background: white;
      border-radius: 20px;
      width: 100%;
      max-width: 480px;
      padding: 24px;
      box-shadow: var(--shadow-lg);
      position: relative;
      text-align: center;
      animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes modalPop {
      0% { transform: scale(0.92); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }

    .modal-close-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface-subtle);
      color: var(--text-muted);
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .modal-close-btn:hover {
      background: #E2E8F0;
      color: var(--text-main);
    }

    .modal-qr-target {
      margin: 16px auto;
      padding: 16px;
      background: #FFFFFF;
      border: 2px solid #E2E8F0;
      border-radius: 16px;
      display: inline-block;
    }

    .modal-qr-target svg {
      width: 260px;
      height: 260px;
      display: block;
    }

    .modal-name {
      font-size: 18px;
      font-weight: 800;
      color: var(--text-main);
      margin-bottom: 4px;
    }

    .modal-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: var(--primary);
      background: var(--primary-light);
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-block;
      margin-bottom: 16px;
    }

    .modal-payload-box {
      background: var(--surface-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
      word-break: break-all;
      text-align: left;
      max-height: 80px;
      overflow-y: auto;
      margin-bottom: 16px;
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2000;
      background: #0F172A;
      color: white;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      gap: 10px;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    }

    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    .toast-icon {
      color: #34D399;
      font-size: 16px;
    }

    /* Empty Search State */
    .empty-state {
      display: none;
      text-align: center;
      padding: 60px 20px;
      background: white;
      border: 1px solid var(--border);
      border-radius: 16px;
      margin: 20px 0;
    }

    .empty-state.show {
      display: block;
    }

    .empty-state h3 {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 6px;
    }

    .empty-state p {
      font-size: 14px;
      color: var(--text-muted);
    }

    /* Print Stylesheet */
    @media print {
      body {
        background: white !important;
        color: black !important;
        padding: 0 !important;
      }

      .top-header,
      .notice-card,
      .action-btn,
      .btn-card,
      .section-actions,
      .qr-overlay-hint {
        display: none !important;
      }

      .container {
        max-width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .barangay-section {
        page-break-before: always;
        break-before: page;
        margin-bottom: 20px !important;
      }

      .section-header {
        border: 2px solid #000 !important;
        background: #F1F5F9 !important;
        padding: 10px !important;
      }

      .section-title h2 {
        color: black !important;
        font-size: 16pt !important;
      }

      .resident-grid {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 12px !important;
      }

      .resident-card {
        border: 1px solid #666 !important;
        box-shadow: none !important;
        page-break-inside: avoid;
        break-inside: avoid;
        padding: 10px !important;
      }

      .qr-frame {
        border: 1px solid #999 !important;
        padding: 6px !important;
      }

      .qr-frame svg {
        width: 140px !important;
        height: 140px !important;
      }

      .card-actions {
        display: none !important;
      }
    }
  </style>
</head>
<body>

  <!-- Top Sticky Navigation & Controls -->
  <header class="top-header">
    <div class="header-inner">
      <div class="brand-row">
        <div class="brand-title">
          <div class="brand-logo-icon">KB</div>
          <div>
            <h1>Kapit-Bisig Resident QR Code Directory</h1>
            <p>Seeded Test Beneficiaries • Ready for Mobile Volunteer QR Scanner</p>
          </div>
        </div>

        <div class="header-stats">
          <div class="stat-pill">
            <span>Total:</span>
            <strong id="statTotalResidents">${totalProcessed}</strong>
            <span>residents</span>
          </div>
          <div class="stat-pill">
            <span>Barangays:</span>
            <strong>${barangayNames.length}</strong>
          </div>
          <div class="stat-pill">
            <span>Status:</span>
            <strong style="color: var(--success-text);">All Active</strong>
          </div>
          <button class="action-btn" onclick="window.print()">
            🖨️ Print / Save PDF
          </button>
          <button class="action-btn action-btn-primary" onclick="copyAllTokens()">
            📋 Copy All Tokens
          </button>
        </div>
      </div>

      <!-- Search & Filters -->
      <div class="controls-row">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            id="searchInput"
            class="search-input"
            placeholder="Search by name, ID code (e.g. PO-2026-000005), mobile number, or address..."
            oninput="handleSearch(this.value)"
          >
        </div>

        <!-- Barangay Filter Tabs -->
        <div class="barangay-tabs" id="barangayTabs">
          <button class="tab-btn active" data-barangay="ALL" onclick="filterBarangay('ALL')">
            All Barangays <span class="tab-count">${totalProcessed}</span>
          </button>
          ${processedBarangays
            .map(
              (b) => `
          <button class="tab-btn" data-barangay="${escapeHtml(b.barangay)}" onclick="filterBarangay('${escapeHtml(b.barangay)}')">
            ${escapeHtml(b.barangay)} <span class="tab-count">${b.count}</span>
          </button>`
            )
            .join('')}
        </div>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="container">

    <!-- Tip Notice -->
    <div class="notice-card">
      <div class="notice-icon">💡</div>
      <div class="notice-text">
        <h3>How to test with the Kapit-Bisig Mobile Volunteer Scanner:</h3>
        <p>
          Open the <strong>Kapit-Bisig Mobile App</strong>, sign in with your staff account (or <code>staff.test@kapitbisig.gov.ph</code> / <code>Staff123!</code>), navigate to the <strong>Volunteer Scanner Screen</strong>, and point your camera directly at any QR code on this page. Each code is signed with the server's cryptographic HMAC key (<code>KBQR2</code> protocol) and resolves instantaneously.
        </p>
      </div>
    </div>

    <!-- Empty Search State -->
    <div id="emptyState" class="empty-state">
      <h3>No matching resident found</h3>
      <p>Try searching with another name, resident code, or select "All Barangays".</p>
    </div>

    <!-- Barangay Sections -->
    <div id="sectionsContainer">
      ${processedBarangays
        .map(
          (b) => `
      <section class="barangay-section" id="barangay-${escapeHtml(b.barangay.toLowerCase().replace(/\\s+/g, '-'))}" data-barangay="${escapeHtml(b.barangay)}">
        <div class="section-header">
          <div class="section-title">
            <h2>📍 Barangay ${escapeHtml(b.barangay)}</h2>
            <span class="brgy-badge">${b.count} Residents</span>
          </div>
          <div class="section-actions">
            <button onclick="copyBarangayTokens('${escapeHtml(b.barangay)}')">Copy All Tokens (${b.count})</button>
            <button onclick="window.scrollTo({top: 0, behavior: 'smooth'})">↑ Back to Top</button>
          </div>
        </div>

        <div class="resident-grid">
          ${b.residents
            .map(
              (r) => `
          <div class="resident-card" id="card-${r.id}" data-search="${escapeHtml(
                `${r.fullName} ${r.residentCode} ${r.mobileNumber} ${b.barangay} ${r.streetAddress}`.toLowerCase()
              )}">
            
            <!-- QR Frame -->
            <div class="qr-frame" onclick="openQrModal('${r.id}')" title="Click to enlarge QR code">
              ${r.svgMarkup}
              <div class="qr-overlay-hint">🔍 Click to Enlarge</div>
            </div>

            <!-- Header -->
            <div class="resident-header">
              <div class="resident-name">
                <span title="${escapeHtml(r.fullName)}">${escapeHtml(r.fullName)}</span>
                <span class="badge-approved">${r.status}</span>
              </div>
              <div class="resident-code-badge">${escapeHtml(r.residentCode)}</div>
            </div>

            <!-- Info Rows -->
            <div class="info-list">
              <div class="info-row">
                <span class="info-label">Mobile</span>
                <span class="info-value">
                  <a href="tel:${escapeHtml(r.mobileNumber)}" style="color: inherit; text-decoration: none;">${escapeHtml(r.mobileNumber)}</a>
                </span>
              </div>
              <div class="info-row">
                <span class="info-label">Barangay</span>
                <span class="info-value">${escapeHtml(b.barangay)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Address</span>
                <span class="info-value" title="${escapeHtml(r.streetAddress)}">${escapeHtml(r.streetAddress)}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Household</span>
                <span class="info-value">${r.householdSize} member${r.householdSize > 1 ? 's' : ''}</span>
              </div>
              ${
                r.vulnerableMembers.length > 0
                  ? `
              <div class="info-row">
                <span class="info-label">Tags</span>
                <div class="tag-list">
                  ${r.vulnerableMembers.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
                </div>
              </div>`
                  : ''
              }
            </div>

            <!-- Card Actions -->
            <div class="card-actions">
              <button class="btn-card" onclick="copyText('${escapeHtml(r.residentCode)}', 'Resident code ${escapeHtml(r.residentCode)} copied!')">
                🆔 Copy ID
              </button>
              <button class="btn-card btn-card-primary" onclick="copyText('${escapeHtml(r.qrToken)}', 'QR Token copied for ${escapeHtml(r.fullName)}!')">
                📋 Copy Token
              </button>
            </div>
          </div>
          `
            )
            .join('')}
        </div>
      </section>
      `
        )
        .join('')}
    </div>

  </main>

  <!-- Large QR Modal -->
  <div class="modal-backdrop" id="qrModal" onclick="closeModalOnBackdrop(event)">
    <div class="modal-box">
      <button class="modal-close-btn" onclick="closeQrModal()">&times;</button>
      <h3 class="modal-name" id="modalResidentName">Resident Name</h3>
      <div class="modal-code" id="modalResidentCode">PO-2026-000000</div>
      
      <div class="modal-qr-target" id="modalQrSvg">
        <!-- Enlarged SVG injected here -->
      </div>
      
      <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Full Signed Payload (KBQR2):</p>
      <div class="modal-payload-box" id="modalPayload"></div>

      <div style="display: flex; gap: 8px; justify-content: center;">
        <button class="action-btn action-btn-primary" onclick="copyModalToken()">📋 Copy QR Token</button>
        <button class="action-btn" onclick="closeQrModal()">Close</button>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div class="toast" id="toast">
    <span class="toast-icon">✓</span>
    <span id="toastMessage">Copied to clipboard</span>
  </div>

  <!-- Client-side Interactive Script -->
  <script>
    const CATALOG = ${jsonCatalog};
    const RESIDENT_MAP = {};
    
    // Index residents
    CATALOG.forEach(b => {
      b.residents.forEach(r => {
        RESIDENT_MAP[r.residentCode] = r;
      });
    });

    let currentBarangay = 'ALL';
    let currentSearch = '';
    let activeModalToken = '';

    function filterBarangay(brgy) {
      currentBarangay = brgy;
      
      // Update tab buttons
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.barangay === brgy);
      });

      applyFilters();

      // Scroll to section if single barangay picked
      if (brgy !== 'ALL') {
        const slug = brgy.toLowerCase().replace(/\\s+/g, '-');
        const target = document.getElementById('barangay-' + slug);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    function handleSearch(val) {
      currentSearch = val.trim().toLowerCase();
      applyFilters();
    }

    function applyFilters() {
      let visibleTotal = 0;
      const sections = document.querySelectorAll('.barangay-section');
      
      sections.forEach(section => {
        const sectionBrgy = section.dataset.barangay;
        const matchesTab = currentBarangay === 'ALL' || currentBarangay === sectionBrgy;
        
        let visibleInBrgy = 0;
        const cards = section.querySelectorAll('.resident-card');

        cards.forEach(card => {
          const text = card.dataset.search || '';
          const matchesSearch = !currentSearch || text.includes(currentSearch);

          if (matchesTab && matchesSearch) {
            card.style.display = 'flex';
            visibleInBrgy++;
            visibleTotal++;
          } else {
            card.style.display = 'none';
          }
        });

        // Hide section entirely if no cards match
        if (visibleInBrgy > 0) {
          section.style.display = 'block';
        } else {
          section.style.display = 'none';
        }
      });

      // Empty state
      const emptyState = document.getElementById('emptyState');
      if (visibleTotal === 0) {
        emptyState.classList.add('show');
      } else {
        emptyState.classList.remove('show');
      }

      document.getElementById('statTotalResidents').innerText = visibleTotal;
    }

    // Modal Handling
    function openQrModal(cardId) {
      const card = document.getElementById('card-' + cardId);
      if (!card) return;

      const name = card.querySelector('.resident-name span').innerText;
      const code = card.querySelector('.resident-code-badge').innerText;
      const svg = card.querySelector('.qr-frame svg').cloneNode(true);
      
      // Find full token from map
      const resident = RESIDENT_MAP[code];
      const token = resident ? resident.qrToken : '';
      activeModalToken = token;

      document.getElementById('modalResidentName').innerText = name;
      document.getElementById('modalResidentCode').innerText = code;
      document.getElementById('modalPayload').innerText = token;

      const target = document.getElementById('modalQrSvg');
      target.innerHTML = '';
      target.appendChild(svg);

      document.getElementById('qrModal').classList.add('open');
    }

    function closeQrModal() {
      document.getElementById('qrModal').classList.remove('open');
    }

    function closeModalOnBackdrop(e) {
      if (e.target.id === 'qrModal') {
        closeQrModal();
      }
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeQrModal();
    });

    // Toast and Clipboard
    let toastTimeout = null;
    function showToast(msg) {
      const toast = document.getElementById('toast');
      document.getElementById('toastMessage').innerText = msg;
      toast.classList.add('show');

      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
      }, 2500);
    }

    function copyText(text, successMsg) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg || 'Copied to clipboard!');
      }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(successMsg || 'Copied to clipboard!');
      });
    }

    function copyModalToken() {
      if (activeModalToken) {
        copyText(activeModalToken, 'Full QR Token copied!');
      }
    }

    function copyBarangayTokens(brgy) {
      const target = CATALOG.find(b => b.barangay === brgy);
      if (!target) return;
      const tokens = target.residents.map(r => r.residentCode + '\\t' + r.fullName + '\\t' + r.qrToken).join('\\n');
      copyText(tokens, 'Copied all ' + target.residents.length + ' tokens for ' + brgy + '!');
    }

    function copyAllTokens() {
      const allTokens = [];
      CATALOG.forEach(b => {
        b.residents.forEach(r => {
          allTokens.push(b.barangay + '\\t' + r.residentCode + '\\t' + r.fullName + '\\t' + r.qrToken);
        });
      });
      copyText(allTokens.join('\\n'), 'Copied all ' + allTokens.length + ' resident tokens to clipboard!');
    }
  </script>
</body>
</html>`;

  // Output paths - Root directory and apps directory
  const rootOutput = path.resolve(__dirname, '../../../../../resident_qr_codes.html');
  const legacyOutput = path.resolve(__dirname, '../../../../../qr_test_sheet.html');

  fs.writeFileSync(rootOutput, html, 'utf8');
  fs.writeFileSync(legacyOutput, html, 'utf8');

  console.log(`\n======================================================`);
  console.log(`🎉 SUCCESS! Compiled 1 self-contained HTML testing file:`);
  console.log(`   1. ${rootOutput}`);
  console.log(`   2. ${legacyOutput}`);
  console.log(`======================================================\n`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error during QR sheet generation:', err);
  process.exit(1);
});

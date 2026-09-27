/**
 * Generate Interactive Resident QR Test Sheet
 *
 * Usage:
 *   node server/scripts/generateQrSheet.js
 *   node server/scripts/generateQrSheet.js --barangay "San Jose"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kapit-bisig';
const JWT_SECRET = process.env.RESIDENT_QR_SECRET || process.env.JWT_SECRET || 'c84f2e9a7b3d1f06e8a54c2d9f7b3e1a06d8c4f2a9b7e3d1f5c8a2e6b0d4f8a1';

function sign(encodedPayload) {
  return crypto.createHmac('sha256', JWT_SECRET).update(encodedPayload).digest('base64url');
}

function buildResidentQrToken(residentCode, qrVersion = 1, issuedAt = new Date()) {
  const payload = {
    v: 2,
    t: 'resident',
    rid: String(residentCode || '').toUpperCase(),
    qv: Math.max(1, qrVersion || 1),
    iat: Math.floor(issuedAt.getTime() / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `KBQR2.${encoded}.${sign(encoded)}`;
}

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const filterBarangay = getArg('--barangay');
  const Resident = mongoose.connection.collection('residents');

  const query = { status: 'Approved' };
  if (filterBarangay) {
    query.barangay = filterBarangay;
  }

  const residents = await Resident.find(query).sort({ barangay: 1, fullName: 1 }).toArray();
  console.log(`Found ${residents.length} approved resident(s).`);

  if (residents.length === 0) {
    console.log('No approved residents found matching query.');
    return;
  }

  const residentCards = residents.map((r) => {
    const residentCode = r.residentCode || `RES-${String(r._id).slice(-6).toUpperCase()}`;
    const qrToken = buildResidentQrToken(residentCode, r.qrVersion || 1);
    return {
      id: String(r._id),
      fullName: r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Anonymous Resident',
      residentCode,
      barangay: r.barangay || 'Unknown',
      streetAddress: r.streetAddress || 'N/A',
      householdSize: r.householdSize || 1,
      mobileNumber: r.mobileNumber || 'N/A',
      qrToken,
    };
  });

  const barangayList = Array.from(new Set(residentCards.map((r) => r.barangay))).sort();

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kapit-Bisig | Resident QR Code Test Sheet</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <style>
    :root {
      --bg: #F8FAFC;
      --card-bg: #FFFFFF;
      --primary: #0F766E;
      --primary-dark: #0D5D56;
      --text-main: #0F172A;
      --text-muted: #64748B;
      --border: #E2E8F0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: var(--bg); color: var(--text-main); padding: 24px; }
    .header { max-width: 1300px; margin: 0 auto 24px auto; background: var(--card-bg); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .header h1 { font-size: 24px; font-weight: 800; color: var(--primary); display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .header p { color: var(--text-muted); font-size: 14px; line-height: 1.5; }
    .banner { margin-top: 14px; background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; padding: 12px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; display: flex; align-items: center; justify-content: space-between; }
    .filters { max-width: 1300px; margin: 0 auto 20px auto; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .search-box { flex: 1; min-width: 260px; padding: 10px 16px; border: 1px solid var(--border); border-radius: 10px; font-size: 14px; outline: none; background: white; }
    .search-box:focus { border-color: var(--primary); }
    .filter-btn { padding: 8px 16px; border: 1px solid var(--border); border-radius: 20px; background: white; font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; transition: all 0.15s ease; }
    .filter-btn.active, .filter-btn:hover { background: var(--primary); color: white; border-color: var(--primary); }
    .grid { max-width: 1300px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 18px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 14px; padding: 18px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.15s ease, box-shadow 0.15s ease; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(0,0,0,0.06); }
    .qr-container { display: flex; justify-content: center; align-items: center; width: 180px; height: 180px; margin: 0 auto 14px auto; background: #FFFFFF; padding: 10px; border: 2px solid #F1F5F9; border-radius: 12px; }
    .qr-container img, .qr-container canvas { width: 100% !important; height: 100% !important; }
    .resident-name { font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .resident-code { font-family: monospace; font-size: 12px; font-weight: 700; color: var(--primary); background: #F0FDFA; padding: 3px 8px; border-radius: 6px; display: inline-block; margin-bottom: 8px; }
    .meta-row { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; display: flex; justify-content: space-between; padding: 0 4px; }
    .copy-btn { margin-top: 12px; width: 100%; padding: 8px; background: #F1F5F9; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; font-weight: 600; color: var(--text-main); cursor: pointer; transition: background 0.15s ease; }
    .copy-btn:hover { background: #E2E8F0; }
    .badge { padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .badge-approved { background: #DCFCE7; color: #166534; }
  </style>
</head>
<body>

  <div class="header">
    <h1>📱 Kapit-Bisig QR Code Test Gallery</h1>
    <p>Use your phone's Volunteer Scanner screen to scan these QR codes directly from your computer monitor to test rapid identity resolution and claim recording.</p>
    <div class="banner">
      <span>💡 <strong>Quick Test Tip:</strong> Make sure the target barangay has an active distribution with your staff account assigned.</span>
      <span id="residentCountBadge" style="font-weight: 700;">${residentCards.length} Residents</span>
    </div>
  </div>

  <div class="filters">
    <input type="text" id="searchBox" class="search-box" placeholder="Search resident name or code (e.g. San Jose, SJ-2026)...">
    <button class="filter-btn active" onclick="setBarangay('ALL')">All Barangays</button>
    ${barangayList.map((b) => `<button class="filter-btn" onclick="setBarangay('${b}')">${b}</button>`).join('')}
  </div>

  <div class="grid" id="cardGrid"></div>

  <script>
    const residents = ${JSON.stringify(residentCards)};
    let activeFilter = 'ALL';
    let searchQuery = '';

    function renderCards() {
      const container = document.getElementById('cardGrid');
      container.innerHTML = '';

      const filtered = residents.filter(r => {
        const matchesBarangay = activeFilter === 'ALL' || r.barangay === activeFilter;
        const matchesSearch = !searchQuery || 
          r.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.residentCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.barangay.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesBarangay && matchesSearch;
      });

      document.getElementById('residentCountBadge').innerText = filtered.length + ' Resident' + (filtered.length === 1 ? '' : 's');

      filtered.forEach((r, idx) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="qr-container" id="qr_\${r.id}"></div>
          <div class="resident-name" title="\${r.fullName}">\${r.fullName}</div>
          <div class="resident-code">\${r.residentCode}</div>
          <div class="meta-row">
            <span>Barangay</span>
            <strong>\${r.barangay}</strong>
          </div>
          <div class="meta-row">
            <span>Household Size</span>
            <strong>\${r.householdSize} member(s)</strong>
          </div>
          <div class="meta-row">
            <span>Status</span>
            <span class="badge badge-approved">Approved</span>
          </div>
          <button class="copy-btn" id="btn_\${r.id}" onclick="copyToken('\${r.qrToken}', '\${r.id}')">Copy QR Payload</button>
        \`;
        container.appendChild(card);

        // Generate QR code into container
        new QRCode(document.getElementById('qr_' + r.id), {
          text: r.qrToken,
          width: 160,
          height: 160,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      });
    }

    function setBarangay(b) {
      activeFilter = b;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText === (b === 'ALL' ? 'All Barangays' : b));
      });
      renderCards();
    }

    document.getElementById('searchBox').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderCards();
    });

    function copyToken(token, id) {
      navigator.clipboard.writeText(token).then(() => {
        const btn = document.getElementById('btn_' + id);
        const originalText = btn.innerText;
        btn.innerText = '✓ Copied!';
        btn.style.background = '#DCFCE7';
        btn.style.color = '#166534';
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.background = '';
          btn.style.color = '';
        }, 1500);
      });
    }

    renderCards();
  </script>
</body>
</html>`;

  const outputPath = path.resolve(__dirname, '../../../../qr_test_sheet.html');
  fs.writeFileSync(outputPath, htmlContent, 'utf8');

  console.log(`\nSuccessfully created interactive QR Test Sheet at:`);
  console.log(outputPath);
}

main()
  .catch((err) => {
    console.error('Error generating QR sheet:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

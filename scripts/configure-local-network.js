#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs')
const os = require('os')
const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..')

function isPrivateIpv4(address) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false
  const parts = address.split('.').map(Number)
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true

  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
}

function interfaceScore(name) {
  const normalized = name.toLowerCase()
  let score = 0

  if (/wi-?fi|wireless|wlan/.test(normalized)) score += 100
  if (/ethernet|local area connection/.test(normalized)) score += 70
  if (/vethernet|virtual|vmware|hyper-v|docker|wsl|bluetooth|loopback/.test(normalized)) score -= 150

  return score
}

function detectLanIp() {
  const override = String(process.env.KAPIT_BISIG_LAN_IP || '').trim()
  if (override) {
    if (!isPrivateIpv4(override)) {
      throw new Error(`KAPIT_BISIG_LAN_IP must be a private IPv4 address, received "${override}".`)
    }
    return override
  }

  const candidates = []
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4
      if (!isIpv4 || entry.internal || !isPrivateIpv4(entry.address)) continue
      candidates.push({
        address: entry.address,
        name,
        score: interfaceScore(name),
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  if (candidates.length === 0) {
    throw new Error(
      'No active private Wi-Fi/Ethernet IPv4 address was found. Connect to a network or set KAPIT_BISIG_LAN_IP.',
    )
  }

  return candidates[0].address
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function updateEnvFile(relativePath, updates) {
  const filePath = path.join(workspaceRoot, relativePath)
  const exists = fs.existsSync(filePath)
  let contents = exists ? fs.readFileSync(filePath, 'utf8') : ''
  const originalContents = contents
  const newline = contents.includes('\r\n') ? '\r\n' : '\n'

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
    const nextLine = `${key}=${value}`
    if (pattern.test(contents)) {
      contents = contents.replace(pattern, nextLine)
    } else {
      if (contents && !contents.endsWith('\n')) contents += newline
      contents += `${nextLine}${newline}`
    }
  }

  if (!exists || contents !== originalContents) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, contents, 'utf8')
  }
  return relativePath
}

try {
  const lanIp = detectLanIp()
  const apiUrl = `http://${lanIp}:3001/api`
  const faceApiUrl = `http://${lanIp}:8000`
  const webOrigins = `http://localhost:3000,http://${lanIp}:3000`

  const mobileEnvPath = path.join(workspaceRoot, 'mobile/.env')
  const mobileEnvExists = fs.existsSync(mobileEnvPath)
  const mobileEnvContent = mobileEnvExists ? fs.readFileSync(mobileEnvPath, 'utf8') : ''
  const hasHttpsApiUrl = /^EXPO_PUBLIC_API_URL\s*=\s*https:\/\//m.test(mobileEnvContent)
  const forceLocal = process.argv.includes('--force-local') || process.env.FORCE_LOCAL_NETWORK === 'true'

  const updatedFiles = []

  if (hasHttpsApiUrl && !forceLocal) {
    console.log('[configure-local-network] Preserving production deployment URL (https://) in mobile/.env')
  } else {
    updatedFiles.push(
      updateEnvFile('mobile/.env', {
        EXPO_PUBLIC_API_URL: apiUrl,
        EXPO_PUBLIC_FACE_API_URL: faceApiUrl,
      })
    )
  }

  updatedFiles.push(
    updateEnvFile('apps/web/apps/.env.local', {
      NEXT_PUBLIC_API_URL: '/api',
      API_PROXY_TARGET: 'http://127.0.0.1:3001/api',
      CORS_ORIGIN: webOrigins,
    }),
    updateEnvFile('backend/.env', {
      FACE_API_ALLOWED_ORIGINS: webOrigins,
    }),
  )

  console.log(`Local network configured for ${lanIp}`)
  console.log(`Mobile API: ${apiUrl}`)
  console.log(`Face API:   ${faceApiUrl}`)
  console.log(`Updated:    ${updatedFiles.join(', ')}`)
} catch (error) {
  console.error(`Local network configuration failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

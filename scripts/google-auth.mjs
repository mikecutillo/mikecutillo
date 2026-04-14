#!/usr/bin/env node
/**
 * One-time Google OAuth2 token helper for Mission Control calendar integration.
 *
 * Usage:
 *   1. Fill in CLIENT_ID and CLIENT_SECRET below (from Google Cloud Console)
 *   2. Run: node scripts/google-auth.mjs
 *   3. For each account, open the URL printed, authorize, paste the code back
 *   4. Copy the refresh token into mission-control/.env.local
 */

import http from 'http'
import { URL } from 'url'
import { google } from 'googleapis'

// ── Paste your credentials here ──────────────────────────────────────────────
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
// ─────────────────────────────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nERROR: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local first,')
  console.error('then run: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/google-auth.mjs\n')
  process.exit(1)
}

const REDIRECT_URI = 'http://localhost:3334/callback'
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

const ACCOUNTS = [
  { name: 'Mike (cutillo@gmail.com)', envKey: 'GOOGLE_MIKE_REFRESH_TOKEN' },
  { name: 'Erin primary (erincutillo@gmail.com)', envKey: 'GOOGLE_ERIN_REFRESH_TOKEN' },
  { name: 'Erin alias (erinrameyallen@gmail.com)', envKey: 'GOOGLE_ERIN2_REFRESH_TOKEN' },
]

async function getRefreshToken(accountName) {
  return new Promise((resolve, reject) => {
    const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

    const authUrl = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    })

    console.log(`\n──────────────────────────────────────────────`)
    console.log(`Account: ${accountName}`)
    console.log(`──────────────────────────────────────────────`)
    console.log(`\nOpen this URL in a browser (use an incognito window for each account):\n`)
    console.log(authUrl)
    console.log(`\nWaiting for callback on http://localhost:3334/callback ...`)

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost:3334')
        if (url.pathname !== '/callback') return

        const code = url.searchParams.get('code')
        if (!code) {
          res.end('No code received.')
          return reject(new Error('No code in callback'))
        }

        res.end('<h2>Authorization successful! You can close this tab.</h2>')
        server.close()

        const { tokens } = await oauth2.getToken(code)
        resolve(tokens.refresh_token)
      } catch (err) {
        res.end('Error: ' + err.message)
        server.close()
        reject(err)
      }
    })

    server.listen(3334, () => {})
    server.on('error', reject)
  })
}

console.log('\n=== Mission Control — Google Calendar Auth ===')
console.log('This script gets OAuth2 refresh tokens for each Google account.')
console.log('You will need to sign in once per account.\n')

for (const account of ACCOUNTS) {
  try {
    const token = await getRefreshToken(account.name)
    if (token) {
      console.log(`\n✓ Got refresh token for ${account.name}`)
      console.log(`\nAdd this to mission-control/.env.local:`)
      console.log(`${account.envKey}=${token}\n`)
    } else {
      console.log(`\n⚠ No refresh token returned for ${account.name}`)
      console.log(`  (This can happen if the account was previously authorized — revoke access`)
      console.log(`   at myaccount.google.com/permissions and try again)\n`)
    }
  } catch (err) {
    console.error(`\n✗ Failed for ${account.name}:`, err.message)
  }
}

console.log('\n=== Done ===')
console.log('Copy the refresh tokens above into mission-control/.env.local\n')

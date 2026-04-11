// Firebase Admin SDK — ใช้ฝั่ง server เท่านั้น (API routes)
// Decode service account JSON จาก base64 env var
import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getAuth, Auth } from 'firebase-admin/auth'

let app: App | null = null

function getAdminApp(): App {
  if (app) return app
  if (getApps().length > 0) {
    app = getApps()[0]
    return app
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64
  if (!b64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 env var not set')
  }

  let serviceAccount: any
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8')
    serviceAccount = JSON.parse(json)
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_B64 invalid base64 or JSON')
  }

  app = initializeApp({
    credential: cert(serviceAccount),
  })
  return app
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}

// Firebase client SDK — ใช้ฝั่ง browser เท่านั้น (client components)
// อย่า import ใน server components หรือ API routes
import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import { getAuth, Auth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

let app: FirebaseApp | null = null
let auth: Auth | null = null

export function getFirebaseAuth(): Auth {
  if (typeof window === 'undefined') {
    throw new Error('getFirebaseAuth() called on server — use client only')
  }
  if (!app) {
    app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig)
  }
  if (!auth) {
    auth = getAuth(app)
    // Use Thai locale for SMS
    auth.languageCode = 'th'
  }
  return auth
}

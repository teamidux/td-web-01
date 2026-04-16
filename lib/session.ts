// Server-side session helpers — HTTP-only cookie + DB-backed session token.
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'

const COOKIE_NAME = 'bm_session'
const SESSION_TTL_DAYS = 60

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function createSession(userId: string, opts?: { ua?: string; ip?: string }): Promise<{ token: string; error?: string }> {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  const { error } = await admin().from('sessions').insert({
    token,
    user_id: userId,
    expires_at: expires.toISOString(),
    user_agent: opts?.ua || null,
    ip: opts?.ip || null,
  })
  if (error) {
    console.error('[session] insert error:', error)
    return { token, error: `${error.code || ''}:${(error.message || '').slice(0, 100)}` }
  }
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
  return { token }
}

export async function getSessionUser(): Promise<any | null> {
  const token = cookies().get(COOKIE_NAME)?.value
  if (!token) return null
  // Single query with join — ลด round-trip จาก 2 เหลือ 1
  const { data: session } = await admin()
    .from('sessions')
    .select('expires_at, users(*)')
    .eq('token', token)
    .maybeSingle()
  if (!session || new Date(session.expires_at) < new Date()) return null
  const u = (session as any).users
  if (!u) return null
  // Banned หรือ soft-deleted → ถือว่าไม่มี session
  if (u.banned_at || u.deleted_at) return null
  return u
}

// เช็คว่า session มี user ที่โดน ban ไหม (สำหรับแสดง popup)
export async function getBannedStatus(): Promise<{ banned: boolean; reason?: string } | null> {
  const token = cookies().get(COOKIE_NAME)?.value
  if (!token) return null
  const { data: session } = await admin()
    .from('sessions')
    .select('users(banned_at, banned_reason)')
    .eq('token', token)
    .maybeSingle()
  if (!session) return null
  const u = (session as any).users
  if (u?.banned_at) return { banned: true, reason: u.banned_reason || undefined }
  return null
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value
  if (token) {
    await admin().from('sessions').delete().eq('token', token)
  }
  cookies().delete(COOKIE_NAME)
}

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

export async function createSession(userId: string, opts?: { ua?: string; ip?: string }): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
  await admin().from('sessions').insert({
    token,
    user_id: userId,
    expires_at: expires.toISOString(),
    user_agent: opts?.ua || null,
    ip: opts?.ip || null,
  })
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  })
  return token
}

export async function getSessionUser(): Promise<any | null> {
  const token = cookies().get(COOKIE_NAME)?.value
  if (!token) return null
  const s = admin()
  const { data: session } = await s
    .from('sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (!session || new Date(session.expires_at) < new Date()) return null
  const { data: user } = await s.from('users').select('*').eq('id', session.user_id).maybeSingle()
  return user
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(COOKIE_NAME)?.value
  if (token) {
    await admin().from('sessions').delete().eq('token', token)
  }
  cookies().delete(COOKIE_NAME)
}

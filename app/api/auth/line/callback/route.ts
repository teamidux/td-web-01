// Handles return from LINE OAuth — exchanges code for token, creates user + session.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { createSession, getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const errorParam = req.nextUrl.searchParams.get('error')

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get('host')}`
  const redirectError = (msg: string) => NextResponse.redirect(`${siteUrl}/?login_error=${encodeURIComponent(msg)}`)

  if (errorParam) return redirectError(errorParam)
  if (!code || !state) return redirectError('missing_params')

  // Validate state
  const stateCookie = cookies().get('bm_oauth_state')?.value
  if (!stateCookie) return redirectError('state_expired')
  let savedState: { state: string; next: string }
  try {
    savedState = JSON.parse(stateCookie)
  } catch {
    return redirectError('state_invalid')
  }
  if (savedState.state !== state) return redirectError('state_mismatch')
  cookies().delete('bm_oauth_state')

  const channelId = process.env.LINE_CHANNEL_ID!
  const channelSecret = process.env.LINE_CHANNEL_SECRET!
  const redirectUri = `${siteUrl}/api/auth/line/callback`

  // Exchange code for access token
  let tokenRes: Response
  try {
    tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    })
  } catch {
    return redirectError('line_unreachable')
  }
  if (!tokenRes.ok) return redirectError('token_exchange_failed')
  const tokenJson = await tokenRes.json()
  const accessToken: string = tokenJson.access_token
  if (!accessToken) return redirectError('no_access_token')

  // Get profile
  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileRes.ok) return redirectError('profile_fetch_failed')
  const profile = await profileRes.json()
  const lineUserId: string = profile.userId
  const displayName: string = profile.displayName || 'นักอ่าน'
  const pictureUrl: string | null = profile.pictureUrl || null

  if (!lineUserId) return redirectError('no_line_user_id')

  // Find or create user
  const sb = admin()
  const { data: existing, error: selectErr } = await sb.from('users').select('id, display_name, avatar_url, line_id, line_user_id').eq('line_user_id', lineUserId).maybeSingle()
  if (selectErr) {
    console.error('[line/callback] select error:', selectErr)
    return redirectError(`select_failed:${selectErr.code || ''}:${(selectErr.message || '').slice(0, 80)}`)
  }

  let userId: string
  if (existing) {
    userId = existing.id
    // Only fill in missing fields — never overwrite data the user already has
    const patch: Record<string, string> = {}
    if (!existing.display_name) patch.display_name = displayName
    if (!existing.avatar_url) patch.avatar_url = pictureUrl ?? undefined!
    if (Object.keys(patch).length > 0) {
      await sb.from('users').update(patch).eq('id', userId)
    }
  } else {
    // ถ้า user login อยู่แล้ว (เช่น login ด้วยเบอร์/FB มาก่อน) → link LINE เข้า account เดิม
    const currentUser = await getSessionUser()
    if (currentUser) {
      await sb.from('users').update({ line_user_id: lineUserId }).eq('id', currentUser.id)
      userId = currentUser.id
    } else {
      const { data: newUser, error } = await sb
        .from('users')
        .insert({
          line_user_id: lineUserId,
          display_name: displayName,
          avatar_url: pictureUrl,
          plan: 'free',
          listings_limit: 20,
          seller_type: 'individual',
        })
        .select('id')
        .single()
      if (error || !newUser) {
        console.error('[line/callback] insert error:', error)
        const errMsg = error ? `${error.code || ''}:${(error.message || '').slice(0, 80)}` : 'no_user_returned'
        return redirectError(`user_create_failed:${errMsg}`)
      }
      userId = newUser.id
    }
  }

  // Create session
  const sessionResult = await createSession(userId, {
    ua: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for') || undefined,
  })
  if (sessionResult.error) {
    return redirectError(`session_failed:${sessionResult.error}`)
  }

  // Reauth flow: user มาเปลี่ยน LINE ID → set cookie ให้ /api/user/update ผ่าน
  // (next จะมี ?reauth=line ติดมา จาก profile page)
  const isReauth = savedState.next?.includes('reauth=line')
  if (isReauth) {
    cookies().set('bm_line_reauth', '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600, // 10 นาที — user มีเวลาพอที่จะ save
      path: '/',
    })
  }

  // ไม่ต้อง onboarding แล้ว — LINE ID เป็น optional ใน edit profile
  return NextResponse.redirect(`${siteUrl}${savedState.next || '/'}`)
}

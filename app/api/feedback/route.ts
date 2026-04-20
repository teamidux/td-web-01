// Feedback / complaint endpoint — ใครก็ส่งได้ (ไม่ต้อง login)
// กัน spam:
//   1. Honeypot field `website` — ถ้า bot กรอก → return ok แต่ไม่ insert
//   2. Rate limit ด้วย IP hash (6 ครั้ง/ชั่วโมง/IP)
//   3. ความยาว message limit 2000 ตัวอักษร
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_KINDS = new Set(['complaint', 'suggestion', 'bug', 'general'])

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY || '')).digest('hex').slice(0, 32)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })

    // Honeypot — ถ้า bot กรอก website → ตอบ ok แต่ไม่ insert (bot คิดว่าผ่าน)
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return NextResponse.json({ ok: true })
    }

    const kind = typeof body.kind === 'string' && VALID_KINDS.has(body.kind) ? body.kind : 'general'
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, 200) : ''

    if (!message) return NextResponse.json({ error: 'missing_message' }, { status: 400 })
    if (message.length > 2000) return NextResponse.json({ error: 'message_too_long' }, { status: 400 })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || '0.0.0.0'
    const ipHash = hashIp(ip)
    const userAgent = req.headers.get('user-agent')?.slice(0, 500) || null

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const user = await getSessionUser()

    // Rate limit 2 ชั้น:
    //   - ถ้า login: 3 ครั้ง/ชม./user (attacker สลับ IP ไม่ช่วย)
    //   - ไม่ login: 3 ครั้ง/ชม./IP (เดิม — anon)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    if (user) {
      const { count: userCount } = await sb.from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', oneHourAgo)
      if ((userCount || 0) >= 3) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
      }
    } else {
      const { count: ipCount } = await sb.from('feedback')
        .select('*', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', oneHourAgo)
      if ((ipCount || 0) >= 3) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
      }
    }
    const { error } = await sb.from('feedback').insert({
      kind,
      message,
      contact: contact || null,
      user_id: user?.id || null,
      user_agent: userAgent,
      ip_hash: ipHash,
    })
    if (error) {
      console.error('[feedback] db error:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

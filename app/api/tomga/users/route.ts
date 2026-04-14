// Admin: user management — list + search + ban/unban/soft_delete + suspicious detection
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isAdmin } from '@/lib/admin'
import { logAdminAction } from '@/lib/audit'

export const runtime = 'nodejs'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// getSessionUser() returns null for banned users — we need direct lookup here to verify admin identity
async function currentAdmin() {
  const token = cookies().get('bm_session')?.value
  if (!token) return null
  const db = sb()
  const { data } = await db.from('sessions').select('users(id)').eq('token', token).maybeSingle()
  const id = (data as any)?.users?.id
  return id && isAdmin(id) ? id : null
}

type UserRow = {
  id: string
  display_name: string
  phone: string | null
  line_id: string | null
  line_user_id: string | null
  avatar_url: string | null
  created_at: string
  id_verified_at: string | null
  phone_verified_at: string | null
  banned_at: string | null
  banned_reason: string | null
  deleted_at: string | null
  deleted_reason: string | null
  flags?: string[]
  listings_count?: number
  reports_count?: number
}

export async function GET(req: NextRequest) {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const tab = url.searchParams.get('tab') || 'all' // all | suspicious | banned | deleted
  const q = (url.searchParams.get('q') || '').trim()

  const db = sb()

  // Base query
  let query = db
    .from('users')
    .select('id, display_name, phone, line_id, line_user_id, avatar_url, created_at, id_verified_at, id_verify_submitted_at, phone_verified_at, banned_at, banned_reason, deleted_at, deleted_reason')
    .order('created_at', { ascending: false })
    .limit(200)

  if (tab === 'banned') {
    query = query.not('banned_at', 'is', null)
  } else if (tab === 'deleted') {
    query = query.not('deleted_at', 'is', null)
  } else {
    // all / suspicious: ซ่อน deleted (แสดงเฉพาะ active หรือ banned)
    query = query.is('deleted_at', null)
  }

  if (q) {
    query = query.or(`display_name.ilike.%${q}%,phone.ilike.%${q}%,line_id.ilike.%${q}%`)
  }

  const { data: users, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows: UserRow[] = (users || []) as UserRow[]
  if (rows.length === 0) return NextResponse.json({ users: [], stats: { all: 0, suspicious: 0, banned: 0 } })

  const userIds = rows.map(r => r.id)

  // Fetch auxiliary data in parallel
  const [
    { data: listings },
    { data: reports },
    { data: allContacts },
  ] = await Promise.all([
    db.from('listings').select('seller_id, created_at').in('seller_id', userIds),
    db.from('reports').select('reported_user_id').in('reported_user_id', userIds),
    // ทั้งตาราง users (เอาแค่ phone, line_id) — หา duplicate ฝั่ง server
    db.from('users').select('phone, line_id').is('deleted_at', null),
  ])

  const dupPhoneSet = new Set<string>()
  const dupLineSet = new Set<string>()
  const pCount: Record<string, number> = {}
  const lCount: Record<string, number> = {}
  for (const u of allContacts || []) {
    if (u.phone) pCount[u.phone] = (pCount[u.phone] || 0) + 1
    if (u.line_id) lCount[u.line_id] = (lCount[u.line_id] || 0) + 1
  }
  for (const [k, v] of Object.entries(pCount)) if (v > 1) dupPhoneSet.add(k)
  for (const [k, v] of Object.entries(lCount)) if (v > 1) dupLineSet.add(k)

  // Aggregate per-user
  const listingsBySeller: Record<string, number[]> = {}
  for (const l of listings || []) {
    const sid = (l as any).seller_id
    if (!listingsBySeller[sid]) listingsBySeller[sid] = []
    listingsBySeller[sid].push(new Date((l as any).created_at).getTime())
  }

  const reportsByUser: Record<string, number> = {}
  for (const r of reports || []) {
    const uid = (r as any).reported_user_id
    reportsByUser[uid] = (reportsByUser[uid] || 0) + 1
  }

  // Compute flags
  const HOUR = 60 * 60 * 1000
  const BOT_THRESHOLD = 20

  for (const u of rows) {
    const flags: string[] = []

    // 🤖 Bot-like: ≥ 20 listings ใน 1 ชม.
    const times = (listingsBySeller[u.id] || []).sort((a, b) => a - b)
    let botLike = false
    for (let i = 0; i + BOT_THRESHOLD - 1 < times.length; i++) {
      if (times[i + BOT_THRESHOLD - 1] - times[i] <= HOUR) {
        botLike = true
        break
      }
    }
    if (botLike) flags.push('bot')

    // 👥 Duplicate contact
    if ((u.phone && dupPhoneSet.has(u.phone)) || (u.line_id && dupLineSet.has(u.line_id))) {
      flags.push('duplicate')
    }

    // ⚠️ Reported
    if (reportsByUser[u.id]) flags.push('reported')

    u.flags = flags
    u.listings_count = times.length
    u.reports_count = reportsByUser[u.id] || 0
  }

  const filtered = tab === 'suspicious'
    ? rows.filter(u => (u.flags || []).length > 0 && !u.banned_at)
    : rows

  // Stats for tab badges
  const stats = {
    all: rows.filter(u => !u.banned_at).length,
    suspicious: rows.filter(u => (u.flags || []).length > 0 && !u.banned_at).length,
    banned: rows.filter(u => u.banned_at).length,
  }

  return NextResponse.json({ users: filtered, stats })
}

export async function POST(req: NextRequest) {
  const adminId = await currentAdmin()
  if (!adminId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { userId, action, reason, phone: newPhone, name: newName } = await req.json()
  if (!userId || !['ban', 'unban', 'soft_delete', 'hard_delete', 'delete_avatar', 'reset_verify', 'reset_phone', 'reset_id_verify', 'edit_phone', 'edit_name'].includes(action)) {
    return NextResponse.json({ error: 'invalid params' }, { status: 400 })
  }
  // Block self-action ยกเว้น reset actions (อนุญาตให้ admin reset ตัวเองเพื่อ test)
  if (userId === adminId && !action.startsWith('reset') && action !== 'edit_phone' && action !== 'hard_delete' && action !== 'edit_name') {
    return NextResponse.json({ error: 'ห้าม action ตัวเอง' }, { status: 400 })
  }

  const db = sb()

  if (action === 'ban') {
    const { error } = await db.rpc('ban_user', { p_user_id: userId, p_reason: reason || null })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'unban') {
    const { error } = await db.rpc('unban_user', { p_user_id: userId })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'soft_delete') {
    const { error } = await db.rpc('soft_delete_user', { p_user_id: userId, p_reason: reason || null })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'hard_delete') {
    // ลบ user ถาวร — cascade ลบ sessions, listings, wanted, notifications ทั้งหมด
    // ใช้สำหรับ test เท่านั้น!
    await db.from('sessions').delete().eq('user_id', userId)
    await db.from('notifications').delete().eq('user_id', userId)
    const { error } = await db.from('users').delete().eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'delete_avatar') {
    const { error } = await db.from('users').update({ avatar_url: null }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'reset_verify') {
    // Reset ทั้งหมด (เดิม) — เก็บไว้เผื่อใช้
    const { error } = await db.from('users').update({
      phone: null, phone_verified_at: null,
      id_verified_at: null, id_verify_submitted_at: null,
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'reset_phone') {
    // Reset เบอร์โทรอย่างเดียว
    const { error } = await db.from('users').update({
      phone: null, phone_verified_at: null,
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'reset_id_verify') {
    // Reset ยืนยันตัวตน (บัตร + หน้าบัญชี) อย่างเดียว
    const { error } = await db.from('users').update({
      id_verified_at: null, id_verify_submitted_at: null,
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'edit_phone') {
    // Admin แก้เบอร์ให้ user + mark verified
    if (!newPhone || !/^0\d{9}$/.test(newPhone)) {
      return NextResponse.json({ error: 'เบอร์ไม่ถูกต้อง (0xxxxxxxxx)' }, { status: 400 })
    }
    const { error } = await db.from('users').update({
      phone: newPhone, phone_verified_at: new Date().toISOString(),
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (action === 'edit_name') {
    // Admin แก้ชื่อ user
    if (!newName?.trim()) {
      return NextResponse.json({ error: 'กรุณาใส่ชื่อ' }, { status: 400 })
    }
    const { error } = await db.from('users').update({
      display_name: newName.trim(),
    }).eq('id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Log audit (fire-and-forget — ไม่ block response)
  logAdminAction({
    adminId,
    action: `${action}_user`,
    targetType: 'user',
    targetId: userId,
    reason,
  })

  return NextResponse.json({ ok: true, action })
}

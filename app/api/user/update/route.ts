import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { parseLineId } from '@/lib/line-id'

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { userId, data } = await req.json()
  if (!userId || !data) return NextResponse.json({ error: 'missing fields' }, { status: 400 })

  // ต้องเป็นเจ้าของ session เท่านั้น — กัน user แก้ข้อมูลคนอื่น
  const { getSessionUser } = await import('@/lib/session')
  const sessionUser = await getSessionUser()
  if (!sessionUser || sessionUser.id !== userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // อนุญาตแค่ field ที่ user แก้ได้เองเท่านั้น
  const allowed: Record<string, unknown> = {}
  if (typeof data.display_name === 'string') allowed.display_name = data.display_name.trim()
  if (data.seller_type === 'individual' || data.seller_type === 'store') allowed.seller_type = data.seller_type
  if (data.store_name !== undefined) allowed.store_name = typeof data.store_name === 'string' ? data.store_name.trim() || null : null
  // phone: validate เบอร์ไทย 10 หลัก ขึ้นต้น 0
  if (typeof data.phone === 'string') {
    const cleaned = data.phone.replace(/\D/g, '')
    if (/^0\d{9}$/.test(cleaned)) {
      allowed.phone = cleaned
    } else if (data.phone.trim() === '') {
      allowed.phone = null
    } else {
      return NextResponse.json({ error: 'invalid_phone', message: 'เบอร์โทรต้อง 10 หลัก ขึ้นต้น 0' }, { status: 400 })
    }
  }
  // avatar_url: user upload รูปเอง → ต้องเป็น URL จาก Supabase storage ของเรา (กัน external inject)
  if (typeof data.avatar_url === 'string') {
    const url = data.avatar_url.trim()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    if (url.startsWith(supabaseUrl) || url === '') {
      allowed.avatar_url = url || null
    } else {
      return NextResponse.json({ error: 'invalid_avatar_url' }, { status: 400 })
    }
  }

  // line_id: ต้องผ่าน 2 layers
  // 1. Format ต้อง valid (parseLineId)
  // 2. ถ้าต่างจากค่าเดิม → ต้องมี reauth cookie (ผ่าน LINE OAuth re-verify)
  if (data.line_id !== undefined) {
    const supabase = getSupabase()
    const { data: current } = await supabase.from('users').select('line_id').eq('id', userId).maybeSingle()
    const currentLineId = current?.line_id || null

    let newLineId: string | null = null
    if (typeof data.line_id === 'string' && data.line_id.trim()) {
      const parsed = parseLineId(data.line_id)
      if (!parsed) {
        return NextResponse.json({ error: 'invalid_line_id', message: 'LINE ID ต้องเป็น 4-20 ตัวอักษร (a-z, 0-9, จุด ขีด ขีดเส้นใต้)' }, { status: 400 })
      }
      newLineId = parsed.raw
    }

    // ต้องมี reauth ก็ต่อเมื่อ **เปลี่ยน** ค่าที่มีอยู่แล้ว
    // ถ้าตั้งครั้งแรก (currentLineId === null) → ไม่ต้องยืนยัน
    const isChanging = currentLineId !== null && newLineId !== currentLineId
    if (isChanging) {
      const reauthCookie = cookies().get('bm_line_reauth')?.value
      if (!reauthCookie || reauthCookie !== '1') {
        return NextResponse.json({
          error: 'reauth_required',
          message: 'การเปลี่ยน LINE ID ต้องยืนยันด้วย LINE อีกครั้ง',
        }, { status: 403 })
      }
      // ใช้แล้วลบทันที (one-time)
      cookies().delete('bm_line_reauth')
    }
    allowed.line_id = newLineId
  }

  if (Object.keys(allowed).length === 0) return NextResponse.json({ error: 'no valid fields' }, { status: 400 })

  const { data: updated, error } = await getSupabase()
    .from('users').update(allowed).eq('id', userId).select()

  if (error) {
    console.error('[user/update] db error:', error.message, { userId, fields: Object.keys(allowed) })
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }
  if (!updated?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ ok: true, updated })
}

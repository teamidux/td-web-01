// Wanted toggle — เพิ่ม/ลบ หนังสือที่ตามหา
// ย้ายจาก client-side supabase insert/delete มาผ่าน API (กัน anon key abuse)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// POST = เพิ่ม wanted
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { book_id, isbn, max_price } = await req.json()
  if (!book_id || !isbn) return NextResponse.json({ error: 'missing fields' }, { status: 400 })

  const sb = db()

  // กันซ้ำ — ถ้า user ตามหา book นี้อยู่แล้ว ไม่สร้าง row ใหม่
  const { data: existing } = await sb
    .from('wanted')
    .select('id')
    .eq('user_id', user.id)
    .eq('book_id', book_id)
    .maybeSingle()

  if (existing) {
    // อัปเดต max_price ถ้ามี แต่ไม่ insert ใหม่
    if (max_price !== undefined) {
      await sb.from('wanted').update({ max_price: max_price || null }).eq('id', existing.id)
    }
    return NextResponse.json({ ok: true, existing: true })
  }

  const { error } = await sb.from('wanted').insert({
    user_id: user.id,
    book_id,
    isbn,
    max_price: max_price || null,
    status: 'waiting',
  })

  if (error) {
    console.error('[wanted] db error:', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE = ลบ wanted
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { book_id, wanted_id } = await req.json()

  if (wanted_id) {
    // ลบโดย wanted id (หน้า wanted list)
    await db().from('wanted').delete().eq('id', wanted_id).eq('user_id', user.id)
  } else if (book_id) {
    // ลบโดย book_id (หน้า book detail)
    await db().from('wanted').delete().eq('user_id', user.id).eq('book_id', book_id)
  } else {
    return NextResponse.json({ error: 'missing book_id or wanted_id' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

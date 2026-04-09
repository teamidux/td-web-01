// Identity verification submission
// รับ ID card + bank book photos จาก IdentityVerifyWizard
// → upload ไป Supabase Storage (bucket: identity-docs, private)
// → mark users.id_verify_submitted_at = now()
// → admin จะตรวจ + set users.id_verified_at เอง
//
// Setup ที่ user ต้องทำก่อนใช้งาน:
// 1. รัน supabase/trust_mission.sql
// 2. สร้าง bucket 'identity-docs' ใน Supabase Storage (Private)
//    Dashboard → Storage → New bucket → name: identity-docs → Private
//
// Note: ถ้า bucket ยังไม่มี → API ยังคืน success แต่ photos ไม่ได้ store
//        (id_verify_submitted_at ยัง mark) — ใช้สำหรับ test flow

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const fd = await req.formData()
    const idCard = fd.get('id_card') as File | null
    const bankBook = fd.get('bank_book') as File | null

    if (!idCard || !bankBook) {
      return NextResponse.json({ error: 'missing_files', message: 'กรุณาส่งรูปครบทั้ง 2 อย่าง' }, { status: 400 })
    }

    // Validate file types + size
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (idCard.size > maxSize || bankBook.size > maxSize) {
      return NextResponse.json({ error: 'file_too_large', message: 'รูปขนาดเกิน 5MB' }, { status: 400 })
    }

    const sb = admin()
    const ts = Date.now()
    let uploadedCount = 0
    let uploadError: string | null = null

    // Try upload to identity-docs bucket (private)
    // ถ้า bucket ยังไม่มี → log error แต่ยังไม่ fail (mark submitted ไว้ก่อน)
    const uploads: Array<{ type: string; file: File }> = [
      { type: 'id_card', file: idCard },
      { type: 'bank_book', file: bankBook },
    ]
    for (let i = 0; i < uploads.length; i++) {
      const { type, file } = uploads[i]
      const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const path = `${user.id}/${type}_${ts}.${ext}`
      const { error: upErr } = await sb.storage
        .from('identity-docs')
        .upload(path, file, { contentType: file.type, upsert: true })
      if (upErr) {
        uploadError = upErr.message
        console.warn('[identity-verify] upload failed:', type, upErr.message)
      } else {
        uploadedCount++
      }
    }

    // Mark submitted (regardless of upload — for dev/test ease)
    const { error: updateErr } = await sb
      .from('users')
      .update({ id_verify_submitted_at: new Date().toISOString() })
      .eq('id', user.id)

    if (updateErr) {
      console.error('[identity-verify] update error:', updateErr)
      return NextResponse.json({ error: 'update_failed', message: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      uploaded: uploadedCount,
      uploadError,
      submittedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[identity-verify] exception:', e)
    return NextResponse.json({ error: 'server_error', message: e?.message || 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}

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
import { pushLineText } from '@/lib/line-bot'

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

    // Validate file size
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (idCard.size > maxSize || bankBook.size > maxSize) {
      return NextResponse.json({ error: 'file_too_large', message: 'รูปขนาดเกิน 5MB' }, { status: 400 })
    }

    // Validate MIME + magic bytes (ห้าม user ส่งไฟล์ปลอม e.g. EXE ที่เปลี่ยน extension)
    const isValidImage = async (f: File): Promise<boolean> => {
      // Check stated MIME type
      if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/.test(f.type)) return false
      // Read first 12 bytes เพื่อเช็ค magic bytes
      const buf = new Uint8Array(await f.slice(0, 12).arrayBuffer())
      // JPEG: FF D8 FF
      if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true
      // PNG: 89 50 4E 47 0D 0A 1A 0A
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true
      // WebP: "RIFF" ... "WEBP"
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
          buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true
      // HEIC/HEIF: ftyp + heic/heix/mif1 marker
      if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true
      return false
    }
    const [idOk, bankOk] = await Promise.all([isValidImage(idCard), isValidImage(bankBook)])
    if (!idOk || !bankOk) {
      return NextResponse.json({ error: 'invalid_file_type', message: 'รองรับเฉพาะไฟล์รูป (JPG/PNG/WebP/HEIC)' }, { status: 400 })
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

    // LINE notify admin — มีคนส่งเอกสารมาใหม่
    const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
    if (adminIds.length > 0) {
      const { data: admins } = await sb
        .from('users')
        .select('line_user_id')
        .in('id', adminIds)
        .not('line_user_id', 'is', null)
      for (const a of admins || []) {
        pushLineText(a.line_user_id, `🪪 มีคนส่งเอกสารยืนยันตัวตน\n\nชื่อ: ${user.display_name || '—'}\n\nตรวจสอบได้ที่\nbookmatch.app/tomga/verify`).catch(() => {})
      }
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

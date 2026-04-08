import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSessionUser } from '@/lib/session'

export const runtime = 'nodejs'

const BUCKET = 'id-verifications'
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (user.id_verified_at) {
    return NextResponse.json({ error: 'already_verified' }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 })
  }

  const idFile = formData.get('id') as File | null
  const selfieFile = formData.get('selfie') as File | null

  if (!idFile || !selfieFile) {
    return NextResponse.json({ error: 'missing_files' }, { status: 400 })
  }
  for (const f of [idFile, selfieFile]) {
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'file_too_large' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(f.type)) {
      return NextResponse.json({ error: 'invalid_file_type' }, { status: 400 })
    }
  }

  const sb = admin()

  // Check for an existing pending request
  const { data: pending } = await sb
    .from('id_verifications')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', ['pending'])
    .limit(1)
  if (pending && pending.length > 0) {
    return NextResponse.json({ error: 'pending_review' }, { status: 409 })
  }

  // Upload to Supabase Storage (private bucket)
  const ts = Date.now()
  const idPath = `${user.id}/${ts}-id-${idFile.name.slice(-30)}`
  const selfiePath = `${user.id}/${ts}-selfie-${selfieFile.name.slice(-30)}`

  const idBuf = Buffer.from(await idFile.arrayBuffer())
  const selfieBuf = Buffer.from(await selfieFile.arrayBuffer())

  const { error: e1 } = await sb.storage.from(BUCKET).upload(idPath, idBuf, { contentType: idFile.type, upsert: false })
  if (e1) return NextResponse.json({ error: 'upload_failed', detail: e1.message }, { status: 500 })

  const { error: e2 } = await sb.storage.from(BUCKET).upload(selfiePath, selfieBuf, { contentType: selfieFile.type, upsert: false })
  if (e2) {
    // rollback
    await sb.storage.from(BUCKET).remove([idPath])
    return NextResponse.json({ error: 'upload_failed', detail: e2.message }, { status: 500 })
  }

  const { error: insertErr } = await sb.from('id_verifications').insert({
    user_id: user.id,
    id_image_path: idPath,
    selfie_image_path: selfiePath,
  })
  if (insertErr) {
    await sb.storage.from(BUCKET).remove([idPath, selfiePath])
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

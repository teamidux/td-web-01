import { NextRequest, NextResponse } from 'next/server'
import { logMissingIsbnServer } from '@/lib/missing-isbn'

export async function POST(req: NextRequest) {
  try {
    const { isbn, source, userId } = await req.json()
    if (!isbn || typeof isbn !== 'string') {
      return NextResponse.json({ error: 'missing isbn' }, { status: 400 })
    }
    await logMissingIsbnServer(isbn, source || 'unknown', userId || null)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 })
  }
}

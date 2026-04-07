import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const bookId = req.nextUrl.searchParams.get('book_id')
  if (!bookId) return NextResponse.json({ listings: [] })

  // ใช้ service role key เพื่อ bypass RLS — ถ้าไม่มีให้ fallback anon key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: ls, error } = await supabase
    .from('listings')
    .select('*, users(id, display_name, sold_count, confirmed_count, is_verified, line_id, phone, seller_type, store_name)')
    .eq('book_id', bookId)
    .eq('status', 'active')
    .order('price')

  if (!error) return NextResponse.json({ listings: ls || [] })

  // FK join ล้มเหลว — fallback ไม่มี users join
  console.error('[listings API] join error:', error.message)
  const { data: fallback } = await supabase
    .from('listings')
    .select('*')
    .eq('book_id', bookId)
    .eq('status', 'active')
    .order('price')

  return NextResponse.json({ listings: fallback || [] })
}

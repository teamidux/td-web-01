// Admin API: Search logs analytics
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const sb = admin()
  const days = parseInt(req.nextUrl.searchParams.get('days') || '7', 10)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  // 1. Top keywords
  const { data: topKeywords } = await sb
    .from('search_logs')
    .select('keyword')
    .gte('created_at', since)

  const kwCount: Record<string, number> = {}
  for (const r of topKeywords || []) {
    const k = r.keyword?.toLowerCase().trim()
    if (k) kwCount[k] = (kwCount[k] || 0) + 1
  }
  const topList = Object.entries(kwCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([keyword, count]) => ({ keyword, count }))

  // 2. Zero-result keywords (demand ที่ไม่มี supply)
  const { data: zeroResults } = await sb
    .from('search_logs')
    .select('keyword')
    .eq('result_count', 0)
    .gte('created_at', since)

  const zeroCount: Record<string, number> = {}
  for (const r of zeroResults || []) {
    const k = r.keyword?.toLowerCase().trim()
    if (k) zeroCount[k] = (zeroCount[k] || 0) + 1
  }
  const zeroList = Object.entries(zeroCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([keyword, count]) => ({ keyword, count }))

  // 3. Summary stats
  const totalSearches = (topKeywords || []).length
  const zeroSearches = (zeroResults || []).length
  const uniqueKeywords = Object.keys(kwCount).length

  // 4. Daily trend (searches per day)
  const dailyMap: Record<string, { total: number; zero: number }> = {}
  for (const r of topKeywords || []) {
    const day = (r as any).created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10)
    if (!dailyMap[day]) dailyMap[day] = { total: 0, zero: 0 }
    dailyMap[day].total++
  }
  // need created_at for daily trend — re-query with it
  const { data: allLogs } = await sb
    .from('search_logs')
    .select('created_at, result_count')
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  const dailyMap2: Record<string, { total: number; zero: number }> = {}
  for (const r of allLogs || []) {
    const day = r.created_at?.slice(0, 10)
    if (!day) continue
    if (!dailyMap2[day]) dailyMap2[day] = { total: 0, zero: 0 }
    dailyMap2[day].total++
    if (r.result_count === 0) dailyMap2[day].zero++
  }
  const daily = Object.entries(dailyMap2)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }))

  return NextResponse.json({
    days,
    summary: { totalSearches, zeroSearches, uniqueKeywords, zeroRate: totalSearches > 0 ? Math.round(zeroSearches / totalSearches * 100) : 0 },
    topKeywords: topList,
    zeroResultKeywords: zeroList,
    daily,
  })
}

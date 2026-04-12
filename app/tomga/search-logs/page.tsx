'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

type SearchData = {
  days: number
  summary: { totalSearches: number; zeroSearches: number; uniqueKeywords: number; zeroRate: number }
  topKeywords: Array<{ keyword: string; count: number }>
  zeroResultKeywords: Array<{ keyword: string; count: number }>
  daily: Array<{ date: string; total: number; zero: number }>
}

export default function SearchLogsPage() {
  const [data, setData] = useState<SearchData | null>(null)
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)

  const load = (d: number) => {
    setLoading(true)
    fetch(`/api/tomga/search-logs?days=${d}`)
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(days) }, [days])

  const maxBar = (items: Array<{ count: number }>) => Math.max(...items.map(i => i.count), 1)

  return (
    <div style={{ padding: '24px 16px 80px', maxWidth: 800, margin: '0 auto' }}>
      <Link href="/tomga" style={{ fontSize: 14, color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}>← Dashboard</Link>

      <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', marginTop: 12, marginBottom: 6 }}>
        Search Logs
      </h1>
      <p style={{ fontSize: 14, color: '#94A3B8', marginBottom: 20 }}>วิเคราะห์ว่าผู้ใช้ค้นหาอะไร + demand ที่ยังไม่มี supply</p>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[7, 14, 30].map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: days === d ? '2px solid #2563EB' : '1px solid #E2E8F0',
              background: days === d ? '#EFF6FF' : 'white',
              color: days === d ? '#2563EB' : '#64748B',
              fontFamily: 'Kanit',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {d} วัน
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>Loading...</div>}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 28 }}>
            {[
              { label: 'ค้นหาทั้งหมด', value: data.summary.totalSearches, color: '#0F172A' },
              { label: 'Keyword ไม่ซ้ำ', value: data.summary.uniqueKeywords, color: '#2563EB' },
              { label: 'ไม่เจอผลลัพธ์', value: data.summary.zeroSearches, color: '#DC2626' },
              { label: 'อัตราไม่เจอ', value: `${data.summary.zeroRate}%`, color: data.summary.zeroRate > 30 ? '#DC2626' : '#D97706' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
              </div>
            ))}
          </div>

          {/* Daily trend — simple bar chart */}
          {data.daily.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: '20px 18px', marginBottom: 28 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 14 }}>ค้นหารายวัน</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100 }}>
                {(() => {
                  const maxVal = Math.max(...data.daily.map(d => d.total), 1)
                  return data.daily.map((d, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>{d.total}</div>
                      <div style={{ width: '100%', maxWidth: 36, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <div style={{ height: Math.max(2, (d.total / maxVal) * 70), background: '#2563EB', borderRadius: '4px 4px 0 0', transition: 'height .3s' }} />
                        {d.zero > 0 && <div style={{ height: Math.max(1, (d.zero / maxVal) * 70), background: '#FCA5A5', borderRadius: '0 0 4px 4px' }} />}
                      </div>
                      <div style={{ fontSize: 10, color: '#94A3B8' }}>{d.date.slice(5)}</div>
                    </div>
                  ))
                })()}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: '#94A3B8' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#2563EB', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />ค้นหา</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#FCA5A5', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />ไม่เจอ</span>
              </div>
            </div>
          )}

          {/* Two columns: top keywords + zero result keywords */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>

            {/* Top Keywords */}
            <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: '20px 18px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>Keyword ยอดนิยม</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 14 }}>คนค้นหาอะไรมากที่สุด</div>
              {data.topKeywords.length === 0 && <div style={{ fontSize: 14, color: '#CBD5E1', padding: '16px 0' }}>ยังไม่มีข้อมูล</div>}
              {data.topKeywords.map((k, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < data.topKeywords.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
                  <span style={{ fontSize: 13, color: '#94A3B8', width: 22, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: '#0F172A', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.keyword}</div>
                    <div style={{ height: 4, background: '#F1F5F9', borderRadius: 2, marginTop: 4 }}>
                      <div style={{ height: '100%', background: '#2563EB', borderRadius: 2, width: `${(k.count / maxBar(data.topKeywords)) * 100}%` }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2563EB', flexShrink: 0 }}>{k.count}</span>
                </div>
              ))}
            </div>

            {/* Zero Result Keywords */}
            <div style={{ background: 'white', border: '1px solid #FECACA', borderRadius: 14, padding: '20px 18px' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>Demand ที่ไม่มี Supply</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 14 }}>ค้นหาแล้วไม่เจอ — โอกาสเพิ่ม catalog</div>
              {data.zeroResultKeywords.length === 0 && <div style={{ fontSize: 14, color: '#CBD5E1', padding: '16px 0' }}>ไม่มี — ดีมาก!</div>}
              {data.zeroResultKeywords.map((k, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < data.zeroResultKeywords.length - 1 ? '1px solid #FFF5F5' : 'none' }}>
                  <span style={{ fontSize: 13, color: '#94A3B8', width: 22, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: '#0F172A', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.keyword}</div>
                    <div style={{ height: 4, background: '#FEF2F2', borderRadius: 2, marginTop: 4 }}>
                      <div style={{ height: '100%', background: '#DC2626', borderRadius: 2, width: `${(k.count / maxBar(data.zeroResultKeywords)) * 100}%` }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', flexShrink: 0 }}>{k.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

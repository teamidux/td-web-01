'use client'
import { useEffect, useState } from 'react'

type Q = { query: string; clicks: number; impressions: number; ctr: number; position: number }
type P = { page: string; clicks: number; impressions: number; ctr: number; position: number; queries: { query: string; clicks: number; impressions: number }[] }
type Seller = { seller_id: string; name: string; channel: string; user_since: string | null; first_listing_at: string; listings: number; active: number; titles: string[]; store?: string | null; is_new: boolean }
type GscOk = { ok: true; site: string; range: { startDate: string; endDate: string }; summary: { clicks: number; impressions: number; ctr: number; position: number }; daily: { date: string; clicks: number; impressions: number }[]; queries: Q[]; pages: P[] }
type GscErr = { ok: false; error: string; hint: string; service_email: string | null; enable_url?: string | null; range: { startDate: string; endDate: string } }
type Internal = {
  total_contacts: number
  top_viewed: { isbn: string; title: string; author: string | null; views: number; active_listings_count: number; min_price: number | null; wanted_count: number }[]
  top_contacted: { isbn: string; title: string; author: string | null; contacts: number; active_listings_count: number; min_price: number | null }[]
}
type Data = {
  days: number
  gsc: GscOk | GscErr
  internal: Internal
  sellers: Seller[]
  sellers_new: number
}

const card: React.CSSProperties = { background: 'white', border: '1px solid #E2E8F0', borderRadius: 14, padding: '20px 18px', marginBottom: 20 }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, color: '#94A3B8', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #F1F5F9', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { fontSize: 13, color: '#0F172A', padding: '7px 8px', borderBottom: '1px solid #F8FAFC', verticalAlign: 'top' }
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const fmtDate = (s: string) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })

export default function SeoPage() {
  const [days, setDays] = useState(28)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [openPage, setOpenPage] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/tomga/seo?days=${days}`).then(r => r.json()).then(setData).finally(() => setLoading(false))
  }, [days])

  // แยก union ให้ TS narrow ง่าย
  const gErr: GscErr | null = data && data.gsc.ok === false ? (data.gsc as GscErr) : null
  const gOk: GscOk | null = data && data.gsc.ok === true ? (data.gsc as GscOk) : null

  return (
    <div style={{ padding: '24px 16px 80px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontFamily: "'Kanit', sans-serif", fontSize: 28, fontWeight: 800, color: '#0F172A', marginTop: 12, marginBottom: 6 }}>SEO & ผู้ขายใหม่</h1>
      <p style={{ fontSize: 14, color: '#94A3B8', marginBottom: 20 }}>คนค้น Google ด้วยคำอะไรแล้วมาเจอเรา (Search Console) และใครเข้ามาลงขายในช่วงนี้</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[7, 28, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} style={{ padding: '8px 16px', borderRadius: 8, border: days === d ? '2px solid #2563EB' : '1px solid #E2E8F0', background: days === d ? '#EFF6FF' : 'white', color: days === d ? '#2563EB' : '#64748B', fontFamily: 'Kanit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{d} วัน</button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>Loading...</div>}

      {data && !loading && (
        <>
          {/* ── Search Console ── */}
          {gErr ? (
            <div style={{ ...card, border: '1px solid #FDE68A', background: '#FFFBEB' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>ยังอ่าน Search Console ไม่ได้</div>
              <div style={{ fontSize: 14, color: '#78350F', marginBottom: 10 }}>{gErr.hint}</div>
              {gErr.enable_url && (
                <a href={gErr.enable_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', fontSize: 14, fontWeight: 700, color: 'white', background: '#D97706', borderRadius: 8, padding: '8px 14px', textDecoration: 'none', marginBottom: 10 }}>เปิด Search Console API ใน Google Cloud →</a>
              )}
              {gErr.service_email && (
                <div style={{ fontSize: 13, background: 'white', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 8 }}>{gErr.service_email}</div>
              )}
              <div style={{ fontSize: 12, color: '#B45309', fontFamily: 'monospace', wordBreak: 'break-all' }}>{gErr.error}</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8 }}>ข้อมูล Google {gOk!.range.startDate} ถึง {gOk!.range.endDate} (property: {gOk!.site})</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
                {[
                  { label: 'คลิกจาก Google', value: gOk!.summary.clicks, color: '#2563EB' },
                  { label: 'แสดงผล (impressions)', value: gOk!.summary.impressions, color: '#0F172A' },
                  { label: 'CTR', value: `${gOk!.summary.ctr}%`, color: '#059669' },
                  { label: 'อันดับเฉลี่ย', value: gOk!.summary.position, color: '#D97706' },
                ].map((s, i) => (
                  <div key={i} style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: s.color, lineHeight: 1 }}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
                  </div>
                ))}
              </div>

              {gOk!.daily.length > 0 && (
                <div style={card}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 14 }}>คลิกรายวัน</div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                    {(() => {
                      const max = Math.max(...gOk!.daily.map(d => d.clicks), 1)
                      return gOk!.daily.map((d, i) => (
                        <div key={i} title={`${d.date}: ${d.clicks} คลิก / ${d.impressions} แสดง`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                          <div style={{ height: Math.max(2, (d.clicks / max) * 80), background: '#2563EB', borderRadius: '3px 3px 0 0' }} />
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              )}

              <div style={card}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>คำค้นที่พาคนมา</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>เรียงตามคลิก แล้วตาม impressions</div>
                {gOk!.queries.length === 0 && <div style={{ fontSize: 14, color: '#CBD5E1' }}>ยังไม่มีข้อมูลในช่วงนี้</div>}
                {gOk!.queries.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr><th style={th}>#</th><th style={th}>คำค้น</th><th style={{ ...th, textAlign: 'right' }}>คลิก</th><th style={{ ...th, textAlign: 'right' }}>แสดง</th><th style={{ ...th, textAlign: 'right' }}>CTR</th><th style={{ ...th, textAlign: 'right' }}>อันดับ</th></tr></thead>
                      <tbody>
                        {gOk!.queries.slice(0, 50).map((q, i) => (
                          <tr key={q.query}><td style={{ ...td, color: '#94A3B8' }}>{i + 1}</td><td style={td}>{q.query}</td><td style={num}>{q.clicks}</td><td style={num}>{q.impressions}</td><td style={num}>{q.ctr}%</td><td style={num}>{q.position}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={card}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>หน้าที่คนเข้าจาก Google</div>
                <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>กดที่หน้าเพื่อดูว่ามาจากคำค้นอะไร</div>
                {gOk!.pages.slice(0, 40).map(p => (
                  <div key={p.page} style={{ borderBottom: '1px solid #F8FAFC' }}>
                    <div onClick={() => setOpenPage(openPage === p.page ? null : p.page)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 4px', cursor: 'pointer' }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1E40AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.page || '/'}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', width: 60, textAlign: 'right' }}>{p.clicks} คลิก</div>
                      <div style={{ fontSize: 12, color: '#94A3B8', width: 70, textAlign: 'right' }}>{p.impressions} แสดง</div>
                      <div style={{ fontSize: 12, color: '#D97706', width: 50, textAlign: 'right' }}>#{p.position}</div>
                    </div>
                    {openPage === p.page && (
                      <div style={{ padding: '0 4px 10px 16px' }}>
                        {p.queries.length === 0 && <div style={{ fontSize: 12, color: '#CBD5E1' }}>Google ไม่เปิดเผยคำค้นของหน้านี้</div>}
                        {p.queries.map(q => (
                          <div key={q.query} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0' }}>
                            <span style={{ flex: 1, color: '#334155' }}>{q.query}</span>
                            <span style={{ color: '#2563EB', fontWeight: 600 }}>{q.clicks}</span>
                            <span style={{ color: '#94A3B8', width: 60, textAlign: 'right' }}>{q.impressions} แสดง</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── ตัวนับในระบบ: เล่มที่ถูกเปิดดู / ถูกกดติดต่อ ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div style={{ ...card, marginBottom: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>เล่มที่ถูกเปิดดูมากสุด</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>ตัวนับ view ของเว็บเรา (สะสมทั้งหมด ไม่แยกช่วงเวลา)</div>
              {data.internal.top_viewed.length === 0 && <div style={{ fontSize: 14, color: '#CBD5E1' }}>ยังไม่มีข้อมูล</div>}
              {data.internal.top_viewed.map((b, i) => (
                <div key={b.isbn} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <span style={{ fontSize: 12, color: '#94A3B8', width: 20, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a href={`/book/${b.isbn}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0F172A', fontWeight: 600, textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</a>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{b.author || ''}{b.active_listings_count ? ` · ขายอยู่ ${b.active_listings_count}${b.min_price ? ` (฿${b.min_price})` : ''}` : ' · ไม่มีคนขาย'}{b.wanted_count ? ` · ตามหา ${b.wanted_count}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', flexShrink: 0 }}>{b.views.toLocaleString()} ครั้ง</span>
                </div>
              ))}
            </div>
            <div style={{ ...card, marginBottom: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>เล่มที่มีคนกดติดต่อผู้ขาย</div>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>ช่วง {data.days} วัน · กดติดต่อรวม {data.internal.total_contacts} ครั้ง</div>
              {data.internal.top_contacted.length === 0 && <div style={{ fontSize: 14, color: '#CBD5E1' }}>ยังไม่มีในช่วงนี้</div>}
              {data.internal.top_contacted.map((b, i) => (
                <div key={b.isbn} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #F8FAFC' }}>
                  <span style={{ fontSize: 12, color: '#94A3B8', width: 20, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a href={`/book/${b.isbn}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0F172A', fontWeight: 600, textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</a>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{b.author || ''}{b.active_listings_count ? ` · ขายอยู่ ${b.active_listings_count}${b.min_price ? ` (฿${b.min_price})` : ''}` : ''}</div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#059669', flexShrink: 0 }}>{b.contacts} ครั้ง</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── ผู้ขายในช่วงนี้ ── */}
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>ผู้ขายที่ลงประกาศในช่วง {data.days} วัน</div>
            <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 12 }}>ทั้งหมด {data.sellers.length} คน · ใหม่ (ไม่เคยลงมาก่อน) {data.sellers_new} คน</div>
            {data.sellers.length === 0 && <div style={{ fontSize: 14, color: '#CBD5E1' }}>ไม่มีประกาศใหม่ในช่วงนี้</div>}
            {data.sellers.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>ผู้ขาย</th><th style={th}>ช่องทาง</th><th style={th}>ลงครั้งแรก</th><th style={{ ...th, textAlign: 'right' }}>ลง/active</th><th style={th}>ตัวอย่างเล่ม</th></tr></thead>
                  <tbody>
                    {data.sellers.map(s => (
                      <tr key={s.seller_id}>
                        <td style={td}>
                          <a href={`/seller/${s.seller_id}`} target="_blank" rel="noreferrer" style={{ color: '#1E40AF', textDecoration: 'none', fontWeight: 600 }}>{s.name}</a>
                          {s.is_new && <span style={{ marginLeft: 6, fontSize: 11, background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '1px 7px', fontWeight: 700 }}>ใหม่</span>}
                          {s.store && <span style={{ marginLeft: 6, fontSize: 11, background: '#EDE9FE', color: '#5B21B6', borderRadius: 999, padding: '1px 7px', fontWeight: 700 }}>{s.store}</span>}
                          {s.user_since && <div style={{ fontSize: 11, color: '#94A3B8' }}>สมัคร {fmtDate(s.user_since)}</div>}
                        </td>
                        <td style={td}>{s.channel}</td>
                        <td style={td}>{fmtDate(s.first_listing_at)}</td>
                        <td style={num}>{s.listings}/{s.active}</td>
                        <td style={{ ...td, color: '#475569', fontSize: 12 }}>{s.titles.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'

const REASON_LABELS: Record<string, string> = {
  scam: 'หลอกลวง/โกง',
  fake_book: 'หนังสือปลอม/ไม่ตรงปก',
  no_ship: 'รับเงินแต่ไม่ส่งของ',
  inappropriate: 'เนื้อหาไม่เหมาะสม',
  other: 'อื่นๆ',
}

const FEEDBACK_KIND_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  complaint: { label: '⚠️ ร้องเรียน', color: '#DC2626', bg: '#FEF2F2' },
  bug: { label: '🐛 บั๊ก', color: '#B45309', bg: '#FEF3C7' },
  suggestion: { label: '💡 ข้อเสนอแนะ', color: '#0369A1', bg: '#E0F2FE' },
  general: { label: '💬 อื่นๆ', color: '#475569', bg: '#F1F5F9' },
}

export default function AdminMessagesPage() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<'messages' | 'reports' | 'feedback'>('feedback')
  const [messages, setMessages] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function deleteFeedback(id: string) {
    if (!confirm('ลบข้อความนี้? (ทำแล้ว undo ไม่ได้)')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/tomga/feedback/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        alert('ลบไม่สำเร็จ')
        return
      }
      setFeedback(prev => prev.filter(f => f.id !== id))
    } catch {
      alert('ลบไม่สำเร็จ')
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    if (!user) return
    fetch('/api/tomga/messages')
      .then(r => r.json())
      .then(d => {
        setMessages(d.messages || [])
        setReports(d.reports || [])
        setFeedback(d.feedback || [])
      })
      .finally(() => setLoading(false))
  }, [user])

  const timeSince = (dt: string) => {
    const mins = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
    if (mins < 60) return `${mins} นาทีที่แล้ว`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ชั่วโมงที่แล้ว`
    return `${Math.floor(hrs / 24)} วันที่แล้ว`
  }

  if (authLoading) return <><div style={{ padding: 40, textAlign: 'center' }}>Loading...</div></>
  if (!user) return <><div style={{ padding: 40, textAlign: 'center' }}>กรุณาเข้าสู่ระบบ</div></>

  return (
    <>
      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          ข้อความ & รายงาน
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {[
            { key: 'feedback' as const, label: `📝 ข้อเสนอแนะ (${feedback.length})` },
            { key: 'messages' as const, label: `💬 ข้อความ (${messages.length})` },
            { key: 'reports' as const, label: `🚨 รายงาน (${reports.length})` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '10px 12px', border: 'none',
                background: tab === t.key ? 'var(--primary)' : 'white',
                color: tab === t.key ? 'white' : 'var(--ink2)',
                fontFamily: 'Kanit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>Loading...</div>}

        {/* Messages */}
        {!loading && tab === 'messages' && (
          messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8' }}>ยังไม่มีข้อความ</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((m: any) => (
                <div key={m.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#121212' }}>
                      {m.display_name || 'Guest'}
                      {m.email && <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: 6 }}>{m.email}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{timeSince(m.created_at)}</div>
                  </div>
                  {m.subject && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>{m.subject}</div>}
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{m.message}</div>
                </div>
              ))}
            </div>
          )
        )}

        {/* Feedback (แจ้งปัญหา/ข้อเสนอแนะ จาก footer form) */}
        {!loading && tab === 'feedback' && (
          feedback.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8' }}>ยังไม่มีข้อเสนอแนะ</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {feedback.map((f: any) => {
                const kindMeta = FEEDBACK_KIND_LABELS[f.kind] || FEEDBACK_KIND_LABELS.general
                const isDeleting = deletingId === f.id
                return (
                  <div key={f.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', opacity: isDeleting ? 0.5 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ background: kindMeta.bg, color: kindMeta.color, borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {kindMeta.label}
                      </span>
                      <div style={{ fontSize: 11, color: '#94A3B8' }} title={new Date(f.created_at).toLocaleString('th-TH')}>
                        {timeSince(f.created_at)}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{f.message}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 }}>
                      <div style={{ fontSize: 11, color: '#94A3B8', display: 'flex', gap: 12, flexWrap: 'wrap', flex: 1 }}>
                        {f.user?.display_name && <span>👤 {f.user.display_name}</span>}
                        {f.contact && <span>📧 {f.contact}</span>}
                        {!f.user_id && !f.contact && <span style={{ fontStyle: 'italic' }}>ไม่ระบุผู้ส่ง</span>}
                        {f.ip && <span style={{ fontFamily: 'monospace', color: '#64748B' }}>🌐 {f.ip}</span>}
                        {f.created_at && (
                          <span style={{ fontFamily: 'monospace' }}>
                            🕐 {new Date(f.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => deleteFeedback(f.id)}
                        disabled={isDeleting}
                        style={{
                          background: 'none', border: '1px solid #FECACA', color: '#DC2626',
                          borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                          fontFamily: 'Kanit', cursor: isDeleting ? 'wait' : 'pointer', flexShrink: 0,
                        }}
                      >
                        {isDeleting ? '...' : '🗑️ ลบ'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* Reports */}
        {!loading && tab === 'reports' && (
          reports.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8' }}>ยังไม่มีรายงาน</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {reports.map((r: any) => (
                <div key={r.id} style={{ background: 'white', border: '1px solid #FECACA', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: '#121212' }}>{r.reporter?.display_name || '?'}</span>
                      <span style={{ color: '#94A3B8' }}> รายงาน </span>
                      <span style={{ fontWeight: 700, color: '#DC2626' }}>{r.reported?.display_name || '?'}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94A3B8' }}>{timeSince(r.created_at)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <span style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                      {REASON_LABELS[r.reason] || r.reason}
                    </span>
                  </div>
                  {r.details && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7 }}>{r.details}</div>}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </>
  )
}

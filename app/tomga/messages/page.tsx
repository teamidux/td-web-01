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

type ReplyKind = 'message' | 'feedback'

const btnBase: React.CSSProperties = {
  background: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
  fontFamily: 'Kanit', cursor: 'pointer', whiteSpace: 'nowrap',
}

export default function AdminMessagesPage() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<'messages' | 'reports' | 'feedback'>('messages')
  const [messages, setMessages] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [feedback, setFeedback] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showReadMessages, setShowReadMessages] = useState(false)
  const [showResolvedFeedback, setShowResolvedFeedback] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  // reply box เปิดได้ทีละอัน — key = `${kind}:${id}`
  const [replyOpen, setReplyOpen] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyingId, setReplyingId] = useState<string | null>(null)

  const replyKey = (kind: ReplyKind, id: string) => `${kind}:${id}`

  function openReply(kind: ReplyKind, id: string, prefill = '') {
    const key = replyKey(kind, id)
    if (replyOpen === key) { setReplyOpen(null); setReplyText(''); return }
    setReplyOpen(key)
    setReplyText(prefill)
  }

  async function sendReply(kind: ReplyKind, id: string) {
    const text = replyText.trim()
    if (!text) { alert('กรุณาพิมพ์ข้อความตอบกลับ'); return }
    setReplyingId(id)
    try {
      const res = await fetch('/api/tomga/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, reply: text }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert(d.message || 'ตอบกลับไม่สำเร็จ'); return }
      const notifMsg = d.notified === 'line' ? 'ส่งแจ้งเตือนทาง LINE แล้ว'
        : d.notified === 'inapp' ? 'แจ้งเตือนในแอปให้ผู้ส่งแล้ว'
        : d.contact ? `ผู้ส่งไม่ได้ล็อกอิน — ติดต่อกลับเองที่: ${d.contact}`
        : 'ผู้ส่งไม่ได้ล็อกอินและไม่ได้ให้ช่องทางติดต่อ — ตอบกลับอัตโนมัติไม่ได้'
      alert('บันทึกคำตอบแล้ว — ' + notifMsg)
      const now = d.replied_at || new Date().toISOString()
      if (kind === 'feedback') {
        setFeedback(prev => prev.map(f => f.id === id ? { ...f, status: 'resolved', admin_note: text, reviewed_at: now } : f))
      } else {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, read_at: m.read_at || now, reply: { body: text, created_at: now } } : m))
      }
      setReplyOpen(null)
      setReplyText('')
    } catch {
      alert('ตอบกลับไม่สำเร็จ')
    } finally {
      setReplyingId(null)
    }
  }

  async function markMessageRead(id: string, read = true) {
    setMarkingId(id)
    try {
      const res = await fetch(`/api/tomga/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert('บันทึกไม่สำเร็จ'); return }
      setMessages(prev => prev.map(m => m.id === id ? { ...m, read_at: d.read_at ?? null } : m))
    } catch {
      alert('บันทึกไม่สำเร็จ')
    } finally {
      setMarkingId(null)
    }
  }

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
  const fmtDateTime = (dt: string) => new Date(dt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })

  const unreadMessages = messages.filter(m => !m.read_at)
  const visibleMessages = showReadMessages ? messages : unreadMessages
  const openFeedback = feedback.filter(f => f.status !== 'resolved' && f.status !== 'dismissed')
  const visibleFeedback = showResolvedFeedback ? feedback : openFeedback

  if (authLoading) return <><div style={{ padding: 40, textAlign: 'center' }}>Loading...</div></>
  if (!user) return <><div style={{ padding: 40, textAlign: 'center' }}>กรุณาเข้าสู่ระบบ</div></>

  // กล่องพิมพ์คำตอบ — ใช้ร่วมกันทั้ง messages และ feedback
  const renderReplyBox = (kind: ReplyKind, id: string, hasUser: boolean, contact: string | null) => (
    <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
      {!hasUser && (
        <div style={{ fontSize: 11, color: '#B45309', background: '#FEF3C7', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
          ⚠️ ผู้ส่งไม่ได้ล็อกอิน — ระบบแจ้งเตือนกลับอัตโนมัติไม่ได้ {contact ? `กรุณาติดต่อที่ ${contact}` : '(ไม่ได้ให้ช่องทางติดต่อ)'}
        </div>
      )}
      <textarea
        value={replyText}
        onChange={e => setReplyText(e.target.value)}
        placeholder="พิมพ์ข้อความตอบกลับ… จะส่งแจ้งเตือนให้ผู้ส่งทาง LINE / ในแอป"
        rows={3}
        maxLength={2000}
        autoFocus
        style={{
          width: '100%', boxSizing: 'border-box', borderRadius: 8, border: '1px solid var(--border)',
          padding: '8px 12px', fontSize: 13, fontFamily: 'Kanit', resize: 'vertical', lineHeight: 1.6,
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={() => { setReplyOpen(null); setReplyText('') }}
          disabled={replyingId === id}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--ink2)', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontFamily: 'Kanit', cursor: 'pointer' }}
        >
          ยกเลิก
        </button>
        <button
          onClick={() => sendReply(kind, id)}
          disabled={replyingId === id || !replyText.trim()}
          style={{ background: 'var(--primary)', border: 'none', color: 'white', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'Kanit', cursor: replyingId === id ? 'wait' : 'pointer', opacity: (!replyText.trim() || replyingId === id) ? 0.6 : 1 }}
        >
          {replyingId === id ? 'กำลังส่ง…' : 'ส่งคำตอบ'}
        </button>
      </div>
    </div>
  )

  const renderRepliedBox = (body: string, at?: string) => (
    <div style={{ marginTop: 8, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, padding: '8px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#047857', marginBottom: 2 }}>
        ✓ ตอบแล้ว{at ? ` · ${fmtDateTime(at)}` : ''}
      </div>
      <div style={{ fontSize: 13, color: '#065F46', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{body}</div>
    </div>
  )

  const renderFilterToggle = (checked: boolean, onChange: (v: boolean) => void, label: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)', fontFamily: 'Kanit', cursor: 'pointer', marginBottom: 10, justifyContent: 'flex-end' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  )

  return (
    <>
      <div className="page" style={{ padding: '16px 16px 80px' }}>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
          ข้อความ & รายงาน
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {[
            { key: 'messages' as const, label: `💬 ข้อความ (${unreadMessages.length})` },
            { key: 'feedback' as const, label: `📝 ข้อเสนอแนะ (${openFeedback.length})` },
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

        {/* Messages (contact form) */}
        {!loading && tab === 'messages' && (
          <>
            {messages.length > 0 && renderFilterToggle(showReadMessages, setShowReadMessages, `แสดงที่อ่านแล้วด้วย (${messages.length - unreadMessages.length})`)}
            {visibleMessages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8' }}>
                {messages.length === 0 ? 'ยังไม่มีข้อความ' : '✓ อ่านครบทุกข้อความแล้ว'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleMessages.map((m: any) => {
                  const isUnread = !m.read_at
                  const key = replyKey('message', m.id)
                  const isMarking = markingId === m.id
                  return (
                    <div key={m.id} style={{
                      background: 'white', borderRadius: 12, padding: '14px 16px',
                      border: `1px solid ${isUnread ? '#BFDBFE' : 'var(--border)'}`,
                      borderLeft: isUnread ? '4px solid #3B82F6' : '1px solid var(--border)',
                      opacity: isUnread ? 1 : 0.85,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#121212', minWidth: 0 }}>
                          {isUnread && <span style={{ background: '#3B82F6', color: 'white', borderRadius: 4, padding: '1px 6px', fontSize: 10, marginRight: 6, verticalAlign: 'middle' }}>ใหม่</span>}
                          {m.display_name || 'Guest'}
                          {m.email && <span style={{ fontWeight: 400, color: '#94A3B8', marginLeft: 6 }}>{m.email}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }} title={fmtDateTime(m.created_at)}>{timeSince(m.created_at)}</div>
                      </div>
                      {m.subject && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>{m.subject}</div>}
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{m.message}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 11, color: '#94A3B8', display: 'flex', gap: 12, flexWrap: 'wrap', flex: 1 }}>
                          {!m.user_id && <span style={{ fontStyle: 'italic' }}>ไม่ได้ล็อกอิน</span>}
                          {m.read_at && <span>👁 อ่านแล้ว {fmtDateTime(m.read_at)}</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {isUnread ? (
                            <button
                              onClick={() => markMessageRead(m.id, true)}
                              disabled={isMarking}
                              style={{ ...btnBase, border: '1px solid #A7F3D0', color: '#047857', cursor: isMarking ? 'wait' : 'pointer' }}
                            >
                              {isMarking ? '...' : '✓ อ่านแล้ว'}
                            </button>
                          ) : (
                            <button
                              onClick={() => markMessageRead(m.id, false)}
                              disabled={isMarking}
                              style={{ ...btnBase, border: '1px solid var(--border)', color: 'var(--ink2)', cursor: isMarking ? 'wait' : 'pointer' }}
                            >
                              {isMarking ? '...' : 'ยังไม่อ่าน'}
                            </button>
                          )}
                          <button
                            onClick={() => openReply('message', m.id, m.reply?.body || '')}
                            style={{ ...btnBase, border: '1px solid var(--primary)', color: 'var(--primary)' }}
                          >
                            💬 ตอบกลับ
                          </button>
                        </div>
                      </div>

                      {m.reply?.body && replyOpen !== key && renderRepliedBox(m.reply.body, m.reply.created_at)}
                      {replyOpen === key && renderReplyBox('message', m.id, !!m.user_id, m.email || null)}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Feedback (แจ้งปัญหา/ข้อเสนอแนะ จาก footer form) */}
        {!loading && tab === 'feedback' && (
          <>
            {feedback.length > 0 && renderFilterToggle(showResolvedFeedback, setShowResolvedFeedback, `แสดงที่ตอบ/ปิดเรื่องแล้วด้วย (${feedback.length - openFeedback.length})`)}
            {visibleFeedback.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94A3B8' }}>
                {feedback.length === 0 ? 'ยังไม่มีข้อเสนอแนะ' : '✓ จัดการครบทุกเรื่องแล้ว'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleFeedback.map((f: any) => {
                  const kindMeta = FEEDBACK_KIND_LABELS[f.kind] || FEEDBACK_KIND_LABELS.general
                  const isDeleting = deletingId === f.id
                  const key = replyKey('feedback', f.id)
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
                            <span style={{ fontFamily: 'monospace' }}>🕐 {fmtDateTime(f.created_at)}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => openReply('feedback', f.id, f.admin_note || '')}
                            style={{ ...btnBase, border: '1px solid var(--primary)', color: 'var(--primary)' }}
                          >
                            💬 ตอบกลับ
                          </button>
                          <button
                            onClick={() => deleteFeedback(f.id)}
                            disabled={isDeleting}
                            style={{ ...btnBase, border: '1px solid #FECACA', color: '#DC2626', cursor: isDeleting ? 'wait' : 'pointer' }}
                          >
                            {isDeleting ? '...' : '🗑️ ลบ'}
                          </button>
                        </div>
                      </div>

                      {f.status === 'resolved' && f.admin_note && replyOpen !== key && renderRepliedBox(f.admin_note, f.reviewed_at)}
                      {replyOpen === key && renderReplyBox('feedback', f.id, !!f.user_id, f.contact || null)}
                    </div>
                  )
                })}
              </div>
            )}
          </>
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

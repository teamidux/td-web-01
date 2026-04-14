'use client'
import { useEffect, useState } from 'react'
import type { User } from '@/lib/supabase'

// Smart single-button opt-in สำหรับ LINE notification
// - State 1 (ยังไม่เชื่อม LINE): ปุ่ม "เริ่มเลย" → LINE OAuth (พ่วง add OA)
// - State 2 (เชื่อม LINE แล้ว แต่ไม่ add OA): ปุ่ม "Add" → deeplink LINE
// - State 3 (ครบแล้ว): ซ่อน
// - ซ่อนใน FB browser + iPhone Chrome (LINE OAuth ใช้ไม่ได้)

export default function LineAlertOptin({ user, nextPath = '/notifications' }: { user: User | null; nextPath?: string }) {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const ua = navigator.userAgent
    // FB browser → LINE OAuth ใช้ไม่ได้
    if (/FBAN|FBAV/.test(ua)) { setBlocked(true); return }
    // iPhone Chrome → Apple บังคับ Safari สำหรับ LINE OAuth
    if (/CriOS/.test(ua)) { setBlocked(true); return }
  }, [])

  if (!user || blocked) return null

  const hasLineLinked = !!(user as any).line_user_id
  const hasLineFriend = !!(user as any).line_oa_friend_at

  // State 3: ครบแล้ว → ไม่แสดง
  if (hasLineLinked && hasLineFriend) return null

  const oaId = process.env.NEXT_PUBLIC_LINE_OA_BASIC_ID || '@521qvzrv'

  // State 2: เชื่อมแล้ว แต่ยังไม่ add OA
  if (hasLineLinked && !hasLineFriend) {
    return (
      <a
        href={`https://line.me/R/ti/p/${oaId}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12,
          padding: '14px 16px', marginTop: 20, textDecoration: 'none', color: 'inherit',
        }}
      >
        <span style={{ fontSize: 24 }}>💚</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>Add @BookMatch เป็นเพื่อน</div>
          <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>อีกขั้นเดียวจะได้รับแจ้งเตือนทาง LINE</div>
        </div>
        <span style={{
          background: '#06C755', color: 'white', borderRadius: 8,
          padding: '8px 14px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
        }}>Add →</span>
      </a>
    )
  }

  // State 1: ยังไม่เชื่อม LINE เลย → LINE OAuth (bot_prompt=aggressive จะพ่วง add OA ด้วย)
  return (
    <a
      href={`/api/auth/line/start?next=${encodeURIComponent(nextPath)}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 12,
        padding: '14px 16px', marginTop: 20, textDecoration: 'none', color: 'inherit',
      }}
    >
      <span style={{ fontSize: 24 }}>💚</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>รับแจ้งเตือนทาง LINE</div>
        <div style={{ fontSize: 13, color: '#15803D', marginTop: 2 }}>bonus — ไม่ต้องเปิดเว็บก็รู้</div>
      </div>
      <span style={{
        background: '#06C755', color: 'white', borderRadius: 8,
        padding: '8px 14px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
      }}>เริ่มเลย →</span>
    </a>
  )
}

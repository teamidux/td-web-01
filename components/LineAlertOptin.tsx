'use client'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import type { User } from '@/lib/supabase'

// Smart single-button opt-in สำหรับ LINE notification
// - State 1: ยังไม่เชื่อม LINE → ปุ่ม 'เริ่มเลย'
// - State 2: เชื่อมแล้ว แต่ยังไม่ add OA → ปุ่ม 'Add'
// - State 3: ครบแล้ว → ซ่อน (หรือ success banner ชั่วคราวถ้าเพิ่งสำเร็จ)
// - ซ่อนใน FB browser + iPhone Chrome (LINE OAuth ใช้ไม่ได้)

export default function LineAlertOptin({ user, nextPath = '/notifications' }: { user: User | null; nextPath?: string }) {
  const [blocked, setBlocked] = useState(false)
  const [justConnected, setJustConnected] = useState(false)
  const { reloadUser } = useAuth()
  const wasFriendRef = useRef<boolean>(!!(user as any)?.line_oa_friend_at)
  const checkingRef = useRef(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const ua = navigator.userAgent
    if (/FBAN|FBAV/.test(ua) || /CriOS/.test(ua)) setBlocked(true)
  }, [])

  // Track transition: was-not-friend → is-friend → โชว์ success
  useEffect(() => {
    const isFriendNow = !!(user as any)?.line_oa_friend_at
    if (!wasFriendRef.current && isFriendNow) {
      setJustConnected(true)
      const t = setTimeout(() => setJustConnected(false), 4000)
      wasFriendRef.current = true
      return () => clearTimeout(t)
    }
    wasFriendRef.current = isFriendNow
  }, [user])

  // Auto check สถานะ friendship ผ่าน LINE API (เผื่อ webhook ไม่ fire)
  const check = async () => {
    if (checkingRef.current) return
    if (!(user as any)?.line_user_id) return
    if ((user as any)?.line_oa_friend_at) return
    checkingRef.current = true
    try {
      const r = await fetch('/api/line/check-friendship', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (d.isFriend) await reloadUser()
    } catch {}
    checkingRef.current = false
  }

  useEffect(() => {
    if (blocked) return
    if (!(user as any)?.line_user_id) return
    if ((user as any)?.line_oa_friend_at) return

    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, (user as any)?.line_user_id, (user as any)?.line_oa_friend_at])

  if (!user || blocked) return null

  const hasLineLinked = !!(user as any).line_user_id
  const hasLineFriend = !!(user as any).line_oa_friend_at
  const oaId = process.env.NEXT_PUBLIC_LINE_OA_BASIC_ID || '@521qvzrv'

  // Success banner — แสดงครั้งเดียวชั่วคราวหลังเชื่อมสำเร็จ
  if (hasLineLinked && hasLineFriend) {
    if (!justConnected) return null
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#DCFCE7', border: '1px solid #86EFAC', borderRadius: 12,
        padding: '14px 16px', marginTop: 20,
      }}>
        <span style={{ fontSize: 24 }}>✅</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D' }}>พร้อมรับแจ้งเตือนทาง LINE แล้ว!</div>
          <div style={{ fontSize: 13, color: '#16A34A', marginTop: 2 }}>เมื่อมีคนสนใจหรือหนังสือที่ตามหามีคนขาย เราจะแจ้งคุณทาง LINE</div>
        </div>
      </div>
    )
  }

  // State 2: เชื่อม LINE แล้ว แต่ยังไม่ add OA
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

  // State 1: ยังไม่เชื่อม LINE
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

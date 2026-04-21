'use client'
import { useEffect, useRef, useState } from 'react'

// LINE browser → iOS แสดงหน้าจอเต็มให้กดปุ่มเปิด Safari, Android auto-redirect
export default function LineBrowserBanner() {
  const [mode, setMode] = useState<'hidden' | 'ios' | 'android-fallback'>('hidden')
  // Ref เก็บ cleanup ของ openExternal ปัจจุบัน — กด repeat ไม่ทำให้ listener ซ้อน
  const pendingCleanupRef = useRef<(() => void) | null>(null)

  // Cleanup pending listeners ตอน unmount — กัน leak
  useEffect(() => {
    return () => {
      pendingCleanupRef.current?.()
      pendingCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    if (!/Line\//.test(ua)) return
    const ios = /iPhone|iPad|iPod/.test(ua)

    if (ios) {
      // iOS: แสดงหน้าจอเต็มพร้อมปุ่ม "เปิดใน Safari" — บังคับ auto ไม่ได้
      setMode('ios')
      return
    }

    // Android: auto-redirect ด้วย intent:// (ตรงกว่า line.me/R/nv/externalBrowser
    // ซึ่ง LINE deprecate แล้ว → ดักให้เปิด LINE app แทน)
    const url = window.location.href
    let wentAway = false
    const markAway = () => { wentAway = true }
    document.addEventListener('visibilitychange', markAway)
    window.addEventListener('pagehide', markAway)
    window.addEventListener('beforeunload', markAway)

    // intent://URL#Intent;scheme=https;end → Android เปิด default browser chooser
    const intentUrl = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;end`
    window.location.href = intentUrl

    const timer = setTimeout(() => {
      if (!wentAway && !document.hidden) setMode('android-fallback')
    }, 1500)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', markAway)
      window.removeEventListener('pagehide', markAway)
      window.removeEventListener('beforeunload', markAway)
    }
  }, [])

  const openExternal = () => {
    pendingCleanupRef.current?.()

    const url = window.location.href
    let wentAway = false
    const markAway = () => { wentAway = true }
    document.addEventListener('visibilitychange', markAway)
    window.addEventListener('pagehide', markAway)
    window.addEventListener('blur', markAway)

    if (mode === 'ios') {
      // iOS: auto copy + ให้ user วางใน Safari (บังคับ open external ไม่ได้)
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          alert('คัดลอกลิงก์แล้ว ✓\nเปิด Safari แล้ววาง URL ได้เลย')
        }).catch(() => {
          alert('กดปุ่ม ••• (มุมขวาบน) แล้วเลือก "Open in Safari"')
        })
      } else {
        alert('กดปุ่ม ••• (มุมขวาบน) แล้วเลือก "Open in Safari"')
      }
      return
    }

    // Android: intent:// — เปิด default browser picker
    window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;end`

    const timer = setTimeout(() => {
      cleanup()
      pendingCleanupRef.current = null
      if (wentAway || document.hidden) return
      // Fallback 2: force Chrome specifically
      window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
    }, 1200)

    const cleanup = () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', markAway)
      window.removeEventListener('pagehide', markAway)
      window.removeEventListener('blur', markAway)
    }
    pendingCleanupRef.current = cleanup
  }

  // ── iOS: หน้าจอเต็มพร้อมปุ่มใหญ่ ──
  if (mode === 'ios') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(160deg, #1E3A8A 0%, #2563EB 50%, #3B82F6 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', textAlign: 'center', color: 'white',
      }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>🧭</div>
        <div style={{ fontFamily: "'Kanit', sans-serif", fontSize: 24, fontWeight: 700, marginBottom: 10, lineHeight: 1.4 }}>
          เปิดใน Safari<br />เพื่อใช้งานได้เต็มที่
        </div>
        <div style={{ fontSize: 15, opacity: 0.85, lineHeight: 1.7, marginBottom: 32, maxWidth: 300 }}>
          LINE browser ไม่รองรับการถ่ายรูปและสแกน Barcode<br />
          กดปุ่มด้านล่างเพื่อเปิดใน Safari
        </div>
        <button
          onClick={openExternal}
          style={{
            background: 'white', color: '#1E40AF', border: 'none', borderRadius: 14,
            padding: '16px 48px', fontSize: 18, fontWeight: 700, fontFamily: 'Kanit',
            cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,.25)',
            minWidth: 240,
          }}
        >
          เปิดใน Safari
        </button>
        <button
          onClick={() => setMode('hidden')}
          style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,.5)',
            fontSize: 14, fontFamily: 'Kanit', cursor: 'pointer', marginTop: 20,
            padding: '8px 16px',
          }}
        >
          ใช้งานต่อใน LINE
        </button>
      </div>
    )
  }

  // ── Android fallback: banner เล็ก (แสดงเมื่อ auto-redirect ไม่ work) ──
  if (mode === 'android-fallback') {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 100%)',
        color: 'white', padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 13, lineHeight: 1.4,
      }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>เปิดใน Chrome</div>
          <div style={{ fontSize: 13, opacity: .9, marginTop: 2 }}>เพื่อสแกนและถ่ายรูปได้สะดวกขึ้น</div>
        </div>
        <button onClick={openExternal} style={{
          background: 'white', color: '#1E40AF', border: 'none', borderRadius: 8,
          padding: '6px 12px', fontSize: 12, fontWeight: 700, fontFamily: 'Kanit',
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        }}>เปิด</button>
        <button onClick={() => setMode('hidden')} aria-label="ปิด" style={{
          background: 'rgba(255,255,255,.15)', color: 'white', border: 'none', borderRadius: 8,
          width: 28, height: 28, fontSize: 14, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
      </div>
    )
  }

  return null
}

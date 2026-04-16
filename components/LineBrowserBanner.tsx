'use client'
import { useEffect, useState } from 'react'

// LINE browser → iOS แสดงหน้าจอเต็มให้กดปุ่มเปิด Safari, Android auto-redirect
export default function LineBrowserBanner() {
  const [mode, setMode] = useState<'hidden' | 'ios' | 'android-fallback'>('hidden')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    if (!/Line\//.test(ua)) return
    const ios = /iPhone|iPad|iPod/.test(ua)

    if (ios) {
      // iOS: แสดงหน้าจอเต็มพร้อมปุ่ม "เปิดใน Safari"
      setMode('ios')
    } else {
      // Android: auto-redirect ทันที
      const url = window.location.href
      window.location.href = `https://line.me/R/nv/externalBrowser?url=${encodeURIComponent(url)}`
      // fallback ถ้า LINE scheme ไม่ work
      setTimeout(() => setMode('android-fallback'), 1500)
    }
  }, [])

  const openExternal = () => {
    const url = window.location.href
    // ลอง LINE scheme ก่อน (ใช้ได้ทั้ง iOS + Android)
    window.location.href = `https://line.me/R/nv/externalBrowser?url=${encodeURIComponent(url)}`

    // fallback หลัง 600ms
    setTimeout(() => {
      if (mode === 'ios') {
        // iOS fallback: copy URL
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            alert('คัดลอกลิงก์แล้ว ✓\nเปิด Safari แล้ววาง URL ได้เลย')
          }).catch(() => {
            alert('กดปุ่ม ••• (มุมขวาบน) แล้วเลือก "Open in Safari"')
          })
        } else {
          alert('กดปุ่ม ••• (มุมขวาบน) แล้วเลือก "Open in Safari"')
        }
      } else {
        // Android fallback: intent
        window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
      }
    }, 600)
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

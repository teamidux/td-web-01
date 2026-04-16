'use client'
import { useEffect, useState } from 'react'

// Banner สำหรับ LINE browser — auto-redirect ไป Safari/Chrome ทั้ง iOS + Android
// ใช้ LINE URL scheme: line.me/R/nv/externalBrowser ซึ่งรองรับทั้ง 2 แพลตฟอร์ม
export default function LineBrowserBanner() {
  const [show, setShow] = useState(false)
  const [isIos, setIsIos] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    const isLine = /Line\//.test(ua)
    if (!isLine) return
    const ios = /iPhone|iPad|iPod/.test(ua)
    setIsIos(ios)

    // ใช้ LINE URL scheme เปิด external browser (ใช้ได้ทั้ง iOS + Android)
    const currentUrl = window.location.href
    window.location.href = `https://line.me/R/nv/externalBrowser?url=${encodeURIComponent(currentUrl)}`

    // ถ้า redirect ไม่ work (LINE เก่า หรือ scheme ถูก block) → แสดง banner fallback
    setTimeout(() => setShow(true), 1500)
  }, [])

  const dismiss = () => {
    setShow(false)
  }

  const openExternal = () => {
    const url = window.location.href
    // ลอง LINE scheme อีกครั้ง
    window.location.href = `https://line.me/R/nv/externalBrowser?url=${encodeURIComponent(url)}`

    // fallback ตาม platform
    setTimeout(() => {
      if (isIos) {
        // iOS: copy URL + แนะนำเปิด Safari เอง
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
        // Android: ใช้ intent URL เปิด Chrome
        window.location.href = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`
      }
    }, 500)
  }

  if (!show) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 100%)',
      color: 'white',
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      lineHeight: 1.4,
    }}>
      <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>เปิดใน {isIos ? 'Safari' : 'Chrome'}</div>
        <div style={{ fontSize: 13, opacity: .9, marginTop: 2, lineHeight: 1.4 }}>เพื่อสแกนและถ่ายรูปได้สะดวกขึ้น</div>
      </div>
      <button
        onClick={openExternal}
        style={{
          background: 'white',
          color: '#1E40AF',
          border: 'none',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'Kanit',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        เปิด
      </button>
      <button
        onClick={dismiss}
        aria-label="ปิด"
        style={{
          background: 'rgba(255,255,255,.15)',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          width: 28,
          height: 28,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  )
}

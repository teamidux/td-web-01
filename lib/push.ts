function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

export async function getPushState(reg: ServiceWorkerRegistration): Promise<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'> {
  if (!('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'subscribed' : 'unsubscribed'
}

export async function subscribePush(reg: ServiceWorkerRegistration, userId: string): Promise<boolean> {
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapidKey) { console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set'); return false }
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, subscription: sub.toJSON() }),
    })
    return res.ok
  } catch (err) {
    console.error('subscribePush error:', err)
    return false
  }
}

export async function unsubscribePush(reg: ServiceWorkerRegistration, userId: string): Promise<boolean> {
  try {
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return true
    await sub.unsubscribe()
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    return true
  } catch {
    return false
  }
}

import Link from 'next/link'

export const metadata = { title: 'ข้อตกลงการใช้บริการ — BookMatch' }

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 80px', fontFamily: "'Kanit', sans-serif" }}>
      <Link href="/" style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none' }}>← กลับหน้าแรก</Link>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>ข้อตกลงการใช้บริการ</h1>
      <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 24 }}>อัปเดตล่าสุด: 10 เมษายน 2569</p>

      <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.9 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>1. เกี่ยวกับบริการ</h2>
        <p>BookMatch เป็นแพลตฟอร์มตัวกลางสำหรับซื้อขายหนังสือมือสองระหว่างผู้ใช้ เราไม่ได้เป็นผู้ซื้อหรือผู้ขายโดยตรง</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>2. การลงทะเบียนและบัญชีผู้ใช้</h2>
        <p>ผู้ใช้ต้องเข้าสู่ระบบผ่าน LINE Login ข้อมูลที่ได้รับจะใช้เพื่อการยืนยันตัวตนและการติดต่อระหว่างผู้ซื้อและผู้ขายเท่านั้น</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>3. การยืนยันตัวตน</h2>
        <p>ผู้ขายสามารถยืนยันตัวตนด้วยบัตรประชาชนและสมุดบัญชี เอกสารเหล่านี้จะถูกเก็บในระบบเข้ารหัส ใช้เพื่อการตรวจสอบตัวตนเท่านั้น ไม่เผยแพร่หรือส่งต่อบุคคลที่สาม</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>4. การซื้อขาย</h2>
        <p>การตกลงซื้อขายเกิดขึ้นระหว่างผู้ซื้อและผู้ขายโดยตรง BookMatch ไม่รับผิดชอบต่อคุณภาพสินค้า การจัดส่ง หรือข้อพิพาทที่เกิดขึ้น</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>5. เนื้อหาที่ห้ามลง</h2>
        <p>ห้ามลงขายหนังสือละเมิดลิขสิทธิ์ สิ่งพิมพ์ผิดกฎหมาย หรือเนื้อหาที่ไม่เหมาะสม ทีมงานสงวนสิทธิ์ในการลบเนื้อหาโดยไม่ต้องแจ้งล่วงหน้า</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>6. ความเป็นส่วนตัว (PDPA)</h2>
        <p>เราเก็บรวบรวมข้อมูลเท่าที่จำเป็นต่อการใช้บริการ ได้แก่ ชื่อ LINE ID เบอร์โทร และเอกสารยืนยันตัวตน ผู้ใช้มีสิทธิขอลบข้อมูลได้ตลอดเวลาโดยติดต่อเราผ่านระบบ</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>7. การเปลี่ยนแปลงข้อตกลง</h2>
        <p>เราอาจปรับปรุงข้อตกลงนี้เป็นครั้งคราว การใช้บริการต่อหลังการเปลี่ยนแปลงถือว่ายอมรับข้อตกลงใหม่</p>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>8. ติดต่อเรา</h2>
        <p>หากมีข้อสงสัยเกี่ยวกับข้อตกลงนี้ สามารถติดต่อได้ผ่านระบบ "ติดต่อเรา" ในหน้าโปรไฟล์</p>
      </div>
    </div>
  )
}

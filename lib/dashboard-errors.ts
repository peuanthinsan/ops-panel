export type DashboardLanguage = 'en' | 'th';

export function localizedDashboardAdminError(message: string, language: DashboardLanguage) {
  if (language === 'en') return message || 'Request failed';
  if (message === 'Current admin password is incorrect') return 'รหัสผ่านผู้ดูแลปัจจุบันไม่ถูกต้อง';
  if (message === 'New admin password must be 12 to 128 characters') return 'รหัสผ่านใหม่ต้องมี 12 ถึง 128 ตัวอักษร';
  if (message === 'New admin password must be different') return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม';
  if (message.startsWith('Device is already connected')) return 'อุปกรณ์นี้เชื่อมต่ออยู่แล้ว กรุณาแก้ไขจากรายการด้านล่าง';
  if (message.includes('active job before changing')) return 'กรุณาจบหรือยกเลิกงานที่กำลังทำก่อนเปลี่ยนการเชื่อมต่อรถ';
  if (message.includes('active job before removing')) return 'กรุณาจบหรือยกเลิกงานที่กำลังทำก่อนยกเลิกการเชื่อมต่อรถ';
  if (message.includes('vehicle binding changed while an active job')) return 'การเชื่อมต่อรถเปลี่ยนระหว่างบันทึกงาน กรุณาตรวจสอบอุปกรณ์แล้วลองอีกครั้ง';
  if (message.includes('Could not reach')) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Songdee Ops ได้';
  return 'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง';
}

export function localizedDashboardReportError(message: string, language: DashboardLanguage, fallback: string) {
  if (language === 'en') return message || fallback;
  if (message.includes('Could not reach')) return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Songdee Ops ได้';
  if (message === 'Report not found') return 'ไม่พบรายงานนี้';
  if (message === 'Cancelled jobs do not require GPS lookup') return 'งานที่ยกเลิกไม่จำเป็นต้องค้นหาข้อมูล GPS';
  return fallback;
}

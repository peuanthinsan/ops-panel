import type { MobileLanguage } from './mobile-copy';

export type MobileOperation = 'connect' | 'finish' | 'cancel';

const operationFallback = {
  connect: {
    en: 'Could not connect to the server',
    th: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้',
  },
  finish: {
    en: 'Could not save job',
    th: 'ไม่สามารถบันทึกงานได้',
  },
  cancel: {
    en: 'Could not cancel job',
    th: 'ไม่สามารถยกเลิกงานได้',
  },
} as const;

export function mobileOperationErrorMessage(error: unknown, language: MobileLanguage, operation: MobileOperation) {
  const raw = error instanceof Error ? error.message.trim() : '';
  if (language === 'en') return raw || operationFallback[operation].en;
  if (!raw) return operationFallback[operation].th;

  const message = raw.toLowerCase();
  if (message.includes('unreachable') || message.includes('timed out') || message.includes('network request failed')) {
    return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Songdee GPS ได้ กรุณาตรวจสอบเครือข่ายและที่อยู่ API';
  }
  if (message.includes('vehicle and device were not connected') || message.includes('vehicle connection')) {
    return 'การเชื่อมต่อรถกับอุปกรณ์ไม่ตรงกัน กรุณาติดต่อผู้ดูแลระบบ';
  }
  if (message.includes('already has an active job')) {
    return 'อุปกรณ์นี้มีงานที่กำลังทำอยู่แล้ว กรุณาจบหรือยกเลิกงานนั้นก่อน';
  }
  if (message.includes('id is already used') || message.includes('already used by a different')) {
    return 'ข้อมูลงานนี้ขัดแย้งกับข้อมูลที่บันทึกไว้ กรุณาติดต่อผู้ดูแลระบบ';
  }
  if (message.includes('required') || message.includes('must be') || message.includes('invalid') || message.includes('valid ')) {
    return 'เซิร์ฟเวอร์ไม่ยอมรับข้อมูลงาน กรุณาติดต่อผู้ดูแลระบบ';
  }

  return operationFallback[operation].th;
}


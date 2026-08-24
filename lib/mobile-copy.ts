export type MobileLanguage = 'en' | 'th';

export const mobileCopy = {
  en: {
    setupEyebrow: 'ONE-TIME SETUP',
    setup: 'Enter vehicle number',
    setupBody: 'Connect this tablet once. Later vehicle changes require the admin password.',
    vehicle: 'Vehicle number',
    save: 'Save vehicle',
  },
  th: {
    setupEyebrow: 'ตั้งค่าครั้งแรก',
    setup: 'กรอกหมายเลขรถ',
    setupBody: 'เชื่อมต่อแท็บเล็ตเครื่องนี้เพียงครั้งเดียว การเปลี่ยนรถภายหลังต้องใช้รหัสผ่านผู้ดูแล',
    vehicle: 'หมายเลขรถ',
    save: 'บันทึกหมายเลขรถ',
  },
} as const;

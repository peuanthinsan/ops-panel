import type { DriverIdentity } from './job-flow';

const labels = {
  en: {
    driver: 'Driver',
    driverId: 'Driver ID',
    deviceId: 'Device ID',
    waiting: 'Waiting for driver identification',
  },
  th: {
    driver: 'คนขับ',
    driverId: 'รหัสคนขับ',
    deviceId: 'รหัสอุปกรณ์',
    waiting: 'รอข้อมูลระบุตัวคนขับ',
  },
} as const;

export function driverHeaderText(identity: DriverIdentity, deviceId: string, language: 'en' | 'th') {
  const copy = labels[language];
  const driverName = identity?.driverName?.trim();
  const driverId = identity?.driverId?.trim();
  const identified = [
    driverName ? `${copy.driver}: ${driverName}` : null,
    driverId ? `${copy.driverId}: ${driverId}` : null,
  ].filter(Boolean);
  return identified.length
    ? identified.join(' · ')
    : `${copy.waiting} · ${copy.deviceId}: ${deviceId}`;
}

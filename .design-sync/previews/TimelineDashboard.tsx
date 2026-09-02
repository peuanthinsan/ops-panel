import * as React from 'react';
import { TimelineDashboard } from 'songdee-ops-panel';

// Static sourceReports: one Bangkok work day for three vehicles (no fetching).
const reports = [
  { id: 'j-9001', vehicleNumber: 'SD-071', driverName: 'สมชาย ใจดี', mode: 'Load', status: 'Completed', workPeriodDate: '2026-08-20', workPeriodStartTime: '2026-08-20T07:30:00+07:00', startTime: '2026-08-20T08:00:00+07:00', endTime: '2026-08-20T09:10:00+07:00', locationName: 'คลังสินค้าบางนา', topSpeed: 62 },
  { id: 'j-9002', vehicleNumber: 'SD-071', driverName: 'สมชาย ใจดี', mode: 'Unload', status: 'Completed', workPeriodDate: '2026-08-20', workPeriodStartTime: '2026-08-20T07:30:00+07:00', startTime: '2026-08-20T10:00:00+07:00', endTime: '2026-08-20T11:20:00+07:00', locationName: 'ศูนย์กระจายสินค้าชลบุรี', topSpeed: 95 },
  { id: 'j-9003', vehicleNumber: 'SD-105', driverName: 'วิชัย พงษ์ไทย', mode: 'Vehicle check', status: 'Completed', workPeriodDate: '2026-08-20', workPeriodStartTime: '2026-08-20T06:45:00+07:00', startTime: '2026-08-20T07:00:00+07:00', endTime: '2026-08-20T07:30:00+07:00', locationName: 'อู่ลาดกระบัง', topSpeed: 20 },
  { id: 'j-9004', vehicleNumber: 'SD-105', driverName: 'วิชัย พงษ์ไทย', mode: 'Load', status: 'Completed', workPeriodDate: '2026-08-20', workPeriodStartTime: '2026-08-20T06:45:00+07:00', startTime: '2026-08-20T08:15:00+07:00', endTime: '2026-08-20T09:40:00+07:00', locationName: 'ท่าเรือแหลมฉบัง', topSpeed: 88 },
  { id: 'j-9005', vehicleNumber: 'SD-118', driverName: 'ประยุทธ์ สุขสันต์', mode: 'Refuel', status: 'Completed', workPeriodDate: '2026-08-20', workPeriodStartTime: '2026-08-20T09:00:00+07:00', startTime: '2026-08-20T09:30:00+07:00', endTime: '2026-08-20T09:50:00+07:00', locationName: 'ปั๊ม ปตท. บางปะกง', topSpeed: 45 },
  { id: 'j-9006', vehicleNumber: 'SD-118', driverName: 'ประยุทธ์ สุขสันต์', mode: 'Finish work', status: 'Completed', workPeriodDate: '2026-08-20', workPeriodStartTime: '2026-08-20T09:00:00+07:00', startTime: '2026-08-20T16:30:00+07:00', endTime: '2026-08-20T17:00:00+07:00', locationName: 'คลังสินค้าบางนา', topSpeed: 58 },
];

export const ThaiWorkday = () => (
  <TimelineDashboard lang="th" sourceReports={reports} sourceLoading={false} sourceError="" />
);

export const EnglishWorkday = () => (
  <TimelineDashboard lang="en" sourceReports={reports} sourceLoading={false} sourceError="" />
);

export const LoadingState = () => (
  <TimelineDashboard lang="en" sourceReports={[]} sourceLoading sourceError="" />
);

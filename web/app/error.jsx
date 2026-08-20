'use client';

import Image from 'next/image';
import { useEffect } from 'react';

export default function DashboardError({ error, reset }) {
  useEffect(() => { console.error('Songdee dashboard route error', error); }, [error]);
  return <main className="route-error-page" id="main-content" tabIndex={-1}>
    <section className="empty-state route-error-card" role="alert">
      <Image src="/songdee-gps-pin.svg" alt="" width={180} height={220} priority />
      <h1>Dashboard temporarily unavailable</h1>
      <p>เกิดข้อผิดพลาดชั่วคราว ข้อมูลที่บันทึกไว้ยังคงอยู่ กรุณาลองเปิดหน้านี้อีกครั้ง</p>
      <button className="primary" type="button" onClick={reset}>Try again · ลองใหม่</button>
    </section>
  </main>;
}

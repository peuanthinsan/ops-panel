'use client';

import { memo, useMemo, useState } from 'react';

function GatewayPayload({ value, title, filename = 'source-payload', thai, sourceLabel = 'VSS', wirePacket = false }) {
  const t = (en, th) => thai ? th : en;
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const content = useMemo(() => value == null ? null : JSON.stringify(value, null, 2), [value]);
  const lines = useMemo(() => content?.split('\n') || [], [content]);
  const search = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => lines.map((text, index) => ({ text, number: index + 1 })).filter(line => !search || line.text.toLocaleLowerCase().includes(search)), [lines, search]);

  async function copy() {
    if (content === null) return;
    setError(''); setMessage('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t('Clipboard access is unavailable. Download the JSON instead.', 'ไม่สามารถใช้คลิปบอร์ดได้ กรุณาดาวน์โหลด JSON'));
      await navigator.clipboard.writeText(content);
      setMessage(wirePacket ? t('Complete packet JSON copied.', 'คัดลอก JSON ของแพ็กเก็ตทั้งหมดแล้ว') : t('Complete sanitized JSON copied.', 'คัดลอก JSON ที่ซ่อนข้อมูลลับทั้งหมดแล้ว'));
    } catch (cause) { setError(cause.message || t('Could not copy the payload.', 'คัดลอกข้อมูลไม่ได้')); }
  }
  function download() {
    if (content === null) return;
    setError(''); setMessage('');
    try {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(t('JSON download started.', 'เริ่มดาวน์โหลด JSON แล้ว'));
    } catch { setError(t('Could not start the download.', 'เริ่มดาวน์โหลดไม่ได้')); }
  }

  return <section className="gw-payload" aria-label={title}>
    <div className="gw-panel-title"><h3>{title}</h3><div className="gw-actions"><button className="gw-button" type="button" disabled={content === null} onClick={copy}>{t('Copy JSON', 'คัดลอก JSON')}</button><button className="gw-button" type="button" disabled={content === null} onClick={download}>{t('Download JSON', 'ดาวน์โหลด JSON')}</button></div></div>
    <label className="gw-payload-search"><span>{t('Search fields or values', 'ค้นหาชื่อฟิลด์หรือค่า')}</span><input type="search" value={query} disabled={content === null} placeholder={t('For example: input, voltage, configJson', 'เช่น input, voltage, configJson')} onChange={event => setQuery(event.target.value)} /></label>
    {search && <p className="gw-small" role="status">{visible.length} {wirePacket ? t('matching lines. Copy and download include the complete captured record.', 'บรรทัดที่ตรงกัน การคัดลอกและดาวน์โหลดจะรวมรายการที่บันทึกทั้งหมด') : t('matching lines. Copy and download include the complete sanitized payload.', 'บรรทัดที่ตรงกัน การคัดลอกและดาวน์โหลดจะรวมข้อมูลที่ซ่อนข้อมูลลับทั้งหมด')}</p>}
    {message && <p className="gw-small" role="status">{message}</p>}{error && <div className="gw-notice gw-error" role="alert">{error}</div>}
    {content === null ? <p className="gw-muted">{t('No source payload was returned.', 'ไม่ได้รับข้อมูลต้นฉบับ')}</p> : <pre className="gw-code gw-json-lines" aria-label={wirePacket ? t('Packet JSON content', 'เนื้อหา JSON ของแพ็กเก็ต') : t('Sanitized JSON content', 'เนื้อหา JSON ที่ซ่อนข้อมูลลับ')}>{visible.length ? visible.map(line => <span className="gw-json-line" key={line.number}><span className="gw-line-number" aria-hidden="true">{line.number}</span><code>{line.text}</code></span>) : <span className="gw-json-no-match">{t('No matching fields or values.', 'ไม่พบฟิลด์หรือค่าที่ตรงกัน')}</span>}</pre>}
    <p className="gw-small">{wirePacket ? t('Captured H-protocol header/payload bytes and decoded fields. The raw record indicates whether its byte capture was truncated.', 'ไบต์ส่วนหัวและข้อมูล H-protocol ที่บันทึก พร้อมฟิลด์ที่ถอดรหัส รายการต้นฉบับระบุว่าไบต์ถูกตัดทอนหรือไม่') : t(`${sourceLabel} response with sensitive values removed. Missing fields remain absent; this is not an original MDVR wire packet.`, `ข้อมูลตอบกลับจาก ${sourceLabel} ที่นำค่าลับออกแล้ว ฟิลด์ที่ไม่ส่งมาจะไม่ถูกเติม ข้อมูลนี้ไม่ใช่แพ็กเก็ตจาก MDVR โดยตรง`)}</p>
  </section>;
}

export default memo(GatewayPayload);

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from './dashboard-api';
import './gateway-simulation.css';

const empty = [];
const appNumbers = { loading: '1', unloading: '3', waiting: '2', 'rest-break': '4', 'vehicle-check': '5', refuelling: '6', 'car-wash': '7', 'overnight-parking': '8', 'job-complete': '9' };
const appModeNames = { '1': 'Load', '2': 'Stop vehicle', '3': 'Unload', '4': 'Break', '5': 'Vehicle check', '6': 'Refuel', '7': 'Vehicle wash', '8': 'Park overnight', '9': 'Finish work' };
const productionLabel = scenario => {
  const number = appModeNames[scenario.productionMode] ? String(scenario.productionMode) : appNumbers[scenario.id];
  return `${number} · ${appModeNames[number] || scenario.productionMode}`;
};
const thaiTitles = { loading: 'ขึ้นสินค้า', unloading: 'ลงสินค้า', waiting: 'หยุด / รอ', 'rest-break': 'พักเบรก', 'vehicle-check': 'เช็ครถ', refuelling: 'เติมน้ำมัน', 'car-wash': 'ล้างรถ', 'overnight-parking': 'จอดนอน', 'job-complete': 'จบงาน', sos: 'SOS / ฉุกเฉิน', snapshot: 'ปุ่มถ่ายภาพ' };
const sourceLabels = {
  'howen-tcp': ['Howen TCP · simulated device', 'Howen TCP · อุปกรณ์จำลอง'],
  'simulation-geofence': ['Synthetic geofence', 'ขอบเขตพื้นที่จำลอง'],
  'simulation-app': ['Simulated app / form', 'แอป / แบบฟอร์มจำลอง'],
  'simulation-media': ['Simulated camera / media', 'กล้อง / สื่อจำลอง'],
  'simulation-rule': ['Simulation rule', 'กฎจำลอง'],
};
const stateLabels = {
  idle: ['Ready', 'พร้อม'], running: ['Running', 'กำลังทดสอบ'], stopping: ['Stopping', 'กำลังหยุด'],
  completed: ['Completed', 'ทดสอบเสร็จ'], failed: ['Failed', 'ไม่ผ่าน'], stopped: ['Stopped', 'หยุดแล้ว'],
  pending: ['Not observed yet', 'ยังไม่มีหลักฐาน'], passed: ['Passed', 'ผ่าน'],
};
const display = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
const number = value => Number.isFinite(value) ? value.toLocaleString('en-GB') : '—';
function timestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) : String(value);
}
function State({ value = 'pending', thai }) {
  return <span className={`gs-state gs-state-${value}`}>{stateLabels[value]?.[thai ? 1 : 0] || value}</span>;
}
function Source({ value, thai }) {
  return <span className={`gs-source gs-source-${value}`}>{sourceLabels[value]?.[thai ? 1 : 0] || display(value)}</span>;
}
function PacketLink({ id, packetIds, onInspectPacket, thai }) {
  if (!id) return <span className="gs-muted">—</span>;
  const available = packetIds.has(id);
  return <button className="gs-packet-link" type="button" disabled={!available} onClick={() => onInspectPacket?.(id)} title={available ? (thai ? 'ตรวจสอบแพ็กเก็ตที่ได้รับจริง' : 'Inspect captured packet') : (thai ? 'แพ็กเก็ตพ้นช่วงข้อมูลที่แสดงแล้ว' : 'Packet has left the current display window')}><code>{id}</code>{!available && <small>{thai ? 'พ้นช่วงที่แสดง' : 'Outside display window'}</small>}</button>;
}

export default function GatewaySimulation({ simulation, packets = empty, onSnapshot, onInspectPacket, thai }) {
  const t = (en, th) => thai ? th : en;
  const [selectedId, setSelectedId] = useState('loading');
  const [confirmationMode, setConfirmationMode] = useState(simulation?.confirmationMode || 'driver');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { if (simulation?.confirmationMode) setConfirmationMode(simulation.confirmationMode); }, [simulation?.confirmationMode]);
  const scenarios = simulation?.scenarios || empty;
  const results = simulation?.results || empty;
  const resultById = useMemo(() => new Map(results.map(result => [result.scenarioId, result])), [results]);
  const packetIds = useMemo(() => new Set(packets.map(packet => packet.id)), [packets]);
  const selected = scenarios.find(scenario => scenario.id === selectedId) || scenarios[0];
  const result = selected ? resultById.get(selected.id) : null;
  const events = simulation?.events || empty;
  const selectedEvents = selected ? events.filter(event => event.scenarioId === selected.id) : empty;
  const active = simulation?.status === 'running' || simulation?.status === 'stopping';
  const enabled = simulation?.enabled === true;
  const summary = simulation?.summary || {};
  const stepCount = Math.max(0, Number(simulation?.stepCount) || 0);
  const stepIndex = Math.max(0, Math.min(stepCount, Number(simulation?.stepIndex) || 0));
  const title = scenario => thai ? thaiTitles[scenario?.id] || scenario?.title : scenario?.title;

  async function command(action, scenarioId) {
    if (requestRef.current || !enabled) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError('');
    try {
      const snapshot = await adminFetch('/api/admin/gateway/simulation', {
        method: 'POST', cacheOffline: false, timeoutMs: 15000, signal: controller.signal,
        body: JSON.stringify(action === 'run' ? { action, scenarioId, confirmationMode } : { action }),
      });
      if (controller.signal.aborted) return;
      if (snapshot?.source !== 'howen' || !Array.isArray(snapshot.devices) || !Array.isArray(snapshot.packets) || !snapshot.simulation) throw new Error(t('The server returned an invalid simulation response.', 'เซิร์ฟเวอร์ส่งผลจำลองที่ไม่ถูกต้อง'));
      onSnapshot(snapshot);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || t('Could not update the simulation.', 'อัปเดตการจำลองไม่ได้'));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  return <section className="gs-sandbox" aria-label={t('Simulation sandbox', 'พื้นที่ทดสอบจำลอง')}>
    <header className="gs-heading"><div><span className="gs-eyebrow">SIMULATION SANDBOX</span><h2>{t('11 activity scenarios', 'จำลอง 11 กิจกรรม')}</h2><p>{t('Test the full data flow with a simulated MDVR and an accelerated virtual clock. Results stay in this sandbox; production jobs are not saved.', 'ทดสอบการไหลของข้อมูลด้วย MDVR และเวลาจำลองที่เดินเร็วขึ้น ผลลัพธ์อยู่ในพื้นที่ทดสอบนี้ โดยไม่บันทึกงานจริง')}</p></div>{enabled && <State value={simulation.status} thai={thai} />}</header>
    {!enabled ? <div className="gw-panel"><div className="gs-disabled"><h3>{t('Local simulation is disabled', 'ยังไม่เปิดการจำลองในเครื่อง')}</h3><p>{t('This sandbox must be enabled on the local gateway service. Reconnect after it is enabled. It is separate from real vehicle traffic and the existing job records.', 'ต้องเปิดพื้นที่ทดสอบบนบริการเกตเวย์ในเครื่อง แล้วเชื่อมต่อใหม่ การจำลองแยกจากข้อมูลรถจริงและงานที่บันทึกไว้')}</p></div></div> : <>
      <div className="gs-controls gw-panel">
        <label><span>{t('Work confirmation', 'การยืนยันการทำงาน')}</span><select value={confirmationMode} disabled={busy || active} onChange={event => setConfirmationMode(event.target.value)}><option value="driver">{t('Driver confirmation · simulated app', 'คนขับยืนยัน · แอปจำลอง')}</option><option value="input">{t('Wired input · assumed test mapping', 'อินพุตสายไฟ · การจับคู่สมมติ')}</option></select></label>
        <div className="gs-control-actions"><button type="button" className="gw-button gw-primary" disabled={busy || active} onClick={() => command('run', 'all')}>{t('Run all 11', 'ทดสอบทั้ง 11 กิจกรรม')}</button><button type="button" className="gw-button" disabled={busy || active || !selected} onClick={() => command('run', selected.id)}>{t('Run selected', 'ทดสอบกิจกรรมที่เลือก')}</button><button type="button" className="gw-button gs-stop" disabled={busy || !active || simulation.status === 'stopping'} onClick={() => command('stop')}>{t('Stop', 'หยุด')}</button></div>
        <p>{t('A new run resets sandbox results. Wired confirmation uses a synthetic input mapping, not verified vehicle wiring.', 'การทดสอบใหม่จะเริ่มผลลัพธ์ใหม่ การยืนยันด้วยสายไฟใช้การจับคู่อินพุตจำลอง ไม่ใช่การเดินสายรถที่ตรวจสอบแล้ว')}</p>
      </div>
      {(error || simulation.error) && <div className="gw-notice gw-error" role="alert">{error || simulation.error}</div>}
      <section className="gs-progress gw-panel" aria-label={t('Simulation progress', 'ความคืบหน้าการจำลอง')}>
        <div className="gs-progress-top"><div><span className="gs-label">{t('Accelerated virtual time · Bangkok', 'เวลาจำลองแบบเร่ง · กรุงเทพฯ')}</span><strong>{timestamp(simulation.virtualTime)}</strong></div><div><span className="gs-label">{t('Current step', 'ขั้นตอนปัจจุบัน')}</span><strong>{simulation.currentStep ? display(simulation.currentStep) : t('Ready to run', 'พร้อมทดสอบ')}</strong></div><div className="gs-step-count">{stepIndex} / {stepCount}</div></div>
        <progress aria-label={t('Scenario steps', 'ขั้นตอนทดสอบ')} max={stepCount || 1} value={stepIndex} />
        <div className="gs-totals"><span><strong>{number(summary.total)}</strong> {t('scenarios', 'กิจกรรม')}</span><span><strong>{number(summary.passed)}</strong> {t('passed', 'ผ่าน')}</span><span><strong>{number(summary.failed)}</strong> {t('failed', 'ไม่ผ่าน')}</span><span><strong>{number(summary.pending)}</strong> {t('pending', 'รอทดสอบ')}</span></div>
        <p className="gw-small">{t('A pass requires observed evidence. A scenario with missing prerequisites stays unproven.', 'ต้องมีหลักฐานที่สังเกตได้จึงจะผ่าน กิจกรรมที่ขาดเงื่อนไขก่อนเริ่มจะยังไม่ถือว่าพิสูจน์แล้ว')}</p>
      </section>
      <div className="gs-card-grid" aria-label={t('Activity scenarios', 'กิจกรรมจำลอง')}>{scenarios.map(scenario => {
        const outcome = resultById.get(scenario.id);
        const checks = outcome?.checks || empty;
        return <button key={scenario.id} className={`gs-scenario ${selected?.id === scenario.id ? 'gs-selected' : ''}`} type="button" aria-pressed={selected?.id === scenario.id} onClick={() => setSelectedId(scenario.id)}><span className="gs-scenario-top"><span className="gs-number">{String(scenario.number).padStart(2, '0')}</span><State value={outcome?.status || 'pending'} thai={thai} /></span><strong>{title(scenario)}</strong><span className="gs-scenario-kind">{scenario.productionMode ? `${t('App mode', 'โหมดแอป')} ${productionLabel(scenario)}` : t('Event · no production job mode', 'เหตุการณ์ · ไม่มีโหมดงานจริง')}</span><small>{checks.length ? `${checks.filter(check => check.passed === true).length} / ${checks.length} ${t('checks passed', 'เงื่อนไขที่ผ่าน')}` : t('No evidence observed', 'ยังไม่มีหลักฐาน')}</small></button>;
      })}</div>
      {selected && <section className="gw-panel gs-detail" aria-label={t('Selected scenario evidence', 'หลักฐานกิจกรรมที่เลือก')}>
        <div className="gs-detail-heading"><div><span className="gs-eyebrow">{t('SELECTED SCENARIO', 'กิจกรรมที่เลือก')} {String(selected.number).padStart(2, '0')}</span><h3>{title(selected)}</h3></div><State value={result?.status || 'pending'} thai={thai} /></div>
        <p className="gs-mode-map">{selected.productionMode ? <>{t('Existing tablet mapping', 'การจับคู่กับแท็บเล็ตปัจจุบัน')}: <strong>{productionLabel(selected)}</strong></> : t('This is a sandbox event. It does not create a new tablet job mode.', 'รายการนี้เป็นเหตุการณ์ในพื้นที่ทดสอบ ไม่ได้สร้างโหมดงานใหม่บนแท็บเล็ต')}</p>
        <div className="gs-requirements"><h4>{t('Required evidence', 'หลักฐานที่ต้องมี')}</h4><ul>{selected.requirements?.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></div>
        {result?.error && <div className="gw-notice gw-error" role="alert">{result.error}</div>}
        {result?.checks?.length ? <div className="gs-evidence-scroll"><table className="gs-evidence"><thead><tr><th>{t('Check', 'เงื่อนไข')}</th><th>{t('Observed / expected', 'สิ่งที่พบ / ค่าที่คาด')}</th><th>{t('Source', 'แหล่งข้อมูล')}</th><th>{t('Packet evidence', 'หลักฐานแพ็กเก็ต')}</th></tr></thead><tbody>{result.checks.map((check, index) => <tr key={`${check.id}-${index}`}><td><span className={`gs-check-result ${check.passed === true ? 'gs-check-pass' : check.passed === false ? 'gs-check-fail' : ''}`}>{check.passed === true ? t('PASS', 'ผ่าน') : check.passed === false ? t('FAIL', 'ไม่ผ่าน') : t('PENDING', 'รอหลักฐาน')}</span><strong>{check.label}</strong></td><td><span className="gs-label">{t('Observed', 'พบ')}</span><pre>{display(check.actual)}</pre><span className="gs-label">{t('Expected', 'คาดหวัง')}</span><pre>{display(check.expected)}</pre></td><td><Source value={check.source} thai={thai} /></td><td><PacketLink id={check.packetId} packetIds={packetIds} onInspectPacket={onInspectPacket} thai={thai} /></td></tr>)}</tbody></table></div> : <p className="gs-empty" role="status">{t('No checks have been observed for this scenario yet.', 'ยังไม่ได้รับหลักฐานเงื่อนไขสำหรับกิจกรรมนี้')}</p>}
        {selected.limitations?.length > 0 && <div className="gs-limitations"><h4>{t('What this scenario cannot prove', 'สิ่งที่กิจกรรมจำลองนี้ยังพิสูจน์ไม่ได้')}</h4><ul>{selected.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>}
        <details className="gs-event-details"><summary>{t('Scenario events and form / media outcomes', 'เหตุการณ์และผลแบบฟอร์ม / สื่อของกิจกรรม')} <span>{selectedEvents.length}</span></summary>{selectedEvents.length ? <ol className="gs-events">{selectedEvents.map(event => <li key={event.id}><div className="gs-event-header"><strong>{event.title}</strong><Source value={event.source} thai={thai} /></div><div className="gs-event-meta"><time>{timestamp(event.virtualTime)}</time><code>{event.type}</code>{event.packetId && <PacketLink id={event.packetId} packetIds={packetIds} onInspectPacket={onInspectPacket} thai={thai} />}</div><pre>{display(event.data)}</pre></li>)}</ol> : <p className="gs-empty">{t('No scenario events received.', 'ยังไม่มีเหตุการณ์ของกิจกรรม')}</p>}</details>
      </section>}
      <section className="gw-panel gs-fixtures" aria-label={t('Synthetic fixtures', 'ข้อมูลทดสอบจำลอง')}>
        <div className="gs-detail-heading"><div><span className="gs-eyebrow">{t('SYNTHETIC TEST DATA', 'ข้อมูลทดสอบจำลอง')}</span><h3>{t('Geofences, input mapping and thresholds', 'ขอบเขตพื้นที่ อินพุต และค่าเกณฑ์')}</h3></div></div>
        <p className="gs-fixture-note">{t('These circles are generated for this sandbox. They are separate from the Data-FM geofence catalog. Camera and form outcomes here are simulated.', 'วงกลมเหล่านี้สร้างขึ้นสำหรับพื้นที่ทดสอบ แยกจากขอบเขตพื้นที่ Data-FM ผลกล้องและแบบฟอร์มในหน้านี้เป็นข้อมูลจำลอง')}</p>
        <div className="gs-evidence-scroll"><table className="gs-fixture-table"><thead><tr><th>{t('Geofence', 'ขอบเขต')}</th><th>{t('Centre', 'จุดศูนย์กลาง')}</th><th>{t('Radius', 'รัศมี')}</th><th>{t('Purpose', 'วัตถุประสงค์')}</th></tr></thead><tbody>{simulation.fixtures?.geofences?.map(fence => <tr key={fence.id}><td><strong>{fence.name}</strong><small>{fence.id} · {fence.source}</small></td><td>{display(fence.lat)}, {display(fence.lng)}</td><td>{display(fence.radiusMeters)} m</td><td>{display(fence.purpose)}</td></tr>)}</tbody></table></div>
        <div className="gs-fixture-columns"><div><h4>{t('Input assumptions', 'ข้อสมมติอินพุต')}</h4><ul className="gs-input-mapping">{simulation.fixtures?.inputMapping?.map(input => <li key={input.channel}><strong>IO {input.channel}</strong><span>{input.purpose}</span><span className="gs-assumption">{input.confirmed === true ? t('Reported confirmed', 'รายงานว่ายืนยันแล้ว') : t('Wiring unverified', 'ยังไม่ยืนยันการเดินสาย')}</span></li>)}</ul></div><div><h4>{t('Simulation thresholds', 'ค่าเกณฑ์จำลอง')}</h4><pre className="gs-json">{display(simulation.fixtures?.thresholds)}</pre></div></div>
        {simulation.limitations?.length > 0 && <details className="gs-event-details"><summary>{t('Sandbox limitations', 'ข้อจำกัดของพื้นที่ทดสอบ')}</summary><ul>{simulation.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
        <p className="gw-small">{t('Run', 'การทดสอบ')}: <code>{simulation.runId || '—'}</code> · {t('Started', 'เริ่ม')}: {timestamp(simulation.startedAt)} · {t('Finished', 'จบ')}: {timestamp(simulation.finishedAt)}</p>
      </section>
    </>}
  </section>;
}

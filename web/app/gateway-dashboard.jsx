'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from './dashboard-api';
import { clearAdminSessionToken, getAdminSessionToken } from './dashboard-session.js';
import { consumeSnapshotStream, reconnectDelay, waitForReconnect } from './gateway-stream.mjs';
import GatewayPayload from './gateway-payload';
import GatewaySimulation from './gateway-simulation';
import './gateway.css';

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');
const emptyList = [];
const tabs = [
  ['events', 'Events', 'เหตุการณ์'], ['signals', 'Signals', 'สัญญาณ'],
  ['diagnostics', 'Diagnostics', 'การวินิจฉัย'], ['parameters', 'Parameters', 'พารามิเตอร์'],
  ['payload', 'Raw packet', 'แพ็กเก็ตต้นฉบับ'],
  ['simulation', 'Simulation', 'จำลอง'],
];
const humanize = value => String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, letter => letter.toUpperCase());
const scalar = value => value == null || value === '' ? 'Unknown / not received' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const knownNumber = value => Number.isFinite(value) ? value.toLocaleString('en-GB') : '—';
const directionLabel = value => value === 'inbound' ? 'Received' : value === 'outbound' ? 'Sent' : humanize(value);

function stamp(value, timeOnly = false) {
  if (!value) return '—';
  // Do not assign the browser timezone to an unzoned device timestamp.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', ...(timeOnly ? {} : { day: '2-digit', month: 'short', year: 'numeric' }),
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}
function Fields({ values, thai }) {
  const entries = Object.entries(values || {});
  if (!entries.length) return <p className="gw-muted">{thai ? 'ยังไม่ได้รับข้อมูล' : 'No fields received.'}</p>;
  return <dl className="gw-fields">{entries.map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{scalar(value)}</dd></div>)}</dl>;
}
function Empty({ title, children }) {
  return <div className="gw-empty"><span className="gw-empty-symbol" aria-hidden="true">⌁</span><h2>{title}</h2><p>{children}</p></div>;
}
function SimulationBadge({ thai }) {
  return <span className="gw-tag gw-simulation">{thai ? 'ข้อมูลจำลอง · SIMULATION' : 'SIMULATION'}</span>;
}
function Warnings({ warnings, thai }) {
  return warnings?.length > 0 ? <div className="gw-notice gw-warning"><strong>{thai ? 'หมายเหตุการถอดรหัส' : 'Decoder notes'}</strong><ul>{warnings.map((warning, index) => <li key={index}>{scalar(warning)}</li>)}</ul></div> : null;
}
function PacketBytes({ packet, thai }) {
  return <div className="gw-wire-bytes">
    <h3>{thai ? 'ส่วนหัว HEX' : 'Header bytes · HEX'}</h3><pre className="gw-code gw-hex"><code>{packet.raw?.headerHex || (thai ? 'ยังไม่ได้รับข้อมูล' : 'Not captured')}</code></pre>
    <h3>{thai ? 'เนื้อหา HEX' : 'Payload bytes · HEX'}</h3><pre className="gw-code gw-hex"><code>{packet.raw?.payloadHex || (packet.raw?.payloadLength === 0 ? (thai ? 'ไม่มีเนื้อหา · 0 ไบต์' : 'Empty payload · 0 bytes') : (thai ? 'ยังไม่ได้รับข้อมูล' : 'Not captured'))}</code></pre>
    <p className="gw-small">{thai ? 'ขนาดเนื้อหา' : 'Payload length'}: {knownNumber(packet.raw?.payloadLength)} bytes{packet.raw?.truncated ? (thai ? ' · ตัดข้อมูล HEX ตามขีดจำกัดการเก็บ' : ' · Stored HEX is truncated') : ''}</p>
  </div>;
}
function PacketInspector({ packet, retained, thai, rawOnly = false }) {
  const t = (en, th) => thai ? th : en;
  if (!packet) return <section className="gw-panel gw-inspector"><Empty title={t('Waiting for packets', 'รอแพ็กเก็ตจากอุปกรณ์')}>{t('Packets appear when an MDVR connects and sends Howen H-protocol data to this gateway.', 'แพ็กเก็ตจะแสดงเมื่อ MDVR เชื่อมต่อและส่งข้อมูล Howen H-protocol มายังเกตเวย์')}</Empty></section>;
  return <section className={`gw-panel ${rawOnly ? '' : 'gw-inspector'}`} aria-label={t('Packet inspector', 'รายละเอียดแพ็กเก็ต')}>
    <div className="gw-panel-title"><h2>{packet.summary || humanize(packet.kind) || packet.messageType}</h2>{packet.simulated && <SimulationBadge thai={thai} />}</div>
    {!retained && <div className="gw-notice gw-neutral-notice">{t('This selected packet is kept open for inspection. It has left the gateway’s current packet window.', 'คงแพ็กเก็ตที่เลือกไว้เพื่อตรวจสอบ แม้แพ็กเก็ตนี้จะพ้นช่วงข้อมูลล่าสุดของเกตเวย์แล้ว')}</div>}
    <Fields thai={thai} values={{ device: packet.deviceId || t('Not registered', 'ยังไม่ลงทะเบียน'), messageType: packet.messageType, direction: directionLabel(packet.direction), sourceEventTime: stamp(packet.occurredAt), gatewayReceivedAt: stamp(packet.receivedAt), packetId: packet.id }} />
    <p className="gw-small">{t('Source time is reported by the device; receipt time is recorded by the gateway. Zoned timestamps use Bangkok time; unzoned device times stay as reported.', 'เวลาต้นทางมาจากอุปกรณ์ ส่วนเวลาที่ได้รับบันทึกโดยเกตเวย์ เวลาที่ระบุเขตเวลาแสดงเป็นเวลากรุงเทพฯ เวลาที่ไม่ระบุเขตเวลาคงตามต้นฉบับ')}</p>
    <Warnings warnings={packet.warnings} thai={thai} />
    {packet.raw?.truncated && <div className="gw-notice gw-warning">{t('This packet’s raw payload exceeds the stored byte limit. HEX and downloads contain only retained bytes.', 'เนื้อหาแพ็กเก็ตเกินขีดจำกัดที่เก็บไว้ ข้อมูล HEX และไฟล์ดาวน์โหลดมีเฉพาะไบต์ที่เก็บไว้')}</div>}
    <details className="gw-detail" open><summary>{t('Captured packet bytes', 'ไบต์แพ็กเก็ตที่ได้รับ')}</summary><PacketBytes packet={packet} thai={thai} /></details>
    <GatewayPayload key={packet.id} value={packet} title={t('Packet, decoded fields and captured bytes', 'แพ็กเก็ต ฟิลด์ที่ถอดรหัส และไบต์ต้นฉบับ')} filename={`howen-packet-${packet.id}`} thai={thai} sourceLabel="Howen H-protocol" wirePacket />
  </section>;
}
function EventFeed({ packets, packet, retained, selectPacket, kind, setKind, thai }) {
  const t = (en, th) => thai ? th : en;
  const kinds = [...new Set(packets.map(item => item.kind).filter(Boolean))].sort();
  if (kind && !kinds.includes(kind)) kinds.push(kind);
  const filtered = kind ? packets.filter(item => item.kind === kind) : packets;
  return <div className="gw-event-layout">
    <section className="gw-panel gw-feed">
      <div className="gw-panel-title"><h2>{t('Packet events', 'เหตุการณ์แพ็กเก็ต')} <span className="gw-count">{filtered.length}</span></h2><label className="gw-filter"><span className="sr-only">{t('Filter event kind', 'กรองประเภทเหตุการณ์')}</span><select value={kind} onChange={event => setKind(event.target.value)}><option value="">{t('All event kinds', 'ทุกประเภท')}</option>{kinds.map(item => <option key={item} value={item}>{humanize(item)}</option>)}</select></label></div>
      {filtered.length > 0 ? <div className="gw-table-scroll"><table className="gw-table"><thead><tr><th>{t('Received', 'เวลาที่ได้รับ')}</th><th>{t('Direction', 'ทิศทาง')}</th><th>{t('Message', 'ข้อความ')}</th><th>{t('Device / event', 'อุปกรณ์ / เหตุการณ์')}</th></tr></thead><tbody>
        {filtered.map(item => <tr key={item.id} className={packet?.id === item.id ? 'gw-selected' : ''}>
          <td title={stamp(item.receivedAt)}>{stamp(item.receivedAt, true)}</td><td>{directionLabel(item.direction)}</td><td><code>{item.messageType || '—'}</code><small className="gw-event-kind">{humanize(item.kind)}</small></td>
          <td><button type="button" className="gw-event-button" aria-pressed={packet?.id === item.id} onClick={() => selectPacket(item)}><strong>{item.deviceId || t('Unregistered connection', 'การเชื่อมต่อที่ยังไม่ลงทะเบียน')}</strong><span>{item.summary || humanize(item.kind)}</span>{item.simulated && <SimulationBadge thai={thai} />}</button></td>
        </tr>)}
      </tbody></table></div> : <Empty title={t('No matching packets', 'ยังไม่มีแพ็กเก็ตที่ตรงกัน')}>{t('Waiting for device traffic. Change the device or event filter to inspect other retained packets.', 'กำลังรอข้อมูลอุปกรณ์ เปลี่ยนอุปกรณ์หรือตัวกรองเพื่อดูแพ็กเก็ตอื่นที่เก็บไว้')}</Empty>}
      <p className="gw-feed-foot">{t('Newest received first · bounded packet history · Bangkok time', 'เรียงตามเวลาที่ได้รับล่าสุด · ประวัติมีขีดจำกัด · เวลากรุงเทพฯ')}</p>
    </section>
    <PacketInspector packet={packet} retained={retained} thai={thai} />
  </div>;
}
function Signals({ device, thai }) {
  const t = (en, th) => thai ? th : en;
  const telemetry = device?.telemetry || {};
  const gps = telemetry.gps;
  const inputs = Array.isArray(telemetry.inputs) ? telemetry.inputs : [];
  const validFix = gps?.valid === true && Number.isFinite(gps.lat) && Number.isFinite(gps.lng);
  return <div className="gw-two-col">
    <section className="gw-panel"><div className="gw-panel-title"><h2>{t('GPS position', 'ตำแหน่ง GPS')}</h2>{validFix && <a className="gw-map-link" href={`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`} target="_blank" rel="noreferrer">{t('Open map ↗', 'เปิดแผนที่ ↗')}</a>}</div>
      <Fields thai={thai} values={{ fix: gps?.valid === true ? t('Valid', 'ใช้ได้') : gps?.valid === false ? t('Invalid', 'ใช้ไม่ได้') : null, latitude: gps?.lat, longitude: gps?.lng, speedKph: gps?.speedKph, capturedAt: stamp(gps?.capturedAt), gpsReceivedAt: stamp(device?.telemetryTimestamps?.gps?.receivedAt) }} />
      <p className="gw-small">{t('These are the last reported readings. A valid fix does not guarantee a recent capture; compare source and receipt times.', 'ข้อมูลนี้คือค่าที่รายงานล่าสุด พิกัดที่ใช้ได้อาจเป็นข้อมูลเก่า โปรดเทียบเวลาต้นทางและเวลาที่ได้รับ')}</p>
    </section>
    <section className="gw-panel"><div className="gw-panel-title"><h2>{t('Ignition / ACC', 'กุญแจ / ACC')}</h2></div><strong className="gw-signal-value">{telemetry.acc === true ? t('On', 'เปิด') : telemetry.acc === false ? t('Off', 'ปิด') : t('Unknown', 'ไม่ทราบ')}</strong><Fields thai={thai} values={{ accObservedAt: stamp(device?.telemetryTimestamps?.acc?.observedAt), accReceivedAt: stamp(device?.telemetryTimestamps?.acc?.receivedAt) }} /><p className="gw-small">{t('ACC is the reported ignition signal. Heartbeats do not refresh this reading or establish engine RPM or equipment operation.', 'ACC คือสัญญาณกุญแจที่รายงาน Heartbeat ไม่ได้อัปเดตค่านี้หรือยืนยันรอบเครื่องยนต์และการทำงานของอุปกรณ์')}</p></section>
    <section className="gw-panel gw-span"><div className="gw-panel-title"><h2>{t('Digital input states', 'สถานะดิจิทัลอินพุต')}</h2><span className="gw-count">{inputs.length} {t('reported', 'ช่องที่รายงาน')}</span></div>
      {inputs.length ? <div className="gw-input-grid">{inputs.map(input => <div className={`gw-input ${input.active === true ? 'gw-input-active' : ''}`} key={input.channel}><span>IO {input.channel}</span><strong>{input.active === true ? t('Active', 'ทำงาน') : input.active === false ? t('Inactive', 'ไม่ทำงาน') : t('Unknown', 'ไม่ทราบ')}</strong></div>)}</div> : <p className="gw-muted">{t('No input states received.', 'ยังไม่ได้รับสถานะอินพุต')}</p>}
      <p className="gw-small">{t('Channel numbers describe reported inputs. Equipment meaning requires verified wiring and configuration.', 'หมายเลขช่องคืออินพุตที่อุปกรณ์รายงาน ต้องยืนยันการเดินสายและค่าตั้งก่อนระบุว่าเป็นอุปกรณ์ใด')}</p>
      <Fields thai={thai} values={{ inputsObservedAt: stamp(device?.telemetryTimestamps?.inputs?.observedAt), inputsReceivedAt: stamp(device?.telemetryTimestamps?.inputs?.receivedAt) }} />
    </section>
    <section className="gw-panel gw-span"><GatewayPayload value={telemetry} title={t('Reported telemetry fields', 'ฟิลด์สถานะที่รายงาน')} filename={`howen-telemetry-${device?.deviceId || 'unknown'}`} thai={thai} sourceLabel="Howen H-protocol" /></section>
  </div>;
}
function Diagnostics({ device, snapshot, thai }) {
  const t = (en, th) => thai ? th : en;
  const gateway = snapshot?.gateway || {};
  return <div className="gw-two-col">
    <section className="gw-panel"><h2>{t('Device diagnostics', 'การวินิจฉัยอุปกรณ์')}</h2><Fields thai={thai} values={device?.diagnostics} /><Warnings warnings={device?.warnings} thai={thai} /><p className="gw-small">{t('Only received fields are shown. Missing modules and values remain unknown.', 'แสดงเฉพาะฟิลด์ที่ได้รับ โมดูลและค่าที่ไม่รายงานยังคงเป็นไม่ทราบ')}</p></section>
    <section className="gw-panel"><h2>{t('Gateway service', 'บริการเกตเวย์')}</h2><Fields thai={thai} values={{ status: gateway.status, startedAt: stamp(gateway.startedAt), connectedDevices: gateway.connectedDevices, receivedPackets: gateway.receivedPackets, sentPackets: gateway.sentPackets, decodeErrors: gateway.decodeErrors, snapshotGeneratedAt: stamp(snapshot?.generatedAt) }} /></section>
    <section className="gw-panel"><h2>{t('Device connection and observations', 'การเชื่อมต่อและข้อมูลจากอุปกรณ์')}</h2><Fields thai={thai} values={{ deviceId: device?.deviceId, connected: device?.connected, registeredAt: stamp(device?.registeredAt), lastPacketReceivedAt: stamp(device?.lastReceivedAt), telemetryObservedAt: stamp(device?.telemetryObservedAt), telemetryReceivedAt: stamp(device?.telemetryReceivedAt), disconnectedAt: stamp(device?.disconnectedAt), packetsReceived: device?.counters?.received, packetsSent: device?.counters?.sent, latestPacketId: device?.latestPacketId }} /></section>
    <section className="gw-panel"><h2>{t('Storage and retention', 'การจัดเก็บและขีดจำกัด')}</h2><Fields thai={thai} values={gateway.storage} /><Fields thai={thai} values={snapshot?.retention} /><p className="gw-small">{t('The current bounded window does not represent complete historical traffic.', 'ช่วงข้อมูลที่จำกัดนี้ไม่ใช่ข้อมูลย้อนหลังทั้งหมด')}</p></section>
  </div>;
}
function Parameters({ device, snapshot, thai }) {
  const t = (en, th) => thai ? th : en;
  return <div className="gw-two-col">
    <section className="gw-panel"><div className="gw-panel-title"><h2>{t('Device registration', 'ข้อมูลลงทะเบียนอุปกรณ์')}</h2><span className="gw-tag gw-neutral">{t('Reported', 'ค่าที่รายงาน')}</span></div><Fields thai={thai} values={device?.registration} /><p className="gw-small">{t('Registration comes from the device. Absent firmware, model or capability fields remain unknown.', 'อุปกรณ์เป็นผู้ส่งข้อมูลลงทะเบียน ฟิลด์เฟิร์มแวร์ รุ่น หรือความสามารถที่ไม่ส่งมายังคงเป็นไม่ทราบ')}</p></section>
    <section className="gw-panel"><h2>{t('Gateway subscription', 'การรับข้อมูลของเกตเวย์')}</h2><Fields thai={thai} values={snapshot?.gateway?.subscription} /><Fields thai={thai} values={{ tcpHost: snapshot?.gateway?.tcpHost, tcpPort: snapshot?.gateway?.tcpPort }} /><p className="gw-small">{t('Gateway connection and requested status/alarm subscriptions.', 'การเชื่อมต่อเกตเวย์และรายการข้อมูลสถานะหรือการเตือนที่ร้องขอ')}</p></section>
    <section className="gw-panel gw-span"><h2>{t('Device configuration', 'ค่าตั้งอุปกรณ์')}</h2><p className="gw-muted">{t('Not received. Registration and subscription settings do not establish the MDVR’s full configuration.', 'ยังไม่ได้รับข้อมูล ข้อมูลลงทะเบียนและการสมัครรับข้อมูลไม่ได้ระบุค่าตั้ง MDVR ทั้งหมด')}</p></section>
  </div>;
}

export default function GatewayDashboard({ lang }) {
  const thai = lang === 'th';
  const t = (en, th) => thai ? th : en;
  const [snapshot, setSnapshot] = useState(null);
  const [transport, setTransport] = useState('connecting');
  const [error, setError] = useState('');
  const [retryIn, setRetryIn] = useState(null);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [deviceId, setDeviceId] = useState(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('events');
  const [kind, setKind] = useState('');
  const [selectedPacket, setSelectedPacket] = useState(null);
  const tabRefs = useRef([]);

  useEffect(() => {
    const controller = new AbortController();
    let attempt = 0;
    function applySnapshot(value) {
      if (controller.signal.aborted) return;
      if (value?.source !== 'howen' || !Array.isArray(value.devices) || !Array.isArray(value.packets)) throw new Error('The gateway returned an unexpected snapshot.');
      setSnapshot(value); setError(''); setRetryIn(null);
      setDeviceId(previous => previous === null ? value.devices[0]?.deviceId ?? null : previous);
      if (value.configured === false) { setTransport('unconfigured'); controller.abort(); }
    }
    async function connect() {
      setTransport('connecting'); setError(''); setRetryIn(null);
      try {
        applySnapshot(await adminFetch('/api/admin/gateway/snapshot', { signal: controller.signal, cacheOffline: false, cache: 'no-store' }));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause.message || 'Could not read the gateway snapshot.');
        if (!getAdminSessionToken()) { setTransport('expired'); return; }
      }
      while (!controller.signal.aborted) {
        try {
          await consumeSnapshotStream({
            url: `${apiBase}/api/admin/gateway/events`, token: getAdminSessionToken(), signal: controller.signal,
            onSnapshot(value) { applySnapshot(value); if (!controller.signal.aborted) { attempt = 0; setTransport('live'); } },
          });
          if (controller.signal.aborted) return;
          setError('The live connection closed. Reconnecting to the gateway.');
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (cause.code === 401) {
            clearAdminSessionToken(); setTransport('expired'); setError(cause.message);
            window.dispatchEvent(new Event('songdee-auth-expired'));
            return;
          }
          setError(cause.message || 'The gateway connection was interrupted.');
        }
        const delay = reconnectDelay(attempt++);
        setTransport('reconnecting'); setRetryIn(delay / 1000);
        try { await waitForReconnect(delay, controller.signal); } catch { return; }
      }
    }
    void connect();
    return () => controller.abort();
  }, [connectionVersion]);

  const devices = snapshot?.devices || emptyList;
  const allPackets = snapshot?.packets || emptyList;
  const selectedId = deviceId === null ? devices[0]?.deviceId || '' : deviceId;
  const device = devices.find(item => item.deviceId === selectedId) || null;
  const packets = useMemo(() => selectedId ? allPackets.filter(item => item.deviceId === selectedId) : allPackets, [allPackets, selectedId]);
  useEffect(() => {
    const filtered = kind ? packets.filter(item => item.kind === kind) : packets;
    setSelectedPacket(previous => {
      if (previous && (!selectedId || previous.deviceId === selectedId) && (!kind || previous.kind === kind)) return filtered.find(item => item.id === previous.id) || previous;
      return filtered[0] || null;
    });
  }, [packets, selectedId, kind]);
  const search = query.trim().toLocaleLowerCase();
  const matchingDevices = devices.filter(item => !search || `${item.deviceId} ${item.registration?.dn || ''} ${item.registration?.model || ''}`.toLocaleLowerCase().includes(search));
  const selectedOutsideSearch = selectedId && !matchingDevices.some(item => item.deviceId === selectedId);
  const gps = device?.telemetry?.gps;
  const validFix = gps?.valid === true && Number.isFinite(gps.lat) && Number.isFinite(gps.lng);
  const inputs = Array.isArray(device?.telemetry?.inputs) ? device.telemetry.inputs : [];
  const retained = !selectedPacket || allPackets.some(item => item.id === selectedPacket.id);
  const hasSimulation = devices.some(item => item.simulated) || allPackets.some(item => item.simulated);
  const gateway = snapshot?.gateway || {};
  const transportLabels = { connecting: t('Connecting', 'กำลังเชื่อมต่อ'), live: t('Live', 'เชื่อมต่อสด'), reconnecting: t('Reconnecting', 'กำลังเชื่อมต่อใหม่'), unconfigured: t('Not configured', 'ยังไม่ได้ตั้งค่า'), expired: t('Session expired', 'เซสชันหมดอายุ') };
  function selectDevice(value) { setDeviceId(value); setSelectedPacket(null); setKind(''); }
  function inspectSimulationPacket(id) {
    const packet = allPackets.find(item => item.id === id);
    if (!packet) return;
    setDeviceId(packet.deviceId || ''); setKind(''); setSelectedPacket(packet); setTab('payload');
  }
  function tabKey(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); setTab(tabs[next][0]); tabRefs.current[next]?.focus(); }
  }
  return <main id="main-content" className="gw-page gw-howen" tabIndex={-1}>
    <header className="gw-heading"><div><div className="gw-title-line"><h1>{t('Howen gateway', 'เกตเวย์ Howen')}</h1><span className={`gw-transport gw-transport-${transport}`} role="status"><i className="gw-dot" />{transportLabels[transport]}</span></div><p>{t('Direct MDVR traffic, device signals and captured protocol packets.', 'ข้อมูล MDVR โดยตรง สัญญาณอุปกรณ์ และแพ็กเก็ตโปรโตคอลที่ได้รับ')}</p></div><div className="gw-actions"><button type="button" className="gw-button gw-primary" onClick={() => setConnectionVersion(value => value + 1)}>{t('↻ Reconnect', '↻ เชื่อมต่อใหม่')}</button></div></header>
    {error && <div className="gw-notice gw-error" role="alert"><strong>{t('Live connection unavailable', 'การเชื่อมต่อสดไม่พร้อม')}</strong><span>{error} {retryIn != null && t(`Retry delay: ${retryIn}s.`, `รอเชื่อมต่อใหม่ ${retryIn} วินาที`)} {snapshot && t('Displayed values are from the last received snapshot.', 'ค่าที่แสดงมาจากข้อมูลล่าสุดที่เคยได้รับ')}</span></div>}
    {!snapshot && !error && <section className="gw-panel"><Empty title={t('Connecting to the gateway…', 'กำลังเชื่อมต่อเกตเวย์…')}>{t('Waiting for the authenticated gateway snapshot.', 'รอข้อมูลเกตเวย์ผ่านการเชื่อมต่อที่ยืนยันตัวตนแล้ว')}</Empty></section>}
    {snapshot?.configured === false && <section className="gw-panel gw-unconfigured"><Empty title={t('Gateway connection is not configured', 'ยังไม่ได้ตั้งค่าการเชื่อมต่อเกตเวย์')}>{t('Configure the server’s direct Howen gateway connection, then reconnect here. Device data will appear after an MDVR registers.', 'ตั้งค่าการเชื่อมต่อเกตเวย์ Howen โดยตรงบนเซิร์ฟเวอร์ แล้วเชื่อมต่อใหม่ ข้อมูลจะแสดงหลัง MDVR ลงทะเบียน')}</Empty></section>}
    {hasSimulation && <div className="gw-notice gw-warning"><SimulationBadge thai={thai} /><span>{t('This window includes simulated traffic. Marked devices and packets are test data.', 'ช่วงข้อมูลนี้มีข้อมูลจำลอง อุปกรณ์และแพ็กเก็ตที่มีป้ายกำกับเป็นข้อมูลทดสอบ')}</span></div>}
    {snapshot && <>
      <section className="gw-panel gw-service-overview" aria-label={t('Gateway overview', 'ภาพรวมเกตเวย์')}><div className="gw-metrics">
        <div><span>{t('Gateway listener', 'ตัวรับข้อมูลเกตเวย์')}</span><strong>{gateway.status ? humanize(gateway.status) : t('Unknown', 'ไม่ทราบ')}</strong><small>{gateway.tcpPort ? `TCP ${gateway.tcpHost || '—'}:${gateway.tcpPort}` : t('Endpoint not reported', 'ไม่ได้รายงานปลายทาง')}</small></div>
        <div><span>{t('Connected MDVRs', 'MDVR ที่เชื่อมต่อ')}</span><strong>{knownNumber(gateway.connectedDevices)}</strong><small>{devices.length} {t('devices retained', 'อุปกรณ์ที่เก็บไว้')}</small></div>
        <div><span>{t('Packets received / sent', 'แพ็กเก็ตที่รับ / ส่ง')}</span><strong>{knownNumber(gateway.receivedPackets)} / {knownNumber(gateway.sentPackets)}</strong></div>
        <div><span>{t('Decode errors', 'ข้อผิดพลาดการถอดรหัส')}</span><strong>{knownNumber(gateway.decodeErrors)}</strong><small>{t('Snapshot', 'ข้อมูล ณ')} {stamp(snapshot.generatedAt, true)}</small></div>
      </div></section>
      {tab !== 'simulation' && <section className="gw-panel gw-overview" aria-label={t('Device overview', 'ภาพรวมอุปกรณ์')}>
        <div className="gw-device-row"><div className="gw-device-picker"><label>{t('Search devices', 'ค้นหาอุปกรณ์')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Device ID or name', 'รหัสหรือชื่ออุปกรณ์')} /></label><label>{t('Device', 'อุปกรณ์')}<select value={selectedId} onChange={event => selectDevice(event.target.value)}><option value="">{t('All devices / unregistered traffic', 'ทุกอุปกรณ์ / ข้อมูลที่ยังไม่ลงทะเบียน')}</option>{selectedOutsideSearch && <option value={selectedId}>{selectedId} · {t('selected', 'ที่เลือก')}</option>}{matchingDevices.map(item => <option key={item.deviceId} value={item.deviceId}>{item.simulated ? '[SIMULATION] ' : ''}{item.deviceId}{item.registration?.dn && item.registration.dn !== item.deviceId ? ` · ${item.registration.dn}` : ''}</option>)}</select></label>{search && <span className="gw-small" role="status">{matchingDevices.length} {t('matching devices', 'อุปกรณ์ที่ตรงกัน')}</span>}</div>
          <div><span className="gw-label">{t('MDVR TCP connection', 'การเชื่อมต่อ TCP ของ MDVR')}</span><strong className="gw-status"><i className={`gw-dot ${device?.connected && transport === 'live' ? 'gw-dot-connected' : ''}`} />{device?.connected === true ? transport === 'live' ? t('Online', 'ออนไลน์') : t('Last reported online', 'ออนไลน์เมื่อรายงานล่าสุด') : device?.connected === false ? t('Offline', 'ออฟไลน์') : t('Select a device', 'เลือกอุปกรณ์')}</strong>{device?.simulated && <SimulationBadge thai={thai} />}</div>
          <div><span className="gw-label">{t('Last gateway receipt', 'เกตเวย์รับข้อมูลล่าสุด')}</span><strong>{stamp(device?.lastReceivedAt)}</strong><small className="gw-small">{t('Telemetry source', 'เวลาสถานะต้นทาง')}: {stamp(device?.telemetryObservedAt)}<br />{t('Telemetry receipt', 'เวลาที่ได้รับสถานะ')}: {stamp(device?.telemetryReceivedAt)}</small></div>
        </div>
        <div className="gw-metrics"><div><span>{t('GPS fix', 'พิกัด GPS')}</span><strong>{validFix ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : t('Unknown / invalid', 'ไม่ทราบ / ใช้ไม่ได้')}</strong><small>{t('Captured', 'วัดเมื่อ')}: {stamp(gps?.capturedAt, true)}</small></div><div><span>{t('Speed', 'ความเร็ว')}</span><strong>{validFix && Number.isFinite(gps.speedKph) ? `${gps.speedKph} km/h` : '—'}</strong></div><div><span>{t('Ignition / ACC', 'กุญแจ / ACC')}</span><strong>{device?.telemetry?.acc === true ? t('On', 'เปิด') : device?.telemetry?.acc === false ? t('Off', 'ปิด') : t('Unknown', 'ไม่ทราบ')}</strong></div><div><span>{t('Digital inputs', 'ดิจิทัลอินพุต')}</span><strong>{inputs.length ? `${inputs.filter(item => item.active === true).length} ${t('active', 'ทำงาน')} / ${inputs.length}` : t('Unknown', 'ไม่ทราบ')}</strong></div></div>
      </section>}
      {!devices.length && snapshot.configured !== false && <div className="gw-notice gw-neutral-notice">{t('Waiting for an MDVR to register. Unregistered traffic remains visible under All devices.', 'กำลังรอ MDVR ลงทะเบียน ดูข้อมูลที่ยังไม่ลงทะเบียนได้ที่ทุกอุปกรณ์')}</div>}
      <div className="gw-tabs" role="tablist" aria-label={t('Howen gateway views', 'มุมมองเกตเวย์ Howen')}>{tabs.map(([key, en, th], index) => <button type="button" role="tab" id={`gw-tab-${key}`} aria-controls={`gw-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} ref={node => { tabRefs.current[index] = node; }} key={key} onClick={() => setTab(key)} onKeyDown={event => tabKey(event, index)}>{t(en, th)}</button>)}</div>
      <div role="tabpanel" id={`gw-panel-${tab}`} aria-labelledby={`gw-tab-${tab}`} tabIndex={0} className="gw-tab-panel">
        {tab === 'events' && <EventFeed packets={packets} packet={selectedPacket} retained={retained} selectPacket={setSelectedPacket} kind={kind} setKind={setKind} thai={thai} />}
        {['signals', 'parameters'].includes(tab) && !device && <section className="gw-panel"><Empty title={t('Select a device', 'เลือกอุปกรณ์')}>{t('Choose a registered MDVR to inspect its reported signals and parameters.', 'เลือก MDVR ที่ลงทะเบียนเพื่อดูสัญญาณและพารามิเตอร์ที่รายงาน')}</Empty></section>}
        {tab === 'signals' && device && <Signals device={device} thai={thai} />}
        {tab === 'diagnostics' && <Diagnostics device={device} snapshot={snapshot} thai={thai} />}
        {tab === 'parameters' && device && <Parameters device={device} snapshot={snapshot} thai={thai} />}
        {tab === 'payload' && <PacketInspector packet={selectedPacket} retained={retained} thai={thai} rawOnly />}
        {tab === 'simulation' && <GatewaySimulation simulation={snapshot.simulation} packets={allPackets} onSnapshot={setSnapshot} onInspectPacket={inspectSimulationPacket} thai={thai} />}
      </div>
      <footer className="gw-footnote">{t('Live server stream', 'สตรีมสดจากเซิร์ฟเวอร์')} · {t('Showing', 'แสดง')} {knownNumber(snapshot.retention?.returnedPackets ?? allPackets.length)} / {knownNumber(snapshot.retention?.retainedPackets ?? allPackets.length)} {t('retained packets', 'แพ็กเก็ตที่เก็บไว้')}{snapshot.retention?.maxPackets != null ? ` · ${t('Retention limit', 'ขีดจำกัด')}: ${knownNumber(snapshot.retention.maxPackets)}` : ''}{snapshot.retention?.truncated ? ` · ${t('Window limited', 'จำกัดช่วงข้อมูล')}` : ''}. {t('Missing values remain unknown. Browser connection and MDVR connectivity are separate.', 'ค่าที่ไม่ส่งมายังคงเป็นไม่ทราบ การเชื่อมต่อของหน้าจอแยกจากการเชื่อมต่อ MDVR')}</footer>
    </>}
  </main>;
}

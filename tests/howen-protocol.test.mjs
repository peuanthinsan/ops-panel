import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameDecoder, decodePacket, encodeFrame } from '../gateway/protocol.mjs';

// Independent wire fixtures: bytes below are not produced by the codec under test.
const HEARTBEAT = Buffer.from('4801010000000000', 'hex'); // PDF p.11
const SIMPLE_STATUS = Buffer.from(
  '03696f00' + // session length, "io", NUL
  '1a09110e0a05' + '0501' + // 2026-09-17 14:10:05, GPS/basic/alarms
  '1701' + '1a09110e0a04' + '2d0a' + 'd204' + '7b00' + '0800' +
  '64e0930400' + '0df0490200' + // W100°30', S13°15'
  '01000000' + // ACC on
  '08000000' + '0180', // input bitmap exists; IO1 + IO16 active
  'hex',
);

// Exact hex example from PDF pp.46-47 (message 0x1051, 188 byte payload).
const DOCUMENT_ALARM = Buffer.from(
  '48015110bc00000020616c61726d2d32383038313130322d3030303030314539364244464230313000640000007b22646574223a7b22' +
  '6368223a2231227d2c22647475223a22323031382d30392d31342031343a33313a3037222c226563223a2232222c226574223a22222c2' +
  '27061223a22222c227374223a22323031382d30392d31342031343a33313a3037227d0a0012090e0e1f072d00000112090e0e1f07000b0' +
  '0008214080071588f0800165a280500810000001f00000103010f000000000000', 'hex',
);

function packet(type, payload) { return decodePacket({ type, payload }); }
function status(mask, data = '', date = '1a09110e0a05') {
  const maskBytes = Buffer.alloc(2);
  maskBytes.writeUInt16LE(mask);
  return packet(0x1041, Buffer.concat([Buffer.from(`0100${date}`, 'hex'), maskBytes, Buffer.from(data, 'hex')]));
}

test('encodes the documented empty heartbeat and little-endian JSON frames with one terminator', () => {
  assert.deepEqual(encodeFrame(1), HEARTBEAT);
  const json = encodeFrame(0x4001, { ss: 's', err: '0' });
  assert.equal(json.subarray(0, 4).toString('hex'), '48010140');
  assert.equal(json.readUInt32LE(4), Buffer.byteLength('{"ss":"s","err":"0"}\0'));
  assert.equal(json.subarray(8).toString(), '{"ss":"s","err":"0"}\0');
  assert.equal(encodeFrame(0x4001, 'abc\0').subarray(8).toString(), 'abc\0');
  assert.deepEqual(encodeFrame(0x1041, SIMPLE_STATUS).subarray(8), SIMPLE_STATUS);
  assert.throws(() => encodeFrame(-1), /message type/);
  assert.throws(() => encodeFrame(65536), /message type/);
});

test('decodes every possible two-chunk split and one-byte chunks without dropping frames', () => {
  const source = Buffer.concat([HEARTBEAT, encodeFrame(0x1041, SIMPLE_STATUS), HEARTBEAT]);
  for (let split = 0; split <= source.length; split++) {
    const decoder = createFrameDecoder();
    const frames = [...decoder.push(source.subarray(0, split)), ...decoder.push(source.subarray(split))];
    assert.deepEqual(frames.map((frame) => frame.type), [1, 0x1041, 1]);
    assert.deepEqual(Buffer.concat(frames.map((frame) => frame.frame)), source);
    assert.equal(decoder.bufferedBytes, 0);
  }
  const decoder = createFrameDecoder();
  const frames = [...source].flatMap((value) => decoder.push(Uint8Array.of(value)));
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[1].payload, SIMPLE_STATUS);
});

test('retains only a bounded incomplete frame and rejects malicious length before allocating it', () => {
  const decoder = createFrameDecoder({ maxPayloadBytes: 64 });
  assert.deepEqual(decoder.push(Buffer.from('480141103f00000001', 'hex')), []);
  assert.equal(decoder.bufferedBytes, 9);
  const bad = createFrameDecoder({ maxPayloadBytes: 64 });
  assert.throws(() => bad.push(Buffer.from('48014110ffffffff', 'hex')), /exceeds 64/);
  assert.equal(bad.bufferedBytes, 0);
  assert.throws(() => bad.push(HEARTBEAT), /closed/);
  assert.equal(createFrameDecoder({ maxPayloadBytes: 0 }).push(HEARTBEAT).length, 1);
  assert.throws(() => createFrameDecoder({ maxPayloadBytes: -1 }), /maximum/);
});

test('rejects invalid magic/version instead of silently searching through corrupt bytes', () => {
  for (const hex of ['4901010000000000', '4802010000000000']) {
    assert.throws(() => createFrameDecoder().push(Buffer.from(hex, 'hex')), /header or version/);
  }
  assert.throws(() => decodePacket(Buffer.from('4801010001000000', 'hex')), /complete/);
});

test('registration preserves vendor fields and uses its explicit time zone', () => {
  const result = packet(0x1001, Buffer.from('{"dn":"00123","ss":"session","dtu":"2026-09-17 00:05:00","gmt":"+08:00","fw":"ME31-08N2"}\n\0'));
  assert.equal(result.kind, 'registration');
  assert.equal(result.decoded.deviceId, '00123');
  assert.equal(result.decoded.sessionId, 'session');
  assert.equal(result.decoded.fw, 'ME31-08N2');
  assert.equal(result.occurredAt, '2026-09-16T16:05:00.000Z');
  assert.equal(result.decoded.timeZoneOffsetMinutes, 480);
  assert.deepEqual(result.warnings, []);
  const badZone = decodePacket(encodeFrame(0x1001, { dn: '1', ss: 's', dtu: '2026-09-17 07:05:00', gmt: '+14:30' }));
  assert.equal(badZone.occurredAt, '2026-09-17T00:05:00.000Z');
  assert.match(badZone.warnings.join(), /time zone/);
});

test('invalid calendar dates are unavailable, including invalid non-leap February', () => {
  const invalid = status(0, '', '19021d000000');
  assert.equal(invalid.decoded.deviceTime, null);
  assert.match(invalid.warnings.join(), /Invalid device time/);
  assert.equal(status(0, '', '18021d000000').decoded.deviceTime, '2024-02-28T17:00:00.000Z');
  const badTime = status(0, '', '1a0911180000');
  assert.equal(badTime.occurredAt, null);
});

test('independent signed GPS fixture decodes speed, heading, time, ACC and all 16 IO channels', () => {
  const result = packet(0x1041, SIMPLE_STATUS);
  assert.equal(result.messageType, '0x1041');
  assert.equal(result.kind, 'status');
  assert.equal(result.decoded.sessionId, 'io');
  assert.equal(result.decoded.deviceTime, '2026-09-17T07:10:05.000Z');
  assert.equal(result.decoded.gps.capturedAt, '2026-09-17T07:10:04.000Z');
  assert.equal(result.decoded.gps.lat, -13.25);
  assert.equal(result.decoded.gps.lng, -100.5);
  assert.equal(result.decoded.gps.speedKph, 12.34);
  assert.equal(result.decoded.gps.headingDegrees, 225);
  assert.equal(result.decoded.gps.hdop, 0.8);
  assert.equal(result.decoded.gps.valid, true);
  assert.equal(result.decoded.gps.altitudeRaw, 123);
  assert.equal(result.decoded.gps.altitudeMeters, null);
  assert.match(result.warnings.join(), /Altitude units conflict/);
  assert.equal(result.decoded.acc, true);
  assert.deepEqual(result.decoded.inputs.filter((input) => input.active).map((input) => input.channel), [1, 16]);
  assert.equal(result.decoded.inputs.length, 16);
  assert.equal(result.decoded.complete, true);
});

test('signed latitude degree encoding works without applying the south sign twice', () => {
  const bytes = Buffer.from(SIMPLE_STATUS);
  bytes[12] = 0x02; // GPS info: west only
  bytes[33] = 0xf3; // latitude degrees -13
  const result = packet(0x1041, bytes);
  assert.equal(result.decoded.gps.lat, -13.25);
  assert.equal(result.decoded.gps.valid, true);
});

test('invalid location and coordinate range remain diagnostic data, not valid GPS', () => {
  const noFix = Buffer.from(SIMPLE_STATUS);
  noFix[13] = 0;
  assert.equal(packet(0x1041, noFix).decoded.gps.valid, false);
  const badCoordinate = Buffer.from(SIMPLE_STATUS);
  badCoordinate.writeUInt32LE(600000, 29); // longitude minutes cannot reach 60
  const result = packet(0x1041, badCoordinate);
  assert.equal(result.decoded.gps.valid, false);
  assert.equal(result.decoded.gps.lat, null);
  assert.equal(result.decoded.gps.lng, null);
  assert.match(result.warnings.join(), /coordinates/);
});

test('missing signals remain null while explicit off and zero remain false and zero', () => {
  const absent = status(0);
  assert.equal(absent.decoded.gps, null);
  assert.equal(absent.decoded.acc, null);
  assert.equal(absent.decoded.inputs, null);
  const explicit = status(0x104, '00000000080000000000');
  assert.equal(explicit.decoded.acc, false);
  assert.equal(explicit.decoded.inputs.every((input) => input.active === false), true);
  const notReported = status(0x100, '00000000');
  assert.equal(notReported.decoded.inputs, null);
  assert.equal(notReported.decoded.diagnostics.alarms.emergency, false);
});

test('optional G-sensor fields do not consume absent values or shift the next group', () => {
  const result = status(0x06, '02daff01000000'); // tilt only -0.38g, then ACC on
  assert.deepEqual(result.decoded.diagnostics.gsensor, { flags: 2, xG: null, yG: null, zG: null, tiltG: -0.38, impactG: null });
  assert.equal(result.decoded.acc, true);
  assert.equal(result.decoded.complete, true);
  const xyz = status(2, '01daff640038ff').decoded.diagnostics.gsensor;
  assert.deepEqual([xyz.xG, xyz.yG, xyz.zG], [-0.38, 1, -2]);
});

test('decodes module states, fuel optional flags, mobile strength and optional Wi-Fi fields', () => {
  const module = status(8, '1200010580').decoded.diagnostics.modules;
  assert.equal(module.mobile, null);
  assert.deepEqual(module.positioning, { code: 1, state: 'normal' });
  assert.equal(module.recording.channels[15].recording, true);
  const fuel = status(0x10, '0300002c01').decoded.diagnostics.fuel;
  assert.equal(fuel.consumption, 0);
  assert.equal(fuel.balanceRaw, 300);
  assert.equal(fuel.units, null);
  const mobile = status(0x20, '0000040000').decoded.diagnostics.mobile;
  assert.equal(mobile.signalStrength, null);
  assert.equal(mobile.networkType, 4);
  const wifi = status(0x40, '1f0ac0a80002c0a80001ffffff000478797a00').decoded.diagnostics.wifi;
  assert.equal(wifi.signalStrength, 10);
  assert.equal(wifi.address, '192.168.0.2');
  assert.equal(wifi.gateway, '192.168.0.1');
  assert.equal(wifi.subnetMask, '255.255.255.0');
  assert.equal(wifi.ssid, 'xyz');
});

test('disk group mask handles sparse groups and preserves zero remaining capacity', () => {
  const result = status(0x80, '810b0180ee3600000000000f0240420f0040e20100');
  assert.equal(result.decoded.complete, true);
  assert.deepEqual(result.decoded.diagnostics.storage.disks, [
    { group: 1, id: 11, name: 'hdd1', code: 1, state: 'recording', sizeMB: 3600000, freeMB: 0 },
    { group: 8, id: 15, name: 'sd1', code: 2, state: 'idle', sizeMB: 1000000, freeMB: 123456 },
  ]);
});

test('first nine status groups can all be present, without confusing optional lengths', () => {
  const gps = SIMPLE_STATUS.subarray(12, 38);
  const data = Buffer.concat([
    gps, Buffer.from('00', 'hex'), // G-sensor with no values
    Buffer.from('00000000', 'hex'), // basic
    Buffer.from('0000', 'hex'), // module optional fields absent
    Buffer.from('00', 'hex'), // fuel optional fields absent
    Buffer.from('0000000000', 'hex'), // mobile fixed fields
    Buffer.from('00', 'hex'), // Wi-Fi absent optional fields
    Buffer.from('00', 'hex'), // no disks
    Buffer.from('480000000200', 'hex'), // emergency flag + IO2 active
  ]);
  const result = status(0x1ff, data.toString('hex'));
  assert.equal(result.decoded.complete, true);
  assert.equal(result.decoded.acc, false);
  assert.equal(result.decoded.inputs[1].active, true);
  assert.equal(result.decoded.diagnostics.alarms.emergency, true);
  assert.equal(result.decoded.unparsedBytes, 0);
});

test('unknown group/optional mask stops decoding rather than misreading later fields', () => {
  const unsupported = status(0x1804, '01000000aabbccdd');
  assert.equal(unsupported.decoded.acc, true);
  assert.equal(unsupported.decoded.complete, false);
  assert.equal(unsupported.decoded.unparsedBytes, 4);
  assert.match(unsupported.warnings.join(), /Unsupported status group 11/);
  const flags = status(0x06, '8001000000');
  assert.equal(flags.decoded.acc, null);
  assert.match(flags.warnings.join(), /Unsupported G-sensor flags/);
  const extension = status(4, '010000000100aabb');
  assert.equal(extension.decoded.acc, true);
  assert.equal(extension.decoded.extendedContentMask, 1);
  assert.equal(extension.decoded.unparsedBytes, 2);
  assert.match(extension.warnings.join(), /Unsupported extended/);
});

test('truncated status yields warnings and never turns missing bytes into false signals', () => {
  const result = status(4, '01');
  assert.equal(result.decoded.acc, null);
  assert.equal(result.decoded.complete, false);
  assert.match(result.warnings.join(), /Truncated basic status flags 2/);
  assert.match(packet(0x1041, Buffer.from('050061', 'hex')).warnings.join(), /Truncated session/);
  assert.match(packet(0x1041, Buffer.from('00', 'hex')).warnings.join(), /Invalid session length/);
  assert.match(packet(0x1041, Buffer.from('026162', 'hex')).warnings.join(), /NUL terminator/);
});

test('decodes the published alarm wire example, including nested status and original alarm details', () => {
  assert.equal(DOCUMENT_ALARM.length, 196);
  const result = decodePacket(DOCUMENT_ALARM);
  assert.equal(result.kind, 'alarm');
  assert.equal(result.decoded.sessionId, 'alarm-28081102-000001E96BDFB010');
  assert.equal(result.decoded.alarmState, 'start');
  assert.equal(result.decoded.alarm.ec, '2');
  assert.deepEqual(result.decoded.alarm.det, { ch: '1' });
  assert.equal(result.occurredAt, '2018-09-14T07:31:07.000Z');
  assert.equal(result.decoded.status.acc, true);
  assert.equal(result.decoded.status.complete, true);
  assert.equal(result.decoded.status.gps.speedKph, 0);
  assert.ok(Math.abs(result.decoded.status.gps.lng - 113.93497333333333) < 1e-9);
  assert.equal(result.decoded.status.diagnostics.modules.wifi.state, 'absent');
});

test('alarm end is distinct from start, can have no status, and acknowledges remain empty', () => {
  const json = Buffer.from('{"ec":"4","st":"2026-09-17 14:00:00","et":"2026-09-17 14:02:00","dtu":"2026-09-17 14:05:00","det":{"ch":"1","num":"22"}}\0');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(json.length);
  const result = packet(0x1051, Buffer.concat([Buffer.from('0100', 'hex'), size, json]));
  assert.equal(result.decoded.alarmState, 'end');
  assert.equal(result.decoded.status, null);
  assert.equal(result.decoded.startedAt, '2026-09-17T07:00:00.000Z');
  assert.equal(result.occurredAt, '2026-09-17T07:02:00.000Z');
  assert.equal(encodeFrame(0x4051).toString('hex'), '4801514000000000');
  assert.equal(encodeFrame(0x4041).toString('hex'), '4801414000000000');
});

test('malformed alarm JSON lengths and terminators cannot shift status parsing', () => {
  assert.match(packet(0x1051, Buffer.from('0100ffffffff7b7d00', 'hex')).warnings.join(), /Truncated alarm JSON/);
  assert.match(packet(0x1051, Buffer.from('0100020000007b7d', 'hex')).warnings.join(), /NUL terminator/);
  assert.match(packet(0x1051, Buffer.from('010000000000', 'hex')).warnings.join(), /Invalid alarm JSON length/);
  assert.match(packet(0x1051, Buffer.from('0100030000007b7b00', 'hex')).warnings.join(), /Invalid alarm JSON/);
});

test('malformed JSON is reported and unknown messages are safely preserved as metadata', () => {
  const malformed = packet(0x1001, Buffer.from('{oops}\0'));
  assert.equal(malformed.kind, 'registration');
  assert.match(malformed.warnings.join(), /Invalid registration JSON/);
  const unknown = packet(0x1abc, Buffer.from([0xff, 0, 0x80]));
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.messageType, '0x1abc');
  assert.deepEqual(unknown.decoded, { payloadBytes: 3 });
  const ack = decodePacket(encodeFrame(0x1040, { ss: 'status-1', err: '0' }));
  assert.equal(ack.kind, 'status-subscription-ack');
  assert.equal(ack.decoded.err, '0');
  assert.equal(ack.decoded.sessionId, 'status-1');
});

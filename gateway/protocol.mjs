// Howen H-Protocol v4.0.0, signal link (PDF sections 1.5 and 2.3/2.7/2.8).
// This codec is intentionally independent of networking, storage, and job rules.
const HEADER_BYTES = 8;
const DEFAULT_MAX_PAYLOAD = 1024 * 1024;
const JSON_TYPES = new Map([
  [0x1001, 'registration'], [0x4001, 'registration-ack'],
  [0x4040, 'status-subscription'], [0x1040, 'status-subscription-ack'],
  [0x4050, 'alarm-subscription'], [0x1050, 'alarm-subscription-ack'],
]);

export function encodeFrame(type, payload = null) {
  if (!Number.isInteger(type) || type < 0 || type > 0xffff) throw new RangeError('Invalid H-protocol message type');
  let body;
  if (payload == null) body = Buffer.alloc(0);
  else if (Buffer.isBuffer(payload)) body = payload;
  else {
    const value = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (typeof value !== 'string') throw new TypeError('H-protocol payload must be binary, a string, or JSON');
    body = Buffer.from(value.endsWith('\0') ? value : `${value}\0`, 'utf8');
  }
  if (body.length > 0xffffffff) throw new RangeError('H-protocol payload is too large');
  const frame = Buffer.allocUnsafe(HEADER_BYTES + body.length);
  frame[0] = 0x48;
  frame[1] = 1;
  frame.writeUInt16LE(type, 2);
  frame.writeUInt32LE(body.length, 4);
  body.copy(frame, HEADER_BYTES);
  return frame;
}

export function createFrameDecoder({ maxPayloadBytes = DEFAULT_MAX_PAYLOAD } = {}) {
  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 0 || maxPayloadBytes > 0xffffffff - HEADER_BYTES) {
    throw new RangeError('Invalid maximum H-protocol payload size');
  }
  let buffer = Buffer.allocUnsafe(HEADER_BYTES);
  let used = 0;
  let readingBody = false;
  let failed = false;
  return {
    get bufferedBytes() { return used; },
    push(chunk) {
      if (failed) throw new Error('H-protocol decoder is closed after a framing error');
      if (!(chunk instanceof Uint8Array)) throw new TypeError('H-protocol chunks must be bytes');
      const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const packets = [];
      let offset = 0;
      try {
        while (offset < input.length) {
          const count = Math.min(buffer.length - used, input.length - offset);
          input.copy(buffer, used, offset, offset + count);
          offset += count;
          used += count;
          if (used !== buffer.length) continue;
          if (!readingBody) {
            if (buffer[0] !== 0x48 || buffer[1] !== 1) throw new Error('Invalid H-protocol header or version');
            const length = buffer.readUInt32LE(4);
            if (length > maxPayloadBytes) throw new RangeError(`H-protocol payload exceeds ${maxPayloadBytes} bytes`);
            if (length) {
              const next = Buffer.allocUnsafe(HEADER_BYTES + length);
              buffer.copy(next);
              buffer = next;
              readingBody = true;
              continue;
            }
          }
          packets.push({ type: buffer.readUInt16LE(2), payload: buffer.subarray(HEADER_BYTES), frame: buffer });
          buffer = Buffer.allocUnsafe(HEADER_BYTES);
          used = 0;
          readingBody = false;
        }
      } catch (error) {
        failed = true;
        used = 0;
        buffer = Buffer.alloc(0);
        throw error;
      }
      return packets;
    },
  };
}

class StatusParseError extends Error {}

class Cursor {
  constructor(buffer) { this.buffer = buffer; this.offset = 0; }
  get remaining() { return this.buffer.length - this.offset; }
  take(length, label) {
    if (length > this.remaining) throw new StatusParseError(`Truncated ${label} at byte ${this.offset}: need ${length}, have ${this.remaining}`);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8(label) { return this.take(1, label)[0]; }
  u16(label) { return this.take(2, label).readUInt16LE(); }
  i16(label) { return this.take(2, label).readInt16LE(); }
  u32(label) { return this.take(4, label).readUInt32LE(); }
}

function isoTime(parts, offsetMinutes, warnings, label) {
  const [year, month, day, hour, minute, second] = parts;
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60
    || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59
    || local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) {
    warnings.push(`Invalid ${label}; timestamp is unavailable`);
    return null;
  }
  return new Date(local.getTime() - offsetMinutes * 60_000).toISOString();
}

function binaryTime(bytes, offsetMinutes, warnings, label) {
  return isoTime([2000 + bytes[0], ...bytes.subarray(1)], offsetMinutes, warnings, label);
}

function stringTime(value, offsetMinutes, warnings, label) {
  if (value == null || value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) { warnings.push(`Invalid ${label}; timestamp is unavailable`); return null; }
  return isoTime(match.slice(1).map(Number), offsetMinutes, warnings, label);
}

function timezoneOffset(value, fallback, warnings) {
  if (value == null || value === '') return fallback;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(String(value));
  if (!match || Number(match[3]) > 59 || Number(match[2]) > 14 || (Number(match[2]) === 14 && Number(match[3]) !== 0)) {
    warnings.push('Invalid registration time zone; configured device time zone used');
    return fallback;
  }
  return (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
}

function terminatedText(bytes, warnings, label, strict = false) {
  if (!bytes.length || bytes[bytes.length - 1] !== 0) {
    if (strict) throw new StatusParseError(`Invalid ${label}: missing NUL terminator`);
    warnings.push(`${label} is missing its NUL terminator`);
  }
  const content = bytes[bytes.length - 1] === 0 ? bytes.subarray(0, -1) : bytes;
  if (content.includes(0)) throw new StatusParseError(`Invalid ${label}: embedded NUL`);
  return content.toString('utf8');
}

function jsonObject(bytes, warnings, label) {
  const text = terminatedText(bytes, warnings, label);
  let value;
  try { value = JSON.parse(text); } catch { throw new StatusParseError(`Invalid ${label} JSON`); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new StatusParseError(`Invalid ${label}: expected a JSON object`);
  return value;
}

function session(cursor, warnings) {
  const length = cursor.u8('session length');
  if (!length) throw new StatusParseError('Invalid session length: must include a NUL terminator');
  return terminatedText(cursor.take(length, 'session ID'), warnings, 'session ID', true);
}

const bit = (value, index) => Boolean(value & (2 ** index));
const channels = (value) => Array.from({ length: 16 }, (_, index) => ({ channel: index + 1, active: bit(value, index) }));

function rejectUnknownFlags(flags, supported, label) {
  const unknown = (flags & ~supported) >>> 0;
  if (unknown) throw new StatusParseError(`Unsupported ${label} flags 0x${unknown.toString(16)}; later status groups were not decoded`);
}

function readGps(cursor, offset, warnings) {
  const info = cursor.u8('GPS flags');
  const locationType = cursor.u8('GPS location type');
  const capturedAt = binaryTime(cursor.take(6, 'GPS time'), offset, warnings, 'GPS time');
  const directionRaw = cursor.u8('GPS direction');
  const satellites = cursor.u8('GPS satellite count');
  const speedKph = cursor.u16('GPS speed') / 100;
  const altitudeRaw = cursor.u16('GPS altitude');
  const hdop = cursor.u16('GPS accuracy') / 10;
  const longitudeDegrees = cursor.u8('longitude degrees');
  const longitudeMinutesRaw = cursor.u32('longitude minutes');
  const latitudeByte = cursor.u8('latitude degrees');
  // The latitude field allows signed degrees as well as the explicit south flag.
  const latitudeDegrees = latitudeByte > 90 ? latitudeByte - 256 : latitudeByte;
  const latitudeMinutesRaw = cursor.u32('latitude minutes');
  let lng = (longitudeDegrees + longitudeMinutesRaw / 600000) * (bit(info, 1) ? -1 : 1);
  let lat = (Math.abs(latitudeDegrees) + latitudeMinutesRaw / 600000) * ((bit(info, 4) || latitudeDegrees < 0) ? -1 : 1);
  const coordinatesValid = longitudeMinutesRaw < 600000 && latitudeMinutesRaw < 600000 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!coordinatesValid) { warnings.push('Invalid GPS coordinates; latitude and longitude are unavailable'); lat = null; lng = null; }
  const knownLocationType = locationType >= 1 && locationType <= 6;
  if (locationType > 6) warnings.push(`Unknown location type ${locationType}`);
  if (directionRaw > 180) warnings.push('Invalid GPS direction; heading is unavailable');
  if (altitudeRaw !== 0) warnings.push('Altitude units conflict within H-protocol v4.0.0; raw altitude retained, meters unavailable');
  return {
    info, locationType, valid: knownLocationType && coordinatesValid && capturedAt !== null,
    capturedAt, lat, lng, speedKph, satellites,
    headingDegrees: directionRaw <= 180 ? directionRaw + (bit(info, 0) ? 180 : 0) : null,
    altitudeRaw, altitudeBelowSeaLevel: bit(info, 2), altitudeMeters: altitudeRaw === 0 ? 0 : null,
    hdop, mileagePresent: bit(info, 3),
    coordinateRaw: { longitudeDegrees, longitudeMinutesRaw, latitudeByte, latitudeMinutesRaw },
  };
}

function readGsensor(cursor) {
  const flags = cursor.u8('G-sensor flags');
  const result = { flags, xG: null, yG: null, zG: null, tiltG: null, impactG: null };
  rejectUnknownFlags(flags, 7, 'G-sensor');
  if (bit(flags, 0)) {
    result.xG = cursor.i16('G-sensor X') / 100;
    result.yG = cursor.i16('G-sensor Y') / 100;
    result.zG = cursor.i16('G-sensor Z') / 100;
  }
  if (bit(flags, 1)) result.tiltG = cursor.i16('G-sensor tilt') / 100;
  if (bit(flags, 2)) result.impactG = cursor.i16('G-sensor impact') / 100;
  return result;
}

function readBasic(cursor) {
  const flags1 = cursor.u8('basic status flags 1');
  const flags2 = cursor.u8('basic status flags 2');
  const custom = cursor.u16('basic status custom bits');
  return {
    flags1, flags2, custom, acc: bit(flags1, 0), brake: bit(flags1, 1),
    turnLeft: bit(flags1, 2), turnRight: bit(flags1, 3), forward: bit(flags1, 4), reverse: bit(flags1, 5),
    leftFrontDoorOpen: bit(flags1, 6), rightFrontDoorOpen: bit(flags1, 7),
    leftMiddleDoorOpen: bit(flags2, 0), rightMiddleDoorOpen: bit(flags2, 1),
    leftRearDoorOpen: bit(flags2, 2), rightRearDoorOpen: bit(flags2, 3),
    privateMode: bit(flags2, 4), wifiInUse: bit(flags2, 5), mobileInUse: bit(flags2, 6), sleeping: bit(flags2, 7),
  };
}

function moduleValue(value) {
  return { code: value, state: ['unknown', 'normal', 'abnormal', 'absent'][value] ?? 'unrecognized' };
}

function readModules(cursor) {
  const flags = cursor.u16('module flags');
  rejectUnknownFlags(flags, 0x1f, 'module');
  const result = { flags, mobile: null, positioning: null, wifi: null, gsensor: null, recording: null };
  for (const [index, name] of ['mobile', 'positioning', 'wifi', 'gsensor'].entries()) {
    if (bit(flags, index)) result[name] = moduleValue(cursor.u8(`${name} module status`));
  }
  if (bit(flags, 4)) {
    const mask = cursor.u16('recording channel flags');
    result.recording = { mask, channels: channels(mask).map(({ channel, active }) => ({ channel, recording: active })) };
  }
  return result;
}

function readFuel(cursor) {
  const flags = cursor.u8('fuel flags');
  rejectUnknownFlags(flags, 3, 'fuel');
  return {
    flags, consumption: bit(flags, 0) ? cursor.u16('fuel consumption') / 10 : null,
    balanceRaw: bit(flags, 1) ? cursor.u16('fuel balance') : null,
    units: null, // The status table does not specify volume units or a balance scale.
  };
}

function signal(value, warnings, label) {
  if (value === 0) return null;
  if (value > 10) { warnings.push(`Invalid ${label} signal strength ${value}`); return null; }
  return value;
}

function readMobile(cursor, warnings) {
  const flags = cursor.u8('mobile network flags');
  const signalRaw = cursor.u8('mobile signal strength');
  const networkType = cursor.u8('mobile network type');
  const reserved = cursor.u16('mobile network reserved');
  return { flags, signalRaw, signalStrength: signal(signalRaw, warnings, 'mobile'), networkType, reserved };
}

function readWifi(cursor, warnings) {
  const flags = cursor.u8('Wi-Fi flags');
  rejectUnknownFlags(flags, 0x1f, 'Wi-Fi');
  const result = { flags, signalStrength: null, address: null, gateway: null, subnetMask: null, ssid: null };
  if (bit(flags, 0)) result.signalStrength = signal(cursor.u8('Wi-Fi signal'), warnings, 'Wi-Fi');
  for (const [index, name] of ['address', 'gateway', 'subnetMask'].entries()) {
    if (bit(flags, index + 1)) result[name] = [...cursor.take(4, `Wi-Fi ${name}`)].join('.');
  }
  if (bit(flags, 4)) {
    const length = cursor.u8('Wi-Fi SSID length');
    if (!length) throw new StatusParseError('Invalid Wi-Fi SSID length: must include terminator');
    result.ssid = terminatedText(cursor.take(length, 'Wi-Fi SSID'), warnings, 'Wi-Fi SSID', true);
  }
  return result;
}

function readDisks(cursor) {
  const flags = cursor.u8('disk flags');
  const disks = [];
  for (let group = 0; group < 8; group++) {
    if (!bit(flags, group)) continue;
    const id = cursor.u8('disk ID');
    const code = cursor.u8('disk status');
    const sizeMB = cursor.u32('disk size');
    const freeMB = cursor.u32('disk free capacity');
    disks.push({ group: group + 1, id, name: { 11: 'hdd1', 12: 'hdd2', 13: 'hdd3', 14: 'hdd4', 15: 'sd1', 16: 'sd2', 17: 'sd3', 18: 'sd4', 19: 'usb1', 20: 'usb2' }[id] ?? null,
      code, state: ['unknown', 'recording', 'idle', 'abnormal', 'full'][code] ?? 'unrecognized', sizeMB, freeMB });
  }
  return { flags, disks };
}

function readAlarmStatus(cursor) {
  const flags = cursor.u32('alarm status flags');
  rejectUnknownFlags(flags, 0x3fff, 'alarm status');
  const result = { flags, videoLoss: null, motion: null, videoBlind: null, inputMask: null, inputs: null };
  for (const [index, name] of ['videoLoss', 'motion', 'videoBlind'].entries()) {
    if (bit(flags, index)) { const mask = cursor.u16(`${name} channels`); result[name] = { mask, channels: channels(mask) }; }
  }
  if (bit(flags, 3)) { result.inputMask = cursor.u16('alarm input channels'); result.inputs = channels(result.inputMask); }
  for (const [index, name] of ['overspeed', 'lowSpeed', 'emergency', 'overtimeStop', 'vibration', 'exitGeofence', 'enterGeofence', 'exitRoute', 'enterRoute', 'fuelLevel'].entries()) {
    result[name] = bit(flags, index + 4);
  }
  return result;
}

function readEnvironment(cursor) {
  const flags = cursor.u16('temperature/humidity flags');
  rejectUnknownFlags(flags, 0x3f, 'temperature/humidity');
  const temperaturesC = Array.from({ length: 4 }, (_, index) => bit(flags, index) ? cursor.i16(`temperature ${index + 1}`) / 100 : null);
  const humidityPercent = Array.from({ length: 2 }, (_, index) => bit(flags, index + 4) ? cursor.u8(`humidity ${index + 1}`) : null);
  return { flags, temperaturesC, humidityPercent };
}

function readStatistics(cursor) {
  const flags = cursor.u16('statistics flags');
  rejectUnknownFlags(flags, 1, 'statistics');
  return { flags, totalMileageMeters: bit(flags, 0) ? cursor.u32('total mileage') : null, todayMileageMeters: bit(flags, 0) ? cursor.u32('current day mileage') : null };
}

function readStatus(cursor, offset, warnings) {
  const result = { deviceTime: null, contentMask: null, gps: null, acc: null, inputs: null, diagnostics: {}, complete: false, unparsedBytes: 0 };
  try {
    result.deviceTime = binaryTime(cursor.take(6, 'device time'), offset, warnings, 'device time');
    result.contentMask = cursor.u16('status content mask');
    for (let index = 0; index < 16; index++) {
      if (!bit(result.contentMask, index)) continue;
      switch (index) {
        case 0: result.gps = readGps(cursor, offset, warnings); break;
        case 1: result.diagnostics.gsensor = readGsensor(cursor); break;
        case 2: result.diagnostics.basic = readBasic(cursor); result.acc = result.diagnostics.basic.acc; break;
        case 3: result.diagnostics.modules = readModules(cursor); break;
        case 4: result.diagnostics.fuel = readFuel(cursor); break;
        case 5: result.diagnostics.mobile = readMobile(cursor, warnings); break;
        case 6: result.diagnostics.wifi = readWifi(cursor, warnings); break;
        case 7: result.diagnostics.storage = readDisks(cursor); break;
        case 8: result.diagnostics.alarms = readAlarmStatus(cursor); result.inputs = result.diagnostics.alarms.inputs; break;
        case 9: result.diagnostics.environment = readEnvironment(cursor); break;
        case 10: result.diagnostics.statistics = readStatistics(cursor); break;
        default: throw new StatusParseError(`Unsupported status group ${index}; this and later groups were not decoded`);
      }
    }
    // Older status payloads end after group 1. New firmware can append group 2.
    if (cursor.remaining) {
      result.extendedContentMask = cursor.u16('extended status content mask');
      if (result.extendedContentMask) throw new StatusParseError(`Unsupported extended status groups 0x${result.extendedContentMask.toString(16)}; extension bytes were not decoded`);
    }
    if (cursor.remaining) throw new StatusParseError(`${cursor.remaining} unexpected trailing status bytes were not decoded`);
    result.complete = true;
  } catch (error) {
    if (!(error instanceof StatusParseError)) throw error;
    warnings.push(error.message);
  }
  result.unparsedBytes = cursor.remaining;
  return result;
}

function packetParts(frame) {
  if (Buffer.isBuffer(frame)) {
    if (frame.length < HEADER_BYTES || frame[0] !== 0x48 || frame[1] !== 1 || frame.readUInt32LE(4) !== frame.length - HEADER_BYTES) {
      throw new Error('Invalid complete H-protocol frame');
    }
    return { type: frame.readUInt16LE(2), payload: frame.subarray(HEADER_BYTES) };
  }
  if (!frame || !Number.isInteger(frame.type) || frame.type < 0 || frame.type > 0xffff || !Buffer.isBuffer(frame.payload)) {
    throw new TypeError('Expected a decoded H-protocol frame');
  }
  return frame;
}

export function decodePacket(frame, { timeZoneOffsetMinutes = 420 } = {}) {
  const { type, payload } = packetParts(frame);
  const warnings = [];
  const packet = { messageType: `0x${type.toString(16).padStart(4, '0')}`, kind: 'unknown', summary: '', occurredAt: null, decoded: {}, warnings };
  try {
    if (type === 0x0001 || type === 0x4041 || type === 0x4051) {
      packet.kind = type === 0x0001 ? 'heartbeat' : type === 0x4041 ? 'status-ack' : 'alarm-ack';
      packet.summary = packet.kind;
      if (payload.length) warnings.push('Unexpected payload on a message defined without loading data');
    } else if (JSON_TYPES.has(type)) {
      packet.kind = JSON_TYPES.get(type);
      const decoded = jsonObject(payload, warnings, packet.kind);
      packet.decoded = decoded;
      decoded.sessionId = decoded.ss == null ? null : String(decoded.ss);
      if (type === 0x1001) {
        decoded.deviceId = decoded.dn == null ? null : String(decoded.dn);
        decoded.timeZoneOffsetMinutes = timezoneOffset(decoded.gmt, timeZoneOffsetMinutes, warnings);
        decoded.deviceTime = stringTime(decoded.dtu, decoded.timeZoneOffsetMinutes, warnings, 'registration device time');
        packet.occurredAt = decoded.deviceTime;
        packet.summary = `Device ${decoded.deviceId || '(missing ID)'} registration`;
      } else packet.summary = `${packet.kind}${decoded.err == null ? '' : ` (result ${decoded.err})`}`;
    } else if (type === 0x1041) {
      packet.kind = 'status';
      const cursor = new Cursor(payload);
      const sessionId = session(cursor, warnings);
      packet.decoded = { sessionId, ...readStatus(cursor, timeZoneOffsetMinutes, warnings) };
      packet.occurredAt = packet.decoded.deviceTime;
      packet.summary = packet.decoded.gps?.valid ? `GPS ${packet.decoded.gps.speedKph} km/h; ACC ${packet.decoded.acc == null ? 'unavailable' : packet.decoded.acc ? 'on' : 'off'}` : 'Device status';
    } else if (type === 0x1051) {
      packet.kind = 'alarm';
      const cursor = new Cursor(payload);
      const sessionId = session(cursor, warnings);
      const jsonLength = cursor.u32('alarm JSON length');
      if (!jsonLength) throw new StatusParseError('Invalid alarm JSON length: must include a NUL terminator');
      const alarmBytes = cursor.take(jsonLength, 'alarm JSON');
      terminatedText(alarmBytes, warnings, 'alarm JSON', true);
      const alarm = jsonObject(alarmBytes, warnings, 'alarm');
      const startedAt = stringTime(alarm.st, timeZoneOffsetMinutes, warnings, 'alarm start time');
      const endedAt = stringTime(alarm.et, timeZoneOffsetMinutes, warnings, 'alarm end time');
      const deviceTime = stringTime(alarm.dtu, timeZoneOffsetMinutes, warnings, 'alarm device time');
      const alarmState = alarm.et === '' ? 'start' : alarm.et != null ? 'end' : 'unknown';
      const status = cursor.remaining ? readStatus(cursor, timeZoneOffsetMinutes, warnings) : null;
      packet.decoded = { sessionId, alarm, alarmState, startedAt, endedAt, deviceTime, status };
      packet.occurredAt = (alarmState === 'end' ? endedAt : startedAt) ?? deviceTime;
      packet.summary = `Alarm ${alarm.ec ?? 'unknown'} ${alarmState}`;
    } else {
      packet.summary = `Unknown message ${packet.messageType} (${payload.length} bytes)`;
      packet.decoded = { payloadBytes: payload.length };
      warnings.push('Message type is not decoded; raw bytes are retained by the gateway');
    }
  } catch (error) {
    if (!(error instanceof StatusParseError)) throw error;
    warnings.push(error.message);
    packet.summary = `Malformed ${packet.kind} payload`;
  }
  return packet;
}

import { createHash } from 'node:crypto';
import { createVssClient, normalizeVssAlarm, normalizeVssDevice, readVssConfiguration, VssClientError } from './vss-client.mjs';

const CACHE_MS = 15_000;
const RETRY_MS = 30_000;
const ALARM_WINDOW_MS = 15 * 60_000;
const MAX_ALARM_PAGES = 10;
const ALARM_PAGE_SIZE = 500;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = value => new Date(value).toISOString();

export class VssDiagnosticsError extends Error {
  constructor(message,status=400) { super(message); this.name='VssDiagnosticsError'; this.status=status; }
}

function filters(params) {
  for (const key of params.keys()) if (!['deviceId','kind','limit'].includes(key) || params.getAll(key).length!==1) throw new VssDiagnosticsError('Unsupported or repeated diagnostics filter.');
  const deviceId=params.get('deviceId') || '';
  if (deviceId.length>180 || /[\u0000-\u001f]/u.test(deviceId)) throw new VssDiagnosticsError('Invalid device identifier.');
  const kind=params.get('kind') || '';
  if (kind && !['alarm','telemetry'].includes(kind)) throw new VssDiagnosticsError('Invalid event kind.');
  const limit=Number(params.get('limit') || 200);
  if (!Number.isInteger(limit) || limit<1 || limit>500) throw new VssDiagnosticsError('Event limit must be between 1 and 500.');
  return {deviceId,kind,limit};
}

/** A process-local VSS session/cache. It performs read requests only. */
export function createVssDiagnostics({env=process.env,now=Date.now,clientFactory=createVssClient}={}) {
  let state=null;
  function sourceState(configuration) {
    const key=hash(configuration);
    if (state?.key===key) return state;
    state={key,client:clientFactory({configuration,now}),configuration,catalog:null,alarms:null,inFlight:null,
      refreshAfter:0,lastError:null,statusHistory:new Map(),lastSuccessAt:null};
    return state;
  }
  async function refresh(current) {
    if (current.inFlight) return current.inFlight;
    if (now()<current.refreshAfter) return;
    current.inFlight=(async()=>{
      const fetchedAt=iso(now());
      const to=iso(Math.floor(now()/1000)*1000);
      const from=iso(Date.parse(to)-ALARM_WINDOW_MS);
      const startedAt=now();
      const vssTime=value=>iso(Date.parse(value)+current.configuration.utcOffsetMinutes*60_000).slice(0,19).replace('T',' ');
      // The two read paths share the same single-flight login/session.
      const results=await Promise.allSettled([
        current.client.fetchCatalog(),
        (async()=>{
          const records=new Map();
          let total=null,pages=0,hasMore=false,previousDigest=null,coverageChanged=false;
          let rowsRead=0,duplicateRows=0,skippedRows=0;
          for (let page=1;page<=MAX_ALARM_PAGES;page+=1) {
            if (page>1 && now()-startedAt>20_000) {hasMore=true;break;}
            const result=await current.client.fetchAlarmPage({from,to,page,pageSize:ALARM_PAGE_SIZE});
            const digest=hash(result.records);
            if (result.records.length && digest===previousDigest) throw new VssDiagnosticsError('VSS repeated an alarm page. The last successful sample is shown.',502);
            previousDigest=digest;
            if (total!==null && result.total!==null && total!==result.total) coverageChanged=true;
            total=result.total;pages=page;hasMore=result.hasMore;
            rowsRead+=result.records.length;
            for (const row of result.records) {
              const event=normalizeVssAlarm(row,{receivedAt:fetchedAt,utcOffsetMinutes:current.configuration.utcOffsetMinutes});
              if (!event) {skippedRows+=1;continue;}
              if (records.has(event.id)) duplicateRows+=1;
              records.set(event.id,{...event,sourceRequest:{method:'POST',path:'/vss/alarm/findAllByTime.action',
                body:{beginTime:vssTime(from),endTime:vssTime(to),pageNum:page,pageSize:ALARM_PAGE_SIZE,token:'[redacted]'}}});
            }
            if (!hasMore) break;
          }
          // VSS total counts source rows; loaded remains the compatible alias for unique events.
          return {records:[...records.values()],fetchedAt,coverage:{from,to,total,rowsRead,uniqueEvents:records.size,duplicateRows,skippedRows,
            loaded:records.size,pages,complete:!hasMore&&!coverageChanged,truncated:hasMore,changedDuringRead:coverageChanged}};
        })(),
      ]);
      const errors=[];
      if (results[0].status==='fulfilled') {
        const rows=results[0].value;
        const devices=rows.map(row=>normalizeVssDevice(row,{receivedAt:fetchedAt,utcOffsetMinutes:current.configuration.utcOffsetMinutes})).filter(Boolean);
        current.catalog={devices,fetchedAt,total:rows.length};
      } else errors.push({source:'Vehicle status',error:results[0].reason});
      if (results[1].status==='fulfilled') current.alarms=results[1].value;
      else errors.push({source:'Alarms',error:results[1].reason});
      current.lastError=errors.length ? errors.map(({source,error})=>`${source}: ${error instanceof VssClientError || error instanceof VssDiagnosticsError ? error.message : 'VSS could not be reached.'}`).join(' ') : null;
      if (!errors.length) current.lastSuccessAt=iso(now());
      current.refreshAfter=now()+(errors.length ? RETRY_MS : CACHE_MS);
    })().finally(()=>{current.inFlight=null;});
    return current.inFlight;
  }
  return async function snapshot(params=new URLSearchParams()) {
    const query=filters(params);
    let configuration;
    try { configuration=readVssConfiguration(env); }
    catch(error) { throw new VssDiagnosticsError(error.message,503); }
    const base={configured:configuration.configured,version:1,source:'vss',generatedAt:iso(now()),devices:[],events:[],selectedDeviceId:null,
      parameters:{source:'VSS API',readOnly:true,cacheSeconds:CACHE_MS/1000,freshnessSeconds:120,alarmWindowMinutes:15,maximumAlarmRows:MAX_ALARM_PAGES*ALARM_PAGE_SIZE,
        vehicleEndpoint:'/vss/vehicle/findAll.action',alarmEndpoint:'/vss/alarm/findAllByTime.action',rawPayloadScope:'VSS API records; original MDVR wire packets are not provided.',deviceSettingsReadback:false},
      service:{source:'vss',readOnly:true,lastSuccessAt:null,lastError:null,catalogFetchedAt:null,alarmsFetchedAt:null,cacheSeconds:CACHE_MS/1000}};
    if (!configuration.configured) return base;
    const current=sourceState(configuration);
    await refresh(current);
    if (!current.catalog && !current.alarms) throw new VssDiagnosticsError(current.lastError || 'No VSS data is available.',502);
    const devices=current.catalog?.devices || [];
    const selected=query.deviceId ? devices.find(device=>device.deviceId===query.deviceId) : [...devices].sort((a,b)=>(Date.parse(b.telemetryReceivedAt)||0)-(Date.parse(a.telemetryReceivedAt)||0))[0];
    if (query.deviceId && !selected && current.catalog) throw new VssDiagnosticsError('Device was not found in the VSS account.',404);
    let telemetryEvents=[];
    if (selected) {
      const id=`status:${hash([selected.deviceId,selected.telemetryReceivedAt,selected.telemetry])}`;
      const history=current.statusHistory.get(selected.deviceId) || new Map();
      if (!history.has(id)) history.set(id,{id,deviceId:selected.deviceId,kind:'telemetry',direction:'inbound',occurredAt:selected.telemetryReceivedAt,
        receivedAt:current.catalog.fetchedAt,summary:'VSS device status',decoded:selected.telemetry,raw:selected.raw,warnings:selected.warnings,
        sourceRequest:{method:'POST',path:'/vss/vehicle/findAll.action',body:{pageNum:'paginated',pageCount:500,token:'[redacted]'}}});
      while (history.size>50) history.delete(history.keys().next().value);
      current.statusHistory.delete(selected.deviceId);current.statusHistory.set(selected.deviceId,history);
      while (current.statusHistory.size>20) current.statusHistory.delete(current.statusHistory.keys().next().value);
      telemetryEvents=[...history.values()];
    }
    const selectedId=selected?.deviceId || query.deviceId || null;
    const alarms=(current.alarms?.records || []).filter(event=>!selectedId || event.deviceId===selectedId);
    const matching=[...telemetryEvents,...alarms].filter(event=>!query.kind || event.kind===query.kind)
      .sort((a,b)=>(Date.parse(b.occurredAt)||0)-(Date.parse(a.occurredAt)||0) || b.id.localeCompare(a.id));
    return {...base,selectedDeviceId:selectedId,
      devices:devices.map(device=>device.deviceId===selected?.deviceId ? device : {deviceId:device.deviceId,vehicleNumber:device.vehicleNumber,model:device.model}),
      events:matching.slice(0,query.limit),
      coverage:{...current.alarms?.coverage,matchingDeviceAlarms:alarms.length,matchingEvents:matching.length,returnedEvents:Math.min(query.limit,matching.length),eventLimit:query.limit},
      service:{...base.service,lastSuccessAt:current.lastSuccessAt,lastError:current.lastError,catalogFetchedAt:current.catalog?.fetchedAt || null,
        alarmsFetchedAt:current.alarms?.fetchedAt || null,deviceCount:current.catalog?.total || 0,nextRefreshAt:iso(current.refreshAfter),
        catalogStale:!current.catalog || now()-Date.parse(current.catalog.fetchedAt)>CACHE_MS*2,
        alarmsStale:!current.alarms || now()-Date.parse(current.alarms.fetchedAt)>CACHE_MS*2},
      parameters:{...base.parameters,utcOffsetMinutes:configuration.utcOffsetMinutes,server:new URL(configuration.baseUrl).origin,
        history:'Recent alarm window and an in-memory sample of viewed device statuses. No permanent archive.'},
    };
  };
}

export const getVssDiagnosticSnapshot=createVssDiagnostics();

import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { finalizeDurableActiveJob } from './active-job-finalization';
import { parseStoredDeviceCredential, type DeviceCredential } from './device-auth';
import { parseStoredActiveJob, parseStoredBinding } from './device-state';
import type { JobReportInput } from './report';
const CONFIG_KEY='songdee.vehicle.binding';
const ACTIVE_JOB_KEY='songdee.active.job';
const DEVICE_CREDENTIAL_KEY='songdee.device.credential';
export type DeviceBinding={vehicleNumber:string;deviceId:string};
export type ActiveJob={jobId?:string;vehicleNumber:string;deviceId:string;selected:string;startedAt:number;awaitingMovement?:boolean;driverName?:string|null;driverId?:string|null;pendingReport?:JobReportInput};
export async function getDeviceId(){const deviceId=Application.getAndroidId?.()?.trim();if(!deviceId)throw new Error('Android device ID is unavailable');return deviceId}
export async function getBinding(){const raw=await SecureStore.getItemAsync(CONFIG_KEY);const binding=parseStoredBinding(raw);if(raw&&!binding)await SecureStore.deleteItemAsync(CONFIG_KEY).catch(()=>{});return binding}
export async function persistBinding(binding:DeviceBinding){await SecureStore.setItemAsync(CONFIG_KEY,JSON.stringify(binding));return binding}
export async function clearBinding(){await SecureStore.deleteItemAsync(CONFIG_KEY)}
export async function getDeviceCredential(){const raw=await SecureStore.getItemAsync(DEVICE_CREDENTIAL_KEY);const credential=parseStoredDeviceCredential(raw);if(raw&&!credential)await SecureStore.deleteItemAsync(DEVICE_CREDENTIAL_KEY).catch(()=>{});return credential}
export async function persistDeviceCredential(credential:DeviceCredential){await SecureStore.setItemAsync(DEVICE_CREDENTIAL_KEY,JSON.stringify(credential));return credential}
export async function clearDeviceCredential(){await SecureStore.deleteItemAsync(DEVICE_CREDENTIAL_KEY)}
export async function getActiveJob(){const raw=await SecureStore.getItemAsync(ACTIVE_JOB_KEY);const job=parseStoredActiveJob(raw);if(raw&&!job)await SecureStore.deleteItemAsync(ACTIVE_JOB_KEY).catch(()=>{});return job}
export async function persistActiveJob(job:ActiveJob){await SecureStore.setItemAsync(ACTIVE_JOB_KEY,JSON.stringify(job));return job}
export async function clearActiveJob(){await SecureStore.deleteItemAsync(ACTIVE_JOB_KEY)}
export async function finalizeActiveJob(){return finalizeDurableActiveJob(clearActiveJob,()=>SecureStore.setItemAsync(ACTIVE_JOB_KEY,JSON.stringify({closed:true})))}
export async function saveBinding(vehicleNumber:string){return persistBinding({vehicleNumber,deviceId:await getDeviceId()})}

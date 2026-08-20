import type { DeviceBinding } from './device';
import type { JobReportInput } from './report';

export type SavedJob = JobReportInput & {
  gpsLookupStatus?: string | null;
  pendingUpload?: boolean;
  uploadFailed?: boolean;
};

export type LocallySavedJob = {
  report: JobReportInput;
  uploadFailed: boolean;
};

export function mergeSavedJobs(
  binding: DeviceBinding,
  serverJobs: SavedJob[],
  localJobs: LocallySavedJob[],
) {
  const byId = new Map<string, SavedJob>();
  for (const job of serverJobs) {
    if (job.deviceId === binding.deviceId && job.vehicleNumber === binding.vehicleNumber) byId.set(job.id, job);
  }
  for (const local of localJobs) {
    const job = local.report;
    if (job.deviceId !== binding.deviceId || job.vehicleNumber !== binding.vehicleNumber) continue;
    byId.set(job.id, { ...job, pendingUpload: !local.uploadFailed, uploadFailed: local.uploadFailed });
  }
  return [...byId.values()].sort((left, right) => Date.parse(right.endTime) - Date.parse(left.endTime));
}

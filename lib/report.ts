export type JobReportInput = {
  id: string;
  vehicleNumber: string;
  deviceId: string;
  driverName: string | null;
  driverId: string | null;
  mode: string;
  startTime: string;
  endTime: string;
  duration: string;
  status?: 'Cancelled';
};

export type JobReportInput = {
  id: string;
  vehicleNumber: string;
  deviceId: string;
  driverName: string | null;
  driverId: string | null;
  mode: string;
  routeName?: string | null;
  startTime: string;
  endTime: string;
  duration: string;
  status?: 'Cancelled';
};

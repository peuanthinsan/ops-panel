export type JobStartInput = {
  id: string;
  vehicleNumber: string;
  deviceId: string;
  driverName: string | null;
  driverId: string | null;
  mode: string;
  routeName?: string | null;
  startTime: string;
};

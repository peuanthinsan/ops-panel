export const operationActions = [
  ['1', 'ขึ้นสินค้า', 'Load', 'กดแจ้งเริ่มขึ้นสินค้า', 'Tap to report loading started'],
  ['2', 'หยุดรถ', 'Stop vehicle', 'แจ้งสถานะหยุดรถที่จุดหมาย', 'Report vehicle stopped at destination'],
  ['3', 'ลงสินค้า', 'Unload', 'กดแจ้งเริ่มลงสินค้า', 'Tap to report unloading started'],
  ['4', 'พักเบรก', 'Break', 'บันทึกเวลาพักของ พขร.', 'Record driver break time'],
  ['5', 'เช็ครถ', 'Vehicle check', 'ตรวจเช็ครถก่อน-หลังเดินทาง', 'Check vehicle before and after trip'],
  ['6', 'เติมน้ำมัน', 'Refuel', 'บันทึกจุดเติมน้ำมัน', 'Record refueling stop'],
  ['7', 'ล้างรถ', 'Vehicle wash', 'แจ้งนำรถเข้าล้างทำความสะอาด', 'Report vehicle sent for washing'],
  ['8', 'จอดนอน', 'Park overnight', 'แจ้งจุดจอดพักค้างคืน', 'Report overnight parking location'],
  ['9', 'จบงาน', 'Done', 'ปิดงาน สรุปเที่ยววิ่ง', 'Close job and summarize trip'],
] as const;

export const reportableOperations = operationActions.slice(0, 8);

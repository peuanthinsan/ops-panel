import * as React from 'react';
import { SearchableCombobox } from 'songdee-ops-panel';

const noop = () => {};
const vehicles = ['SD-071', 'SD-072', 'SD-105', 'SD-118', 'SD-204', 'SD-231'];
const drivers = [
  { value: 'D-014', label: 'สมชาย ใจดี' },
  { value: 'D-022', label: 'วิชัย พงษ์ไทย' },
  { value: 'D-031', label: 'ประยุทธ์ สุขสันต์' },
  { value: 'D-045', label: 'อนุชา แก้วมณี' },
];

export const SingleSelect = () => (
  <div style={{ maxWidth: 320, padding: 16 }}>
    <SearchableCombobox label="Vehicle" value="SD-071" onChange={noop} options={vehicles} allLabel="All vehicles" lang="en" />
  </div>
);

export const MultipleSelected = () => (
  <div style={{ maxWidth: 320, padding: 16 }}>
    <SearchableCombobox label="Vehicle" value={['SD-071', 'SD-105', 'SD-118']} onChange={noop} options={vehicles} allLabel="All vehicles" lang="en" multiple />
  </div>
);

export const ThaiDriverOptions = () => (
  <div style={{ maxWidth: 320, padding: 16 }}>
    <SearchableCombobox label="พนักงานขับรถ" value={['D-022']} onChange={noop} options={drivers} allLabel="พนักงานขับรถทั้งหมด" lang="th" multiple />
  </div>
);

export const AllSelected = () => (
  <div style={{ maxWidth: 320, padding: 16 }}>
    <SearchableCombobox label="Driver" value={[]} onChange={noop} options={drivers} allLabel="All drivers" lang="en" multiple />
  </div>
);

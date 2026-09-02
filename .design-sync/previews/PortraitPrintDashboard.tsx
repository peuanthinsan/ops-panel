import * as React from 'react';
import { PortraitPrintDashboard } from 'songdee-ops-panel';

// Without a vehicle prop the component short-circuits (before any fetch) to its shipped
// select-vehicle prompt — a fully static, styled state. With vehicle + date it becomes
// fetch-bound and renders the print-state shell (preparing/could-not-open + retry).
export const ThaiSelectVehiclePrompt = () => <PortraitPrintDashboard lang="th" />;

export const EnglishSelectVehiclePrompt = () => <PortraitPrintDashboard lang="en" />;

export const EnglishVehicleDayShell = () => (
  <PortraitPrintDashboard lang="en" vehicle="SD-071" date="2026-08-20" />
);

import * as React from 'react';
import { SettingsDashboard } from 'songdee-ops-panel';

// SettingsDashboard performs no fetch on mount (only on password-form submit), so the
// idle state below is the complete shipped page: password panel + device setup policy
// card. Every statically reachable state renders identically, so th/en cover it.
export const ThaiSettings = () => <SettingsDashboard lang="th" />;

export const EnglishSettings = () => <SettingsDashboard lang="en" />;

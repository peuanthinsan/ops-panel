export const SONGDEE_API_SERVICE = 'songdee-fleet-ops';
export const SONGDEE_API_CONTRACT_VERSION = '2026-08-24.2';

export function songdeeApiHealth(extra = {}) {
  return {
    ...extra,
    ok: true,
    service: SONGDEE_API_SERVICE,
    apiContractVersion: SONGDEE_API_CONTRACT_VERSION,
  };
}

export function isCompatibleSongdeeApiHealth(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && value.ok === true
      && value.service === SONGDEE_API_SERVICE
      && value.apiContractVersion === SONGDEE_API_CONTRACT_VERSION,
  );
}

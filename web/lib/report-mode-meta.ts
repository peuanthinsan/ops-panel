export const REPORT_MODE_COLORS: Record<string, string> = {
  Load: '#D5283D',
  'Stop vehicle': '#DFA036',
  Unload: '#203854',
  Break: '#68727D',
  'Vehicle check': '#2E7D72',
  Refuel: '#B9641B',
  'Vehicle wash': '#2F6D9A',
  'Park overnight': '#705A8A',
  'Finish work': '#328052',
};

export function reportModeColor(mode: string | null | undefined) {
  return REPORT_MODE_COLORS[String(mode || '')] || '#68727D';
}

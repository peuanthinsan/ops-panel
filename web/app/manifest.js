export default function manifest() {
  return {
    name: 'Songdee GPS Ops Panel',
    short_name: 'Songdee Ops',
    description: 'Songdee fleet operations reports and administration.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F1F3F5',
    theme_color: '#111111',
    icons: [
      { src: '/songdee-gps-pin-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  };
}

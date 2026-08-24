import './styles.css';
import PwaRegister from './pwa-register';

export const metadata = { title: 'Songdee Ops Panel · Admin Dashboard', description: 'Vehicle operations administration for Songdee.', manifest: '/manifest.webmanifest' };
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#111111' };
export default function RootLayout({ children }) { return <html lang="en"><body><PwaRegister />{children}</body></html>; }

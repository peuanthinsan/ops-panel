import { NextResponse } from 'next/server';
import { isIP } from 'node:net';

export function proxy(request) {
  if (process.env.SONGDEE_WINDOWS_HOSTING !== '1') return NextResponse.next();
  let hostname;
  try {
    const authority = request.headers.get('host') || request.nextUrl.host;
    const url = new URL('http://' + authority);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return new Response(null, { status: 400 });
    }
    hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return new Response(null, { status: 400 });
  }
  if (hostname === 'api2.songdeegps.com') return new Response(null, { status: 404 });
  // This production listener is loopback-only. ngrok appends its observed
  // client address; discard caller-supplied earlier entries for rate limiting.
  const headers = new Headers(request.headers);
  const observed = (headers.get('x-forwarded-for') || '').split(',').at(-1).trim();
  headers.set('x-forwarded-for', isIP(observed) ? observed : 'unknown');
  headers.set('x-real-ip', isIP(observed) ? observed : 'unknown');
  return NextResponse.next({ request: { headers } });
}
export const config = { matcher: '/:path*' };

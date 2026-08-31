import { handleApiRequest } from '../../../lib/server/api.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function route(request, context) {
  const parameters = await context.params;
  return handleApiRequest(request, parameters?.segments || []);
}

export { route as DELETE, route as GET, route as OPTIONS, route as POST, route as PUT };

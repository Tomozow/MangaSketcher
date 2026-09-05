import { caPageUrlForLanIp } from '@/src/web/lanPack/caPageUrl';
import { primaryLanIPv4 } from '@/src/web/lanPack/lanIpv4';

export function GET() {
  const ip = primaryLanIPv4();
  if (!ip) {
    return new Response('no lan ip', { status: 503 });
  }
  return Response.json(
    { caPageUrl: caPageUrlForLanIp(ip) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// Authorization endpoint: a one-click consent page. Only a resource URL that carries a valid agent key can be authorized,
// and the token issued is that key, so Claude gets exactly the identity and authority the link already stood for.
import { issueCode, keyFromResource } from '@/gateway/oauth';
import { policyFor } from '@/gateway/policies';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** claude.ai's callback, other https callbacks, or a loopback callback (Claude Code); nothing else. */
function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--ink:#0b2f4e;--muted:#5b6b7a;--lime:#c4d600;--bg:#f4f7fa}
body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink);display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(11,47,78,.12);padding:28px;max-width:440px;width:100%}
h1{font-size:22px;margin:0 0 8px}p{margin:8px 0;color:var(--muted)}ul{padding-left:20px;color:var(--ink)}
button{margin-top:16px;width:100%;border:0;border-radius:999px;padding:12px 16px;font:600 16px system-ui;background:var(--lime);color:#1d2600;cursor:pointer}
.small{font-size:13px}
</style></head><body><main>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

const params = (src: URLSearchParams) => ({
  clientId: src.get('client_id') ?? '',
  redirectUri: src.get('redirect_uri') ?? '',
  state: src.get('state') ?? '',
  challenge: src.get('code_challenge') ?? '',
  method: src.get('code_challenge_method') ?? '',
  resource: src.get('resource') ?? '',
  clientName: src.get('client_name') ?? '',
});

function check(p: ReturnType<typeof params>) {
  if (!redirectAllowed(p.redirectUri)) return 'The redirect address is not allowed.';
  if (!p.challenge || p.method !== 'S256') return 'PKCE (S256) is required.';
  if (!keyFromResource(p.resource)) return 'This sign-in needs the Aimo connector link that contains the key (…/api/mcp/<key>). Add the connector again with the link from Aimo.';
  return null;
}

export function GET(request: Request) {
  const p = params(new URL(request.url).searchParams);
  const problem = check(p);
  if (problem) return page('Aimo sign-in', `<h1>Can't connect</h1><p>${esc(problem)}</p>`, 400);
  const { agent } = keyFromResource(p.resource)!;
  const policy = policyFor(agent.customerId);
  const hidden = Object.entries({
    client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state, code_challenge: p.challenge, code_challenge_method: p.method, resource: p.resource,
  }).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
  const client = new URL(p.redirectUri).hostname === 'claude.ai' ? 'Claude' : 'This AI assistant';
  return page('Connect to Valio Aimo', `<h1>Connect ${esc(client)} to Valio Aimo</h1>
<p>${esc(client)} will act as <strong>${esc(agent.displayName)}</strong>:</p>
<ul><li>look up products, fixed prices and availability</li><li>plan events and order within €${policy.autoApproveLimitEur.toLocaleString('en')} excl. VAT</li>
<li>anything above that waits for ${esc(policy.approver.name)} (${esc(policy.approver.role)})</li><li>log food waste and read your order history</li></ul>
<form method="post">${hidden}<button type="submit">Allow</button></form>
<p class="small">Prices are never negotiated, and no assistant can approve its own orders.</p>`);
}

export async function POST(request: Request) {
  const p = params(new URLSearchParams(await request.text()));
  const problem = check(p);
  if (problem) return page('Aimo sign-in', `<h1>Can't connect</h1><p>${esc(problem)}</p>`, 400);
  const { key } = keyFromResource(p.resource)!;
  const code = issueCode({ key, clientId: p.clientId, redirectUri: p.redirectUri, challenge: p.challenge });
  const back = new URL(p.redirectUri);
  back.searchParams.set('code', code);
  if (p.state) back.searchParams.set('state', p.state);
  return Response.redirect(back.toString(), 302);
}

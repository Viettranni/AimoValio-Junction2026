// `npm run dev`: everything the demo needs, in one command.
//   1. .env.local: created from .env.example when missing; warns about empty required keys.
//   2. The SQLite demo database: seeded when it doesn't exist yet.
//   3. Next.js dev server on port 3100 (PORT or `-p` overrides): widget, approvals, /api/mcp.
//   4. A public HTTPS tunnel for Claude's connectors (cloudflared quick tunnel → MCP-only proxy on :3200),
//      written to data/connect.json so the static page and the chat show the copy-paste link. AIMO_TUNNEL=0 skips it.
// Plain `next dev` is still `npm run dev:next`.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startMcpProxy } from './mcp-only-proxy';
import { CONNECT_FILE } from '../src/gateway/connect';

const root = process.cwd();
const args = process.argv.slice(2);
const pIndex = args.findIndex((a) => a === '-p' || a === '--port');
const port = Number(pIndex >= 0 ? args[pIndex + 1] : process.env.PORT ?? 3100);
const passThrough = pIndex >= 0 ? args.filter((_, i) => i !== pIndex && i !== pIndex + 1) : args;
const proxyPort = Number(process.env.AIMO_PROXY_PORT ?? 3200);
const baseUrl = process.env.AIMO_BASE_URL ?? `http://localhost:${port}`;
const bin = (name: string) => path.join(root, 'node_modules', '.bin', name);
const say = (s: string) => console.log(`\x1b[36m[aimo]\x1b[0m ${s}`);
const warn = (s: string) => console.log(`\x1b[33m[aimo]\x1b[0m ${s}`);

// 1. Environment file.
const envFile = path.join(root, '.env.local');
if (!existsSync(envFile)) {
  copyFileSync(path.join(root, '.env.example'), envFile);
  warn('Created .env.local from .env.example.');
}
const envText = readFileSync(envFile, 'utf8');
const envValue = (name: string) => process.env[name] || new RegExp(`^${name}=(.*)$`, 'm').exec(envText)?.[1]?.trim();
const empty = ['ANTHROPIC_API_KEY', 'VALIO_API_KEY'].filter((k) => !envValue(k));
if (empty.length) warn(`Fill in ${empty.join(' and ')} in .env.local; the assistant and live prices need them.`);

// 2. Database.
const dbPath = envValue('AIMO_DB_PATH') || path.join(root, 'data', 'aimo.sqlite');
if (!existsSync(dbPath)) {
  say('No demo database yet; seeding it…');
  const seeded = spawnSync(bin('tsx'), ['--env-file-if-exists=.env.local', 'scripts/seed.ts'], { stdio: 'inherit' });
  if (seeded.status !== 0) process.exit(seeded.status ?? 1);
}

// 3. Next.js.
const children: ChildProcess[] = [];
rmSync(CONNECT_FILE, { force: true });
const next = spawn(bin('next'), ['dev', '-p', String(port), ...passThrough], {
  stdio: 'inherit',
  env: { ...process.env, AIMO_BASE_URL: baseUrl },
});
children.push(next);
next.on('exit', (code) => shutdown(code ?? 0));

// 4. Tunnel.
const tunnelWanted = process.env.AIMO_TUNNEL !== '0' && envValue('AIMO_TUNNEL') !== '0';
const hasCloudflared = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status === 0;
const tunnelUrl: Promise<string | null> = (async () => {
  if (!tunnelWanted) return null;
  if (!hasCloudflared) {
    warn('cloudflared not found: Claude Code works with the local link, but claude.ai / Claude Desktop connectors need a public one. `brew install cloudflared`, then restart.');
    return null;
  }
  startMcpProxy(proxyPort, new URL(baseUrl)).on('error', (e) => warn(`MCP proxy on :${proxyPort} failed: ${e.message}`));
  const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${proxyPort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { warn('The tunnel did not come up within 30 s; using the local link.'); resolve(null); }, 30_000);
    const onData = (chunk: Buffer) => {
      const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString())?.[0];
      if (!url) return;
      clearTimeout(timer);
      writeFileSync(CONNECT_FILE, JSON.stringify({ publicBaseUrl: url }, null, 2));
      resolve(url);
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', () => { clearTimeout(timer); resolve(null); });
  });
})();

// Banner once the app answers (this also compiles /api/connect, so the first page load is quicker).
void (async () => {
  await tunnelUrl;
  for (let i = 0; i < 180; i++) {
    try {
      const info = await (await fetch(`${baseUrl}/api/connect`)).json() as { mcpUrl: string; localMcpUrl: string; isPublic: boolean };
      const line = '─'.repeat(72);
      console.log(`\n${line}\n  Aimo Planner is running\n`);
      console.log(`  Webshop + chat widget   ${baseUrl}/demo-host?demo=1`);
      console.log(`  Human approvals         ${baseUrl}/approvals`);
      console.log(`  MCP for Claude Code     ${info.localMcpUrl}`);
      console.log(info.isPublic
        ? `  MCP for claude.ai       ${info.mcpUrl}\n                          (Settings → Connectors → Add custom connector → paste the URL)`
        : `  MCP for claude.ai       (no public tunnel${tunnelWanted ? '; see the warning above' : ': AIMO_TUNNEL=0'})`);
      console.log(`${line}\n`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
})();

let stopping = false;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  rmSync(CONNECT_FILE, { force: true });
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

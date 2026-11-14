# Connect an agent to Aimo

The Aimo agent gateway is one MCP server, `aimo-gateway`, with two ways in:

| Transport | Where | Identity |
| --- | --- | --- |
| stdio | `npx tsx src/mcp/stdio.ts` (run from the repo root) | `AIMO_AGENT_KEY` environment variable |
| Streamable HTTP | `POST http://localhost:3100/api/mcp` (the Next.js app, any port you run it on) | `Authorization: Bearer <key>`, or `?key=<key>` in the URL for clients that take only a URL |

The demo keys are `aimo-demo-agent-key` and the connect key `sakdnkfbwjklebfkjABF` (`AIMO_CONNECT_KEY` overrides it), the one in the copy-paste link. It acts as `procurement-agent` buying for `helsinki-juhlapalvelu`, whose policy auto-approves orders up to €1,000 excl. VAT and sends the rest to Anna Virtanen (Purchasing manager). Set your own keys with `AIMO_AGENT_KEYS` (see `.env.example`). The customer always comes from the key, never from tool input.

Both transports serve MCP 2026-07-28 clients and 2025-era clients (the ones that open with `initialize`); `src/mcp/stdio.test.ts` checks the stdio side. The stdio entry depends on a Mastra internal, pinned to `@mastra/mcp` 2.9.0 / `@modelcontextprotocol/server` 2.4.0; re-run that test after upgrading either. The stdio server reads `VALIO_API_KEY`, `VALIO_API_BASE` and `ANTHROPIC_API_KEY` from `.env.local` in the repo root when the client doesn't pass them.

What each check below was verified with is noted in the section. "Not verified" means we couldn't click through that product's UI from here.

## Run the server

```bash
npm install
npm run dev                     # seeds on first run, app on :3100, public tunnel; prints every link
npx tsx src/mcp/stdio.ts        # or: stdio only (an MCP client normally starts this for you)
```

## claude.ai and Claude Desktop (copy-paste link)

Claude's custom connectors call from Anthropic's cloud and take only a URL, so `npm run dev` opens a cloudflared quick tunnel (`brew install cloudflared`; `AIMO_TUNNEL=0` turns it off) in front of `scripts/mcp-only-proxy.ts`, which forwards only `/api/mcp`, so `/approvals` and the other routes stay local. The link carries the connect key: `https://<random>.trycloudflare.com/api/mcp?key=sakdnkfbwjklebfkjABF`.

Copy it from the `npm run dev` banner, the **Aimo Claudessa** section on `/demo-host`, or the chat ("How do I connect Claude?"). In Claude: Settings → Connectors → Add custom connector → paste the URL. The tunnel URL changes on every `npm run dev`, so update the connector after a restart. A key in a URL ends up in proxy logs; this is for the demo key only.

## Plan from your calendar (Claude)

Aimo never reads a calendar itself; Claude does, with its own calendar connector. In claude.ai: Settings → Connectors → connect **Google Calendar** and add the Aimo link (above). Then use the `plan-my-calendar` prompt (the "+" menu → Aimo) or say "Plan my catering orders for the next 4 weeks from my calendar". Claude lists the events, calls `planFromCalendar`, asks every open question at once, and plans each event with `planEvent`. Other calendars: pass an iCal feed as `icsUrl` (a public https `.ics` address; recurring events are not expanded).

## Claude Code

Without touching your Claude Code settings, pass a config file per run:

```bash
cat > /tmp/aimo-mcp.json <<'JSON'
{ "mcpServers": { "aimo": { "type": "http", "url": "http://localhost:3100/api/mcp",
  "headers": { "Authorization": "Bearer aimo-demo-agent-key" } } } }
JSON
claude -p "Plan a wedding for 300 guests on 2026-12-05, chicken and rice, 12 gluten-free, then check out." \
  --mcp-config /tmp/aimo-mcp.json --strict-mcp-config \
  --allowedTools "mcp__aimo__planEvent,mcp__aimo__getDraft,mcp__aimo__updateDraft,mcp__aimo__checkoutDraft,mcp__aimo__getOrderStatus,mcp__aimo__listOrders"
```

For stdio, use `{ "command": "npx", "args": ["tsx", "src/mcp/stdio.ts"], "env": { "AIMO_AGENT_KEY": "aimo-demo-agent-key" } }` as the server entry and run `claude` from the repo root. To add it permanently instead, `claude mcp add --transport http aimo http://localhost:3100/api/mcp --header "Authorization: Bearer aimo-demo-agent-key"`; note that this writes to your Claude Code config.

Verified: the `claude -p` command above, over HTTP with a temporary config. Claude called `planEvent` then `checkoutDraft`; the draft came to €783.33 excl. VAT and was ordered within authority (VA-2026-99897), in 33 s. Round 1 also verified both `claude mcp add` forms (✔ Connected).

## Claude Desktop

Settings → Developer → Edit config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "aimo": {
      "command": "/bin/sh",
      "args": ["-c", "cd /path/to/Junction && npx tsx src/mcp/stdio.ts"],
      "env": { "AIMO_AGENT_KEY": "aimo-demo-agent-key", "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }
    }
  }
}
```

`cd` is there because Claude Desktop has no `cwd` setting and the server reads `data/` and `.env.local` from the repo root. Put the directory that holds `node` and `npx` (`dirname $(which npx)`) first in `PATH`. Restart Claude Desktop, then ask: "Use aimo: I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability." The `order-request` prompt (+ menu → aimo) fills that in for you.

Verified: the exact `/bin/sh -c "cd … && npx tsx src/mcp/stdio.ts"` launch, started from `/` with only `AIMO_AGENT_KEY` set, with a 2025-era (`initialize`) MCP client, including a live `getPriceAndAvailability` call. Not verified: the Claude Desktop UI itself.

## Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (this project):

```json
{
  "mcpServers": {
    "aimo": {
      "url": "http://localhost:3100/api/mcp",
      "headers": { "Authorization": "Bearer aimo-demo-agent-key" }
    }
  }
}
```

or stdio with `"command": "npx", "args": ["tsx", "src/mcp/stdio.ts"], "env": { "AIMO_AGENT_KEY": "aimo-demo-agent-key" }` in a project-level `.cursor/mcp.json`.

Not verified in the Cursor UI. The HTTP endpoint answers `initialize`, `tools/list` and `tools/call` for 2025-era clients (curl below), which is what Cursor sends.

## MCP Inspector

```bash
# UI: pick "Streamable HTTP", URL http://localhost:3100/api/mcp, add header Authorization: Bearer aimo-demo-agent-key
npx @modelcontextprotocol/inspector

# or stdio
npx @modelcontextprotocol/inspector -e AIMO_AGENT_KEY=aimo-demo-agent-key npx tsx src/mcp/stdio.ts
```

Not verified here: downloading and running the Inspector was blocked in the environment we built this in. The endpoint and stdio server it would talk to are verified (curl, Claude Code, and `scripts/gateway-demo.ts`).

## ChatGPT (developer mode connectors)

ChatGPT connects to remote MCP servers only, over public HTTPS.

> **Tunnel only `/api/mcp`.** In this prototype `/approvals` and `/api/approvals/*` have no login: anyone who can reach them can approve orders, an agent included. A tunnel to the whole app (`cloudflared tunnel --url http://localhost:3100`) would publish them. Put the MCP-only proxy in front instead.

1. Run the app: `npm run dev -- -p 3100`.
2. Run the MCP-only proxy: `npx tsx scripts/mcp-only-proxy.ts`. It listens on :3200, forwards `/api/mcp` to the app and answers 404 for everything else.
3. Tunnel the proxy, not the app: `cloudflared tunnel --url http://localhost:3200` (prints `https://<random>.trycloudflare.com`), or `ngrok http 3200`.
4. In ChatGPT: Settings → Apps & Connectors → Advanced → turn on Developer mode, then create a connector with URL `https://<random>.trycloudflare.com/api/mcp`. Use bearer-token / API-key authentication with your agent key if your ChatGPT version offers it; without a key the gateway answers 401.
5. In a chat, enable the connector and ask for the lactose-free milk or the wedding.

Use a throwaway key (`AIMO_AGENT_KEYS`) and stop the tunnel afterwards: anyone with the URL and the key can place (simulated) orders. Browser pages on other sites are refused by the gateway's Origin check (add origins with `AIMO_ALLOWED_ORIGINS` if a browser client needs them).

Verified: the proxy (404 for `/approvals` and `/api/approvals`, `tools/list` through `/api/mcp`). Not verified: we didn't open a public tunnel or use the ChatGPT UI from here.

## curl (Streamable HTTP)

```bash
H=(-H 'Authorization: Bearer aimo-demo-agent-key' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream')

# initialize (2025-era handshake; each request is stateless)
curl -s -X POST http://localhost:3100/api/mcp "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# list tools
curl -s -X POST http://localhost:3100/api/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# call a tool
curl -s -X POST http://localhost:3100/api/mcp "${H[@]}" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"getPriceAndAvailability","arguments":{"productIds":["464306"],"deliveryDate":"2026-11-16"}}}'

# read the policy resource
curl -s -X POST http://localhost:3100/api/mcp "${H[@]}" -d '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"aimo://policy"}}'

# no key → 401 with WWW-Authenticate: Bearer
curl -si -X POST http://localhost:3100/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Responses come back as one server-sent event (`event: message`, `data: {…}`). Verified: all five against the dev server.

## A headless external agent

```bash
npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --event   # wedding: planEvent → updateDraft → checkoutDraft → listOrders
npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts           # 1,000 l → pending approval if over the limit (says so if not; --over)
npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --small   # 100 l → ordered within authority
npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --http    # same, over http://localhost:3100/api/mcp
npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --llm     # Claude picks and orders through the same tools
```

Then open http://localhost:3100/approvals to approve or reject. The agent sees the result with `getOrderStatus`. Set `AIMO_BASE_URL` if the app is not on http://localhost:3100. To keep demo runs out of the app's database, set `AIMO_DB_PATH` to another file (and `npm run seed` it) for the stdio runs.

## Choosing the model

All Aimo agents (the orchestrator behind `chatWithAimo`, the specialists, and `gateway-demo.ts --llm`) use `AIMO_MODEL`, a Mastra model-router string. The default is `anthropic/claude-opus-5-5`. `openai/<model>` works with `OPENAI_API_KEY` set. The Opus-specific settings (the `effort` provider option and prompt caching) are only sent to Anthropic models; no agent forces a tool choice.

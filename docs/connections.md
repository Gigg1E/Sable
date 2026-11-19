# Connections the agent builds itself

Sable doesn't need a built-in integration for every service. When you ask about an account or API it can't reach yet, it **builds the connection itself**, and you approve it once.

## The flow

You ask: *"How much did AWS cost me this month?"*

1. **Research.** Sable reads the service's official API docs (web search + page reading) to get the real address and sign-in method. It doesn't guess from memory.
2. **Define.** It proposes a connection: a name (`aws`), the server, how it signs in, which methods only read, and what it's for.
3. **Approve.** A **New connection** card shows all of that, plus the docs page it used. Nothing exists until you press **Create connection**.
4. **Credential.** Sable tells you exactly what key to create, with the least access needed (e.g. "an IAM user with only `ce:GetCostAndUsage`"). You paste it into the **secure field** in the chat, or in **Settings → Connectors → Connections**. Never paste keys into the chat itself.
5. **Use.** From then on Sable calls it like any other tool, in every conversation.

## Who sees the key?

| | Sees it? |
|---|---|
| You | Yes, you created it |
| Your server's vault | Stored **encrypted** (AES-256-GCM). The key to the vault is `data/vault.key`, or `SABLE_VAULT_KEY` |
| The request to that service | Added at the moment of the call, nothing else |
| **The AI model** | **Never.** It only knows the connection's name |
| Chat history, activity log, replies | Never. If a service echoes the key back, it's replaced with `[REDACTED]` |

## Guardrails

- **Locked to one server.** A connection's key is only ever sent to its own host. If a web page tricks the model into "call `aws` at evil.example", it's refused. Redirects aren't followed with the key attached.
- **Reading is free, changing asks.** Read methods (GET, HEAD by default) run on their own. Anything that changes something in your account (POST, PUT, PATCH, DELETE) asks you each time. Some APIs read with POST (AWS JSON APIs, GraphQL). For those the card shows POST as a read, so pair it with a **read-only key**.
- **HTTPS only.** Keys can't go in the URL definition.
- **Changing where a connection points drops its key**, so a key can't follow it to a new server.
- **Everything is logged** in Activity (calls, approvals, denials), never the key itself.
- **Removable.** The trash icon in Settings → Connectors → Connections deletes the connection and its key, or ask Sable to remove it.

## Sign-in styles

| Style | How the key is sent | Examples |
|---|---|---|
| Bearer token | `Authorization: Bearer <token>` | GitHub, Cloudflare, Stripe, most modern APIs |
| API key header | a custom header, e.g. `X-Api-Key` | many SaaS tools, home-lab apps |
| API key in URL | `?api_key=<key>` | older or simple APIs |
| Username and password | HTTP Basic, entered as `username:password` | routers, NAS boxes, older services |
| AWS signed requests | AWS Signature V4, entered as `ACCESS_KEY_ID:SECRET_ACCESS_KEY` | every AWS service (Cost Explorer, S3, EC2, Route 53…) |
| None | nothing | public APIs |

## What it can't do

Some services have **no API for personal accounts**, e.g. your Amazon shopping order history. Sable says so instead of inventing one, and suggests another route. For Amazon, that's watching your **order and shipping emails** with an email watcher.

## Backups

Back up `data/vault.key` along with the rest of your data volume. Without it, stored keys can't be decrypted and you'd re-enter them.

# Sable mail: your domain's mailbox, inside Sable

Sable keeps your domain's mail itself: storage, addresses, the rules about who can give it instructions, threads, sender profiles, and a DNS checklist. You manage all of it in **Settings → Mail** and on the **Mail** page.

Two hand-offs go through services built for them, because a home connection can't do them reliably. Xfinity residential blocks outgoing mail on port 25, and big providers distrust mail sent from home IPs.

```
someone@work.com ──► Cloudflare Email Routing ──► your Email Worker ──► Cloudflare Tunnel ──► Sable /mail-in
                                                     │ (Sable offline)
                                                     └──► forwarded to your backup address

Sable reply ──► SMTP relay (Resend / SES / SMTP2GO / Postmark) ──► signed (DKIM), delivered
```

- **Nothing on your router opens.** The tunnel is an outbound connection from your server to Cloudflare. Only `/mail-in` and the public page are reachable through it: it points at Sable's *public* listener, which serves nothing else.
- **Your Sable app stays private** on Tailscale.

## What Sable does with mail

- **The agent address** (for example `sable@yourdomain.com`) takes instructions, but only from addresses on your **allowlist**, and only when Cloudflare verified the sender.
  - **Verified** means DMARC pass, or DKIM pass with the signing domain matching the From domain.
  - **What happens:** each email thread becomes a chat. Sable works on it and emails the answer back in the same thread. Anything that needs approval asks in the app.
  - **Everything else is held:**
    - strangers
    - mail that claims to be from you but fails verification (you get a notification)

    Held mail is never acted on. Review it on Mail → **Held**: move it to the Inbox, or **Trust this sender**, which adds them to the allowlist.
- **Personal addresses** are mailboxes for you. Sable can search, read and watch them like any other mailbox, and you get a notification for new mail.
- **What Sable sends:**
  - It all goes through the relay, with proper threading headers.
  - Secrets are scrubbed first.
  - Limits apply: 20 an hour and 60 a day by default, adjustable.
  - Sable never auto-replies to strangers.
- **The email tools** (`email_search`, `email_read`, `email_send`) and **email watchers** work with Sable mail addresses, and new mail wakes watchers instantly.
- **Sender profiles** (Mail → **Senders**):
  - Sable learns as mail comes and goes: a category (personal, work, school, shopping, money, newsletter…), how often they write, and how often you reply.
  - After a few messages, it writes a one-line profile of who they are to you and what they send.
  - Mail is private: a cloud model only sees it with personal details removed.
  - You can change any sender's category.

## Setup, once (about 30 minutes)

### 1. Cloudflare Email Routing (receiving)
1. Cloudflare dashboard → your domain → **Email** → **Email Routing** → **Get started / Enable**. Cloudflare adds its MX and SPF records for you.
2. Under **Destination addresses**, add and verify your **backup address** (for example your Gmail). It's only used when Sable is offline.

### 2. The Email Worker
1. Cloudflare → **Workers & Pages** → **Create** → **Worker** ("sable-mail"). Replace the code with [`deploy/cloudflare-mail-worker.js`](../deploy/cloudflare-mail-worker.js) and **Deploy**.
2. Worker → **Settings → Variables and secrets**:

   | Name | Value |
   |---|---|
   | `SABLE_URL` | `https://mail.yourdomain.com/mail-in` (the tunnel hostname from step 3) |
   | `SABLE_SECRET` (type **Secret**) | From Sable → Settings → Mail → Receiving → **Create / Show** |
   | `BACKUP_FORWARD` | Your verified backup address (optional) |

3. Email Routing → **Routing rules** → **Create address**: `sable@yourdomain.com` → action **Send to a Worker** → `sable-mail`. Do the same for each personal address, or use the **catch-all**.

### 3. Cloudflare Tunnel (no ports opened)
1. In Sable's `.env`, set `SABLE_PUBLIC_PORT=8790`. This is the public listener: a blank page, webhooks and `/mail-in` only. Restart Sable.
2. Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflared). Copy its token.
3. Run the connector next to Sable. In `deploy/docker-compose.yml`, add:
   ```yaml
   cloudflared:
     image: cloudflare/cloudflared:latest
     command: tunnel --no-autoupdate run
     environment:
       - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
     restart: unless-stopped
   ```
   Put `CLOUDFLARE_TUNNEL_TOKEN=…` in `deploy/.env` (never commit it).
4. In the tunnel's **Public hostname** tab, add `mail.yourdomain.com` → service `http://sable-a:8790` (your Sable service's name in the compose file; `http://host.docker.internal:8790` if it runs outside it).
5. Check it: `curl -X POST https://mail.yourdomain.com/mail-in` should return **404**. That's correct: no secret, no entry.

### 4. A sending relay
Pick one and add your domain there. Each gives you DNS records (DKIM and sometimes a return-path):

| Relay | Free tier (check current pricing) | In Sable |
|---|---|---|
| **Resend** | ~3,000 a month | host `smtp.resend.com`, port 465, user `resend`, password = API key |
| Amazon SES | Pay per use, very cheap | SMTP credentials from SES; region host |
| SMTP2GO | ~1,000 a month | an SMTP user you create |
| Postmark | Trial, then paid | Server API token as user and password |

Then in Sable → Settings → Mail → **Sending**: choose the relay, fill in the credentials, set the **DKIM selector** it shows you (for example `resend`), and **Save and send a test to me**.

### 5. DNS (Cloudflare → DNS), and the checklist in Sable
Sable's **DNS** card checks these live:
- **MX**: added by Email Routing (`route1/2/3.mx.cloudflare.net`).
- **SPF**: one TXT record on the root that allows both Cloudflare and your relay. For example:
  `v=spf1 include:_spf.mx.cloudflare.net include:amazonses.com ~all`. Use your relay's include. Keep a single SPF record.
- **DKIM**: the record(s) your relay gave you.
- **DMARC**: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`. After 2–4 weeks of clean reports, tighten it to `p=quarantine`.

### 6. Turn it on
In Settings → Mail:
1. Set your **domain**.
2. Add `sable@yourdomain.com` as the **Agent** address.
3. Add your work, school and personal addresses to the **allowlist**.
4. Switch **Sable mail** on.
5. Email the agent address from an allowlisted account. You should get an answer in the same thread.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Your email went to **Held** as "failed verification" | Your work/school provider didn't pass DMARC for that message, or Cloudflare's results header isn't the one Sable trusts. Open it in Held and check the verification chip. The trusted receiver is `mx.cloudflare.net` by default. |
| Nothing arrives at all | Worker logs (Cloudflare → Worker → Logs). A 404 means the secret doesn't match. Connection errors mean the tunnel is down; check `docker compose logs cloudflared`. |
| Replies go to spam | The DKIM/SPF/DMARC checks aren't green yet, or the domain is brand new. Send a few normal messages first. |
| "Sending limit reached" | Raise the hourly or daily limit in Settings → Mail if the volume is expected. |
| The work account blocks it | Some employers and schools block or flag automated mail. Their policy wins. Use a personal address in that case. |

**Unverified:** exactly how Cloudflare records its checks in the message a Worker receives. Sable reads both `Authentication-Results` and `ARC-Authentication-Results` from `mx.cloudflare.net`. If verified mail from you still lands in Held, open it and check the headers, or ask Sable to look.

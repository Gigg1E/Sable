# Email on your own domain: research and setup guide

*Researched 2026-11-20 for a Florida home on AT&T, with Sable reachable only over Tailscale. Items marked **unverified** need checking.*

## Update (2026-11-20)

**Correction:** your home internet is **Xfinity**, not AT&T (AT&T is your phone). The advice doesn't change: Xfinity residential is also widely reported to block outgoing port 25, and home IPs have the same reputation problems (**unverified** for Xfinity's current policy).

**What you already have:**
- Your domain's DNS is on **Cloudflare**, with email already working.
- A small mail service runs on your **desktop**, behind Proton VPN in Docker, for another AI project. It only accepts mail from your own addresses and blocks everything else. That's exactly the allowlist rule below.

**The only weakness** is that it lives on your desktop, so it's down when the desktop is.

**The plan for Sable's mailbox:**
- **Reuse what you built.** Either move that service (or a copy) to one of your spare always-on computers, or have mail land in an off-site mailbox first so nothing is lost while a machine is down.
- Sable then reads it with its existing email connector.
- **To decide together:** show me how the current service receives mail (Cloudflare Email Routing to a Worker, forwarding, or something else). Then I can write exact steps.

## The short version

- **Don't run the mail server at home.**
  - AT&T home lines have long blocked outgoing port 25. Their current policy is **unverified**, but AT&T forum threads up to 2019 show it.
  - AT&T only sets reverse DNS for paid static IPs.
  - Home IP ranges are on Spamhaus' "shouldn't send mail" list, which Microsoft is reported to block outright.
  - When your server is down, incoming mail would bounce.
- **Keep the mailbox off-site and have Sable fetch it.** Sable connects *out* to the mail server (IMAP or JMAP to read, SMTP to send), so nothing at home has to open to the internet. Sable stays Tailscale-only.
- **Easiest: Fastmail** (about $60 a year; Migadu or Purelymail are cheaper). **Most private: Stalwart (or Mox) on a small VPS** that's on your tailnet.

## Options

| Option | Privacy | If your home server is down | Cost per year | Effort |
|---|---|---|---|---|
| **Fastmail** | Provider can read stored mail; no ads | Mail waits safely | ~$60 | Very low. IMAP/SMTP and **JMAP** (a modern mail API that suits an agent), app passwords, API tokens |
| Migadu | Swiss, EU-hosted, readable by the provider | Waits | ~$19 (small daily send cap) | Low |
| Purelymail | Very small operator | Waits | ~$10 | Low |
| Proton Mail | Encrypted at rest | Waits | ~€48 | Medium: IMAP needs **Proton Bridge** running as a service, which puts decrypted mail on your server anyway. Clunky for the agent |
| **Self-hosted on a VPS** (Stalwart 1.0, Mox, Mailcow, Mail-in-a-Box, docker-mailserver) | You run the software; the VPS company could still read the disk | VPS is independent of home | VPS ~$60–100 | Medium-high: updates, IP reputation, backups |
| Cloudflare Email Routing + Workers | Cloudflare processes every message | Routing **forwards, doesn't store**, so mail bounces if the destination is down | $0+ | High, and it needs a public path to Sable. Not recommended |

**Self-hosted software:**
- **Stalwart 1.0** (first stable release, late October 2026) is one program for SMTP, IMAP, JMAP, CalDAV and CardDAV. DKIM and spam filtering are built in. Which features need its paid license is **unverified**.
- **Mox** (v0.0.17) is a small Go program that automates DNS, DKIM, MTA-STS and DMARC reports.

**VPS providers and port 25** (needed to send mail):

| Provider | Port 25 |
|---|---|
| OVH | Open by default (**unverified**) |
| Vultr | Unblocked on request |
| Linode | Unblocked on request after setting reverse DNS |
| Hetzner | Possible after the first invoice (**unverified**) |
| DigitalOcean | Blocked; avoid for mail |

**What the big providers require, even at low volume:**
- **Gmail, any sender:** SPF or DKIM, matching forward and reverse DNS, TLS, and spam below 0.3%.
- **Gmail, Microsoft and Yahoo for bulk senders** (5,000+ a day): SPF, DKIM and an aligned DMARC.
- **In practice:** set SPF, DKIM, DMARC and reverse DNS no matter how little mail you send.

## Setup checklist

This is for a hosted provider. Steps marked **(VPS)** are extra if you self-host.

1. **Before you start:** check what DNS the domain already has (MX, SPF, any Google records). Lower the TTLs.
2. **Mailboxes:**
   - `sable@yourdomain` as its own mailbox, not an alias of yours.
   - Your personal addresses.
   - Turn on plus-addressing (`sable+anything@`).
3. **MX:** point at the provider's mail servers.
4. **SPF:** `v=spf1 include:<provider> -all`. Keep it under 10 lookups.
5. **DKIM:** add the provider's CNAME records. **(VPS)** Publish Stalwart's RSA and Ed25519 keys.
6. **DMARC:**
   - Start with `_dmarc TXT "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain; adkim=s; aspf=s"`.
   - After 2–4 clean weeks, change to `p=quarantine`, then `p=reject`.
7. **MTA-STS and TLS reports:**
   - `_mta-sts TXT "v=STSv1; id=2026112001"`.
   - A policy file at `https://mta-sts.yourdomain/.well-known/mta-sts.txt`, mode `testing`, then `enforce`.
   - `_smtp._tls TXT "v=TLSRPTv1; rua=mailto:tlsrpt@yourdomain"`.
8. **(VPS) Reverse DNS:** set it to `mail.yourdomain` at the VPS company. Its A record must match, and the server must introduce itself (HELO) with that name.
9. **Client autoconfig:** the provider's SRV and CNAME records. Stalwart and Mox generate these.
10. **Test:**
    - [mail-tester.com](https://www.mail-tester.com) (aim for 10/10), [learndmarc.com](https://www.learndmarc.com), MXToolbox and internet.nl.
    - Send to Gmail and check **Show original**: SPF, DKIM and DMARC should all say PASS. Send to Outlook.com too.
    - Send from your work and school accounts. They may quarantine a brand-new domain at first.
11. **Give Sable access:** an **app password or a JMAP token for the agent mailbox only**, stored in Sable's vault. Never your main password.
12. **How Sable connects:** this is already built. Settings → Connectors → Email → Custom, using the provider's IMAP and SMTP hosts.
    - IMAP IDLE notices new mail within seconds.
    - Sable remembers its place in the inbox and does a full check after outages.
    - Replies thread with `In-Reply-To` and `References`.
    - **Planned:** move handled mail to a "Processed" folder, and JMAP for Fastmail and Stalwart.
13. **Backups:**
    - Nightly `mbsync` or `imapsync` from a spare computer into an encrypted restic or Borg repo.
    - **(VPS)** Also back up Stalwart's data and DKIM keys.
    - Keep a copy of your DNS zone.

## Safety rules for an agent mailbox

These become Sable's behavior for the agent address:

- **Who can command Sable:**
  - **Allowlist** the exact addresses allowed to give Sable instructions: your work, school and personal addresses. Everything else goes to a holding folder and is never acted on.
  - **Verify every message:** trust it only if *your provider's* top `Authentication-Results` header says `dmarc=pass` (or `dkim=pass` with the From domain) **and** the sender is on the allowlist. Forged headers lower down are ignored.
  - **Optional secret address:** for example `sable+<random>@`, required for commands.
- **What Sable does with the content:**
  - Email text is **data, not instructions**. Nothing in an email can approve sending, deleting or sharing files; that needs your tap.
  - Avoid sending sensitive things out by email. Email between providers is encrypted in transit at best, never end-to-end.
- **Sending limits:**
  - **No automatic replies to unknown senders.** No auto-reply, out-of-office or bounce to strangers, so the address can't be used to spam.
  - **Rate limits**, for example 20 sends an hour and 50 a day, and only to allowlisted recipients unless you approve.
  - Every send is logged, and revoking the app password is the kill switch.

## Questions for you

- **Domain:** who hosts its DNS (Cloudflare makes MTA-STS easy)? Does it already have mail records?
- **Budget:** about $10–60 a year hosted, or about $60–100 a year for a VPS?
- **Addresses:** how many personal ones do you want on the domain?
- **Who Sable can email:** should it be able to email *anyone*, or only you?

## Sources

- AT&T port 25: [AT&T forum](https://forums.att.com/t5/AT-T-Internet-Email-Security/Port-25-Things-to-know-from-AT-amp-T/m-p/5295130) · [Unblocking thread](https://forums.att.com/t5/AT-T-Fiber-Account/Unblocking-port-25-2018-version/m-p/5897010/highlight/true) · [Spamhaus PBL](https://www.spamhaus.org/faq/section/Spamhaus-PBL)
- Sender rules: [Gmail sender guidelines](https://support.google.com/a/answer/81126) · [Outlook high-volume requirements](https://techcommunity.microsoft.com/blog/outlook/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)
- Providers: [Fastmail](https://www.fastmail.com/pricing) · [Migadu](https://migadu.com/pricing/) · [Purelymail](https://purelymail.com/pricing) · [Proton IMAP/Bridge](https://proton.me/support/imap-smtp-and-pop3-setup)
- Self-hosting: [Stalwart 1.0](https://www.linuxtoday.com/blog/stalwart-1-0-open-source-mail-server-reaches-its-first-stable-release/) · [Mox](https://xmox.nl/)
- VPS port 25: [Vultr](https://docs.vultr.com/support/products/compute/why-is-smtp-blocked) · [DigitalOcean](https://docs.digitalocean.com/support/why-is-smtp-blocked/) · [Akamai/Linode](https://techdocs.akamai.com/cloud-computing/docs/send-email)
- Cloudflare: [Cloudflare email for agents](https://blog.cloudflare.com/email-for-agents)

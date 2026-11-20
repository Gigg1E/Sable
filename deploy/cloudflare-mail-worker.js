/**
 * Sable mail: a Cloudflare Email Worker (docs/mail.md).
 *
 * Cloudflare Email Routing receives mail for your domain and hands each message to this Worker,
 * which posts the raw message to Sable through your Cloudflare Tunnel. If Sable can't be reached,
 * the message is forwarded to your backup address so nothing is lost.
 *
 * Worker settings (Settings → Variables and secrets):
 *   SABLE_URL       https://mail.yourdomain.com/mail-in   (your tunnel hostname + /mail-in)
 *   SABLE_SECRET    the inbound secret from Sable → Settings → Mail   (add it as a *secret*)
 *   BACKUP_FORWARD  you@gmail.com   (optional, must be a verified destination in Email Routing)
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    try {
      const res = await fetch(env.SABLE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'message/rfc822',
          'x-sable-mail-secret': env.SABLE_SECRET,
          'x-envelope-from': message.from,
          'x-envelope-to': message.to,
        },
        body: raw,
      });
      if (res.ok) return;
      throw new Error(`Sable answered ${res.status}`);
    } catch (err) {
      console.log('Sable unreachable:', String(err));
      if (env.BACKUP_FORWARD) {
        await message.forward(env.BACKUP_FORWARD);
      } else {
        // A temporary failure would be ideal, but Email Workers can only reject; the sender gets a bounce.
        message.setReject('Mailbox temporarily unavailable, please try again later');
      }
    }
  },
};

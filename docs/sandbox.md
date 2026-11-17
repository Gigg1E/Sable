# Chat folders and the script sandbox

## Where files live

Every chat has its own folder on the server:

```
data/workspace/
  chats/<chat id>/        one folder per chat, named by the chat's permanent ID (renaming a chat changes nothing)
    uploads/              files you attached in that chat
    outputs/              finished files: anything saved here appears in the chat with a Download button
    …                     the agent's scratch work
  shared/                 files meant for every chat (older files were moved here)
```

- The agent's file tools and scripts work inside the chat's folder and can't open another chat's folder.
- **outputs/ is the hand-over folder.** Whether the agent writes a file or a script makes one (a .docx, a chart, a spreadsheet), saving it under `outputs/` puts a live file card in the chat. You don't depend on the agent remembering to "show" it.
- Files elsewhere in the folder stay out of the chat unless the agent shows them (`show_file`).

## The script sandbox (recommended with Docker)

Without the sandbox, scripts run inside the Sable container. That container also holds Sable's database, with your API keys and account logins, so every script asks for your approval first.

With the sandbox, scripts run in a separate **runner** container (`runner/`):

| | Without sandbox | With sandbox |
|---|---|---|
| Can a script read Sable's database or keys? | Technically yes, which is why every run asks first | **No**: the runner only sees the workspace folder |
| Approval before each script | Yes (default) | Not needed by default (you can still set *Run script* to *Ask*) |
| Preinstalled libraries | Whatever the server has | python-docx, openpyxl, matplotlib, pandas, pypdf, reportlab, Pillow, requests, BeautifulSoup, Node.js |
| Limits | Timeout only | Timeout, 2 GB memory, 2 CPUs, 256 processes, read-only system, no Linux capabilities |

The runner can see **all** chat folders of its Sable (one shared workspace volume), but nothing else.

### Turn it on

It's already in both compose files. You need **Docker Engine 26+ / Docker Compose 2.30+**, because the runner mounts only the `workspace` subfolder of Sable's data volume. Check with `docker version`.

**Single install** (`docker-compose.yml` in the repo root):

```bash
echo "RUNNER_TOKEN=$(openssl rand -hex 16)" >> .env    # optional but recommended
docker compose up -d --build
```

**Multi-person deploy** (`deploy/`): set `RUNNER_TOKEN_A` and `RUNNER_TOKEN_B` in `deploy/.env` (one random string each), then `docker compose up -d --build`. Each person gets their own runner, which sees only their own workspace.

To check it works, ask Sable: *"Make a small Word document saying hello and give it to me."* A `.docx` card with a Download button should appear.

### Turn it off

Remove `SABLE_RUNNER_URL` and `SABLE_RUNNER_TOKEN` from the `sable` service's environment (and the `runner` service), then `docker compose up -d`. Scripts go back to running inside Sable, with an approval each time.

### Older Docker (no volume subpath)

Upgrade Docker if you can. If not, you can mount the whole data volume into the runner (`- sable-data:/data` and `RUNNER_WORKSPACE=/data/workspace`), but then scripts *could* read Sable's database again, which defeats the point. Without subpath support, it's better to leave the sandbox off and keep approvals on.

### Internet from scripts

The runner has normal internet access, so `pip install --user` and downloads work. Installed packages persist in `workspace/.home`. To send script traffic through the VPN option, add `HTTP_PROXY` / `HTTPS_PROXY` to the runner's environment (see the VPN section in the README).

# Research: Meta Muse (personal AI agent), reference for Sable

Researched 2026-11-16. Meta's own product page is rendered by JavaScript and could not be read, so the
Meta-authored claims below come from the App Store listing. Most other detail comes from third-party
write-ups. Those sources sometimes conflict, and some sell competing products. Confidence is marked as:
**[Meta]** for the App Store listing, **[multi]** when several secondary sources agree, and **[single]** for one source only.

## What it is
- A personal AI agent app. Meta launched it on 2026-09-08 (US first). You give it an outcome in chat.
  It plans the steps, works in the background, and checks with you before consequential actions. **[multi]**
- Not to be confused with **Muse Spark** (the model family behind it), **Muse Image** (image generation and
  Instagram story effects) or **Muse Code** (a terminal coding agent). **[multi]**
- Runs on iOS, iPad, Apple Watch, Android, web (muse.ai), WhatsApp and Mac. **[Meta]/[multi]**

## Feature inventory

### 1. Chat and goals
- Chat is the main interface: "Describe what you want in chat." **[Meta]**
- Goals and multi-step jobs: "Hand Muse a whole job and it sees it through." It builds a plan, tracks progress and does the work. **[Meta]**
- Background execution: "keeps things moving after you close the app" and sends a push notification when it needs you. **[Meta]**
- Voice mode: real-time voice with a custom avatar, either audio only or animated video. You can change the voice through chat. **[Meta]**
- You can name the agent and shape how it communicates. **[Meta]**

### 2. Approvals and trust
- "Approve actions before they happen." It checks before it spends money, cancels something, sends a message or deletes. **[Meta]**
- A full activity log covers what it did and what it plans to do. You can revoke any connector at any time. **[Meta]**
- A usage meter for free-tier tokens, and extra tokens can be bought. **[Meta]**

### 3. Actions it can take
- Email and messages: drafting, sending, following up and invitations. You set read-only or read-and-send access. **[multi]**
- Calendar: resolves scheduling conflicts and sets reminders. **[Meta]**
- Web automation: browses sites, fills in forms and books appointments, flights, hotels and restaurants. **[Meta]**
- Shopping: compares prices, tracks price drops and buys "with your OK". It pays with a one-time card through Link by Stripe. **[Meta]/[multi]**
- Saving money: tracks expenses, audits and cancels subscriptions, and negotiates bills. **[Meta]**
- Health: workout and meal plans built from shared health or fitness data. **[Meta]**
- Phone calls to businesses (US beta). **[multi]**
- Small business: reads Instagram business and Facebook Page analytics and Meta ad accounts, and handles orders and customer messages. **[Meta]**
- Social: turns saved Instagram posts or reels into tasks, for example a grocery list built from a recipe reel. **[multi]**

### 4. Spaces (generated mini-apps)
- You describe a tracker, dashboard, planner or mood board, and Muse builds it as a custom view. **[Meta]**
- Spaces can be pinned to the sidebar or tabs, swapped out, and kept up to date from connected apps. **[Meta]/[single]**

### 5. Connectors
- Core: email (Gmail, Outlook), calendar, Instagram, Facebook, WhatsApp, health and fitness, and finances (Plaid). **[Meta]/[multi]**
- Productivity and business: Notion, Asana, Canva, Dropbox, Figma, QuickBooks, GitHub, Klaviyo, Zoom, Granola,
  Slack, Shopify, Google Docs, OpenTable, Spotify and Apple Music. **[Meta]/[multi]**
- Where no connector exists, it falls back to its own browser. Third parties can submit connectors for review. **[multi]**

### 6. Memory and personalization
- Remembers preferences and makes suggestions without being asked. You can tell it to "forget X". **[single]**
- Meta's own leadership has called memory a weak spot. **[single]**

### 7. Security architecture
- Each user gets a cloud VM with its own browser and filesystem, where the agent runs. **[multi]**
- **Sentinel**: a separate policy agent. It allows, blocks or escalates every action that leaves the VM, and every new outbound destination. **[multi]**
- The agent cannot see credentials or payment details. Logins sit in a vault it cannot read. **[multi]**
- A "Confidential VM" (encryption key held only by the user) has been announced but has not shipped. **[multi]**

### 8. Mac app
- Works across Files, Mail, Messages, Calendar and Notes. Later reports say it can drive any app, with permission. **[multi, conflicting]**
- Continues a task across phone, laptop and WhatsApp. **[single]**

### 9. Pricing
- Free tier with a usage meter. Power costs $20/month and Maximum $100/month. Extra tokens can be bought. A card is reportedly required at sign-up. **[multi]**

## Known problems (worth designing around)
- Approval prompts annoy people, so trust levels need tuning.
- Amazon blocked the agent for not identifying itself as an agent. Agents should declare themselves in their user agent and on calls.
- Some beta phone calls were secretly handled by human workers, which drew backlash.
- About 6,800 shared-chat links were exposed through public DNS records. Shared links should be unguessable, and the feature should be opt-in.
- Users complained that it read private DMs on the Mac. Scopes need to be explicit.
- It could only see the first frame of Instagram videos.

## Implications for Sable (to decide before coding)
Sable will be its own product with similar mechanics, without Meta's names, branding or look.
A minimal version that matches the core loop:
1. Chat with an LLM agent that plans goals as steps (a task and goal model).
2. Tool calling with a connector framework: start with email and calendar, then a web browser.
3. Approval gate: risky actions pause the agent until the user approves, plus an activity log.
4. A background worker queue, so tasks keep running after the user leaves, with notifications.
5. Memory store: preferences and facts, editable and forgettable.
6. Spaces: the agent generates JSON or HTML widgets that are pinned and refreshed.
Later: voice, a sandboxed browser VM with an egress policy agent, payments, phone calls, a Mac app.

## Sources
- App Store listing: https://apps.apple.com/us/app/muse-from-meta/id6760173601
- https://www.cnbc.com/2026/09/08/meta-personal-ai-agents-public-reckoning-privacy-safety.html
- https://codersera.com/blog/meta-muse-ai-agent-app-guide-2026/
- https://www.taskade.com/blog/history-of-meta-muse
- https://www.fieldy.ai/blog/meta-muse
- https://www.datacamp.com/blog/muse-agent
- https://www.techradar.com/ai-platforms-assistants/i-tried-metas-new-muse-spark-ai-model-and-it-feels-like-chatgpt-built-for-the-social-internet
- https://www.emarketer.com/content/meta-debuts-muse-spark-power-ai-across-its-apps-raise-stakes-ai-driven-discovery

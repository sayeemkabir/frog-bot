# How Grok Bot works, and how Frog Bot matches it

Research from xAI's announcement, two written guides and nine YouTube walkthroughs
(each explained by Gemini). Frog Bot copies the working mechanism, not the code or
the look, and keeps its own promise: everything lives on your computer.

Sources: x.ai/news/introducing-grok-bot · composio.dev guide · YouTube:
q1IwR88mhaA, j0Pqe8c07vY, NyfYxpXiw_0, c9_SR0d1LLk, YMBSVt3IOTI, N-1kkt1zXkA,
O5bHcw_EHQs, A3-qLhe46Dw, fcrpszN2Q7Y.

## 1. The team model

| Grok Bot | Frog Bot |
|---|---|
| Bots are teammates in a left sidebar, one thread each; green presence dot; hover shows what a bot is doing right now | Same. Presence dot (working / waiting / idle) and a one-line live status under each name |
| A **Chief of Staff** you talk to. It interviews you, proposes specialists, creates them, then dispatches | **Frog** is the Chief of Staff: proposes and creates specialists (with your OK), splits jobs, runs them in parallel, compiles one brief |
| "Bots pass work, not responsibility": the chief never does specialist work and never approves for you | Frog delegates by default; the brief ends with a **Needs your approval** list |
| Specialists each own one lane and one deliverable, with one stop line | Agent = name, role line, instructions, mode, apps |
| Bots message each other directly ("Message from Chief of Staff" tag) and in group chats with @mentions | `message_agent` (shows "From Frog"), groups, and `@Name` in a group wakes that agent there |
| Group chats of 2–6 bots; one composite instruction fans out ("Scout: … Quill: … Atlas: collect") | One message can address several agents; each named agent works in parallel in the group |
| Bots can create the specialists and threads they need | Agents can `create_group` with chosen teammates and a goal, then work it out together |

## 2. Getting work done fast

- **Connectors and APIs before clicking around websites** (top speed tip in every source). Frog: built-in fast tools (web search, fetch a page, read files, run commands) and app connections first; the browser only when a site has no other way in.
- **Parallel by default**: many bots at once; the chief fans out, then waits for results. Frog: each agent has its own queue and its own browser (Grok bots share one browser, which the 5-bot video names as a bottleneck).
- **Background sub-work**: the main bot hands slow research to a helper and keeps talking to you.
- **State files**: bots save outputs to their folder and compare with yesterday instead of starting blind.
- **No cold starts**: Frog keeps app connections and the browser warm between messages.
- **Compaction**: long threads are summarised in the background so they stay fast.

## 3. Doing things like a person

- Each bot has its own computer: browser, files, terminal. You can open it and watch.
- **Logins**: bots sign in through their browser. Frog: an **Open browser** button to log in once (it stays logged in), and agents may type logins you give them in chat.
- **Human takeover**: for passwords, 2FA codes and CAPTCHAs, you take over the bot's browser, finish the step, and hand it back.
- **Teach a Task**: you do it once in the bot's browser while it watches; it writes a numbered routine it can repeat. (Later.)
- **Routines**: scheduled or event-triggered jobs that run without you (Frog: schedule_task).

## 4. When it asks you

- Only for judgment calls and high-stakes actions: spending money, sending externally, publishing, deleting. Everything else keeps going.
- An **approvals queue** collects these; the user reviews drafts and approves.
- Frog modes: **Ask first**, **Auto** (never asks for normal work, only for things that wipe data), **Plan** (plans, changes nothing).

## 5. Look and feel

- Restrained, professional, dark-first "corporate team chat, not a toy".
- Clean sans-serif type, distinct message separation, accent colours used sparingly per bot.
- Avatars: generated icons or uploaded images, shown crisply; no emoji confetti in the interface itself.
- Tool steps appear inline as collapsed activity lines you can expand.
- Sidebar: pin, unread badges, right-click menu (edit, change avatar, delete), live computer panel as a side drawer.

## 6. Accounts

- Grok Bot: sign in with a provider account; bots sync across devices; teams share bots with owner/user roles.
- Frog Bot: email + password accounts (Supabase), a Resend welcome email, each account has its own private team on that computer. Team sharing can come later.

## Round 2 research (Oct 2026)

New videos, each explained by Gemini (gemini.google.com) from the link:

- https://www.youtube.com/watch?v=CUxn_kTrc1o: "I Spent 50 Hours Testing Grok Bot: 8 Tricks You NEED" (Nuno Tavares)
- https://www.youtube.com/watch?v=z-_MLyXPwas: "How to Set Up Grok Bot Routines" (Stromatic Labs)
- https://www.youtube.com/watch?v=pSFOZyIgIFU: "Grok Bot Tutorial: Build Your AI Team in 3 Minutes" (Ben Milshtein)
- https://www.youtube.com/watch?v=TMPUUyQC5aM: "A Week of Grok Bot Lessons in 10 Mins" (Nate Herk)
- https://www.youtube.com/watch?v=igZxE8cXCds: "Grok Bot Is Live: And Nobody's Talking About the Risk" (BitBiasedAI)

### Mechanisms learned

- **Skills are playbooks.** After a good result plus feedback, the user says "save this as a skill". The skill captures sources, steps, quality checks and output format. Skills are listed per bot (under plugins → "mine"), and a skill file can be dropped into chat for the bot to install.
- **Teach a Task.** Open the bot's computer, click Teach a Task, do the job yourself (browser clicks and typing), then stop. The bot analyses the recording and saves it as a skill. It is also used to make bots remember efficient click paths, which saves tokens.
- **Routines = when; skills = how.** Each routine has a name, instructions (it can name skills or other bots), and a trigger. Triggers are a schedule (hourly, daily, weekdays, or a custom interval) or an event (Slack message, Git event, Teams message). Other controls: an Active toggle to pause, a Test run button, run history shown under the routine, and autosave (no Save button). Routines run in the cloud while the user's devices are off, and results are pushed to the phone.
- **Chief of Staff routing.** The description says "X is the only bot the user talks to; check whether another bot owns the task and delegate first". Sub-bots get narrow descriptions. After a "grill me" interview, the Chief of Staff can recommend which new bots to create.
- **"Grill me" interview skill.** The bot keeps interviewing the user about the business, goals and projects until it understands them, then writes that into shared memory.
- **Memory has two layers.** Shared knowledge is seen by every bot (goals, location, tool stack). Per-bot memory is private to one bot.
- **Threads.** Any message's ⋯ menu offers "Start a thread", a side conversation that keeps the main chat clean.
- **Voice.** Each bot can have its own voice. Talk to bots hands-free, and they read out finished work.
- **Credentials via a vault.** 1Password can be connected with a service-account token, so bots use logins without the model ever seeing the passwords. Separately, browser sessions stay signed in inside the bot's computer.
- **Connector hubs.** Composio, one connection that reaches 1,500+ apps, is the common way to add apps beyond the built-in ones. Work logs can go to ClickUp.
- **Drafts held for review** before anything is published, plus "always allow" or "allow once" on approvals.
- **Risks raised:** prompt injection from emails and web pages, always-on bots inside company tools, costs running away from loops and routines, and mistakes spreading across connected tools before a human notices.

### Gap list (capability → Frog Bot today → what to build), in priority order

1. **Skills (save as skill)** → no → add a `save_skill` tool and a Skills tab per agent (skills/<name>.md in the agent folder), plus team-wide skills in shared/. Skills are listed in the system prompt by name and loaded on demand. Support importing a dropped skill file.
2. **Routines UI** → partly: `schedule_task` exists, but there is no proper panel → add a Routines section in the agent panel (name, instructions, schedule presets plus a custom interval, Active toggle, Test run, run history) and an "every N minutes/hours" trigger.
3. **Allow once / always allow** → partly (Ask, Auto and Plan modes) → add an "Always allow this" option on approval cards, remembered per agent, per tool and per site.
4. **Two-layer memory** → yes (team-memory.md plus each agent's memory.md) → show both in the UI and let the user edit them, and add a "grill me" starter that fills shared memory.
5. **Chief of Staff suggests new agents** → no → let Frog propose agents through the existing agent-request approval.
6. **Teach a Task (recording)** → no → record the agent's browser profile session (Playwright trace or CDP events) while the user acts, then turn it into a skill markdown. A large job, so do it after Skills.
7. **Threads from a message** → no → "Start a thread" in the message menu creates a child conversation with the same agent.
8. **Event triggers** → no → Slack message or webhook triggers for routines (use the Slack integration first).
9. **Cost guard** → no → a per-routine and per-day token budget, with a pause when it is exceeded and a usage readout in Settings.
10. **Secret vault** → partly (credentials can be given in chat, and logins persist in the agent's browser profile) → optional 1Password service-account connector later.
11. **Voice** → no → later (system speech-to-text and text-to-speech, and reading out finished work).
12. **Connector hub** → custom MCP is supported → add Composio MCP as a template in Integrations.

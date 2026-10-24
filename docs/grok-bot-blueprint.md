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

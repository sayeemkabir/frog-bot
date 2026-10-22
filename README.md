<p align="center"><img src="build/icon.png" width="96" alt="Frog Bot"></p>

<h1 align="center">Frog Bot</h1>

<p align="center">A team of AI agents that lives on your computer, works together, uses your apps, and asks you before it acts for you.</p>

---

## What it is

Frog Bot is a desktop chat app (Windows, macOS, Linux). Inside it you have **agents**: teammates with a name, a job, their own memory and their own folder ("computer"). You chat with them like you would with a colleague.

- **They do real work.** Read and write files, run commands, browse the web in their own Chrome, and use connected apps like the **ROS dashboard** and Slack.
- **They work together.** Agents message each other, hand off tasks, and can ask you to add a new specialist when the team needs one. Put several in a **group chat** and use `@Name` to talk to one.
- **They ask first.** Anything that speaks for you (posting, sending, deleting, changing data in an app) shows an **Allow / Don't allow** card. You can "Always allow" a specific action per agent.
- **They remember.** Each agent keeps a `memory.md`, and the team shares `team-memory.md`. Optional **Learn from my screen** saves screenshots they can look at to learn how you work.
- **They keep going.** Frog Bot sits in the tray while your computer is on, and agents can schedule repeating jobs ("check Slack every 30 minutes").
- **You can see everything.** The **Logs** tab is a live, timestamped, terminal-style feed of every action.

## Getting started (no coding needed)

1. Install Frog Bot from the latest release (`.exe` for Windows, `.dmg` for Mac, `.AppImage`/`.deb` for Linux).
2. Open it and paste an API key:
   - **Claude** (best): [console.anthropic.com](https://console.anthropic.com) → API keys. Name it `Frogbot`.
   - **OpenAI** also works: [platform.openai.com](https://platform.openai.com) → API keys.
3. Your browser opens the **ROS dashboard** sign-in once. Click **Allow**. After that it stays connected.
4. Say hi to **Frog**, your lead agent. Press **+** to add more agents or a group.

That's it. Your key is stored encrypted with your system keychain and never leaves your computer except to talk to the AI provider.

## Everyday use

| You want to… | Do this |
|---|---|
| Give an agent a job | Open its chat and type it in plain words |
| Add a teammate | **+** → New agent (or pick an idea like "Researcher") |
| Work with several agents | **+** → New group, then `@Name` to address one |
| See what an agent is doing | **About [agent]** → **Screen** tab (live steps and browser view) |
| Find files an agent made | **About [agent]** → **Files**, or the shared folder in `FrogsWorld/shared` |
| Connect another app | **Integrations** (bottom left) → pick Slack, Notion, GitHub… or a custom MCP server |
| Let an agent act more on its own | **About [agent]** → **Work on its own** (it still asks before sending or deleting) |
| Stop an agent | The **Stop** button at the top of the chat |
| Check what happened | **Logs** tab |

Everything Frog Bot keeps lives in one folder: `~/FrogsWorld` (`agents/`, `shared/`, `logs/`, `observations/`, `state/`).

## For developers

Requirements: Node.js 22+, Git.

```bash
git clone https://github.com/sayeemkabir/frog-bot.git
cd frog-bot
npm install
cp .env.example .env      # put ANTHROPIC_API_KEY or OPENAI_API_KEY in .env (or paste it in the app)
npm run dev               # hot-reloading UI, main process rebuilt on save
```

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development mode |
| `npm start` | Build and run the app |
| `npm test` | Unit and engine tests (no network, no key needed) |
| `FROG_LIVE=1 npx vitest run tests/live.test.ts` | Live tests with a real model (uses your key) |
| `npm run smoke -- --runs 3` | Launches the real app, clicks through every screen, saves screenshots to `smoke-output/` |
| `npm run typecheck` | TypeScript check |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Build installers into `release/` |
| `npm run server` | Headless server mode (see below) |

GitHub Actions builds and tests on Windows, macOS and Linux on every push (`.github/workflows/build.yml`), and attaches installers to a release when you push a `v*` tag.

### How it's built

```
src/
  core/         the engine (no Electron imports, so it also runs on a server)
    engine.ts       agents, chats, turn queue, approvals, scheduler, watch mode
    runner.ts       Claude brain (Claude Agent SDK: the engine behind Claude Code)
    openaiRunner.ts OpenAI brain (same tools, same approval gate)
    frogTools.ts    team tools: message_agent, ask_user, request_new_agent, remember, schedule_task…
    permissions.ts  what runs freely vs. what needs your OK
    integrations.ts MCP apps (ROS, browser, Slack…), oauth.ts signs in and refreshes tokens
  main/         Electron: window, tray, notifications, encrypted keys, IPC, self-test
  renderer/     React UI
  server/       headless HTTP + WebSocket server using the same engine and UI
config/frogbot.config.json   built-in integrations (ROS, browser) and templates
```

The UI only talks to the engine through one typed API (`src/shared/types.ts → FrogApi`), over Electron IPC on the desktop or a WebSocket on a server.

### Server mode (for later hosting)

```bash
FROG_SERVER_TOKEN=<long random string> npm run server
# open http://<server>:4777/?token=<that string>
```

On a server, each agent's browser runs headless in its own Chromium (`npx playwright install chromium` once). OAuth sign-ins (like ROS) are easiest to do once on a desktop first.

### Adding a built-in integration

Add an entry to `config/frogbot.config.json` → `integrations` (auto-connected for everyone) or `templates` (appears under "Add another app" with fill-in fields). Remote MCP servers with OAuth sign-in work out of the box; others can use a token.

## Safety

- Read-only actions run freely. Writing inside an agent's own folder or the shared folder runs freely.
- Commands, changes outside those folders, changes in connected apps, and browser clicks/typing ask first, unless you switch an agent to **Work on its own**.
- Sending, posting and deleting **always** ask, unless you choose "Always allow" for that exact action.
- Agents never sign in, create accounts or solve CAPTCHAs on their own; they ask you.
- Keys and tokens are encrypted with the OS keychain and redacted from logs.

## License

MIT © Sayeem Kabir

# What's left

Updated 25 Oct 2026. Order: finish the current version, then Grok Bot features, then Mac and Linux last.

## 1. Finish the current version

- [ ] **Your test pass on the installed build**: profile, Auto mode, @ mentions, new group, sign out and back in, the "Launch Plan" teamwork task.
- [ ] **Sign-up alerts**: a Supabase rule that posts "New Frog Bot sign-up: name, email" to a Slack channel (needs the channel name).
- [ ] **Forgot password**: a reset link by email. Needs email sending first.
- [ ] **frogbot.org email**: Cloudflare Email Routing (rezwan@frogbot.org forwards to Gmail, free) plus the domain added to Resend so the app can send from hello@frogbot.org.
- [ ] **Welcome email** with a short tutorial, sent through Resend after sign-up.
- [ ] **Privacy page** on the website (we store name and email for accounts), linked from the sign-up screen.
- [ ] **Release refresh**: replace the v0.1.0 downloads with the new build (accounts, new UI, speed work, cleaned-up integrations).
- [ ] **Website refresh**: new screenshots and setup videos (the current ones show the old UI and old integrations).
- [ ] **README overhaul**: badges, diagrams of how agents work together, screenshots, install steps (installer and terminal), website link.

## 2. Grok Bot features (from the research in grok-bot-blueprint.md)

Ranked by value to users.

1. [ ] **Skills**: "save this as a skill" after a good result (sources, steps, checks, output format); a Skills tab per agent; team-wide skills; install a skill by dropping its file into chat.
2. [ ] **Routines panel**: schedule presets plus a custom interval, an Active switch, Test run, and run history. Scheduling already works under the hood but has no proper screen.
3. [ ] **"Always allow this"** on approval cards, remembered per agent and per tool or site.
4. [ ] **Memory in the UI**: view and edit shared team memory and each agent's private memory, plus a "grill me" interview that fills shared memory.
5. [ ] **Frog suggests new agents** when the team is missing a skill (you approve).
6. [ ] **Teach a Task**: record yourself doing a job in the agent's browser and turn it into a skill. Large job; after Skills.
7. [ ] **Threads**: start a side thread from any message.
8. [ ] **Event triggers** for routines, starting with "when a Slack message arrives".
9. [ ] **Cost guard**: daily and per-routine token budgets that pause work and tell you.
10. [ ] **1Password connector** so agents can use saved logins without seeing them in chat. Optional.
11. [ ] **Voice**: a voice per agent for spoken replies.
12. [ ] **Composio** as a one-click app hub in Integrations.

## 3. Mac and Linux (last, once the above is done)

- **Free path (chosen):** the repo is public, so GitHub Actions builds are free with no minute cap, including Mac and Linux. One workflow file builds Windows `.exe`, Mac `.dmg`/`.zip` and Linux `.AppImage`/`.deb` on real machines when a version tag is pushed, then uploads them to GitHub Releases. The website download buttons link there.
- **Blocker:** the GitHub account has a billing lock that stops Actions even on public repos. It must be cleared in GitHub billing settings first.
- **Fallbacks if the lock stays:** Linux can be built on this PC with WSL (free, built into Windows). For Mac: Codemagic's free tier, or a borrowed Mac for an hour per release. Files can also be hosted on Cloudflare R2 or SourceForge.
- **Mac signing:** without Apple's $99/year developer account the app is unsigned. It still runs: users right-click the app, choose Open, then confirm. The download page must say this. Windows shows a SmartScreen warning users can click past; Linux has no warning.
- [ ] Confirm the Mac and Linux builds really launch, sign in and run an agent, not just that they package.

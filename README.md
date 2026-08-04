# Kiddo Programmer

Kiddo Programmer is a small, local web-app workshop for children. The app they are making stays on the left, and their conversation with a coding buddy stays on the right. It runs on a Raspberry Pi and opens in Safari on an iPad.

## What is included

- One-page, touch-friendly interface
- Separate saved projects with the maker's age
- Open-ended text conversation
- Age-aware, child-safe agent instructions
- Independent worker and read-only supervisor agents
- Self-contained HTML apps that work without CDNs or packages
- Automatic HTML and JavaScript checks after every change
- Supervisor feedback loops back to the worker until the review passes
- Staged builds that publish only after supervisor approval
- Last-known-good rollback if an agent edit does not pass
- Friendly in-page errors with retry guidance; children never need browser console tools

## Start it

Requirements: Node.js 20+ and an authenticated Codex CLI.

```bash
codex login
npm test
npm start
```

The terminal prints the local URL. Find the Pi's address with:

```bash
hostname -I
```

Replace `<PI-IP>` in the printed iPad URL with that address and open the result in Safari. The Pi and iPad must be on the same Wi-Fi network.

Projects are saved separately under `/home/gmagogsfm/kiddo_projects/`. That folder is initialized as its own Git repository automatically, keeping generated apps outside the framework repository. Conversation files remain local and are ignored by the projects repository.

Every new project and every supervisor-approved app update is committed as a separate version in the projects repository and pushed to its `origin/main` remote. The supervisor is the version gatekeeper and writes the commit summary; the trusted server runs the limited Git commands only after a passing verdict. Rejected builds are not committed. Commit messages never contain the child's chat message.

## Start automatically with the Pi

The included `kiddo-programmer.service` matches this Pi's current username and project path. Install it once:

```bash
sudo cp kiddo-programmer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiddo-programmer
sudo systemctl status kiddo-programmer
```

Afterward, use `sudo journalctl -u kiddo-programmer` to see the iPad link. If the project is moved or the Pi username changes, update the paths and `User` in the service file first.

## Configuration

Environment variables:

- `PORT` — web port, default `3000`
- `HOST` — listening address, default `0.0.0.0`
- `KIDDO_PROJECTS_DIR` — separate project storage path, default `../kiddo_projects`
- `CODEX_BIN` — alternate path to the Codex executable
- `CODEX_WORKER_MODEL` — worker model, default `gpt-5.6-sol`
- `CODEX_SUPERVISOR_MODEL` — supervisor model, default `gpt-5.6-sol`
- `CODEX_TIMEOUT_MS` — maximum agent turn time, default four minutes
- `SUPERVISOR_TIMEOUT_MS` — maximum supervisor review time, default two minutes
- `MAX_SUPERVISOR_ROUNDS` — emergency ceiling for worker/reviewer rounds, default `6` and capped at `10`

## Safety notes

The preview runs in a sandboxed iframe and each coding turn is scoped to its project's folder. Generated apps are blocked from network requests and external resources. There is no login or access key, so use this only on a trusted home or classroom network with adult supervision—never expose it directly to the public internet.

Codex runs non-interactively with `approval_policy="never"`. The worker receives `workspace-write` access only to a temporary staging folder; the supervisor receives `read-only` access. Commands that fit those boundaries run without prompting. Requests for broader filesystem or network access fail instead of waiting for an approval that a background web request cannot provide.

Both Codex roles explicitly use `model_reasoning_effort="low"` to keep ordinary children’s requests responsive and reduce reasoning-token usage.

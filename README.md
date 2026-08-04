# Kiddo Programmer

Kiddo Programmer is a free, self-hosted AI app workshop for children. It runs on a Raspberry Pi and opens from an iPad on the same private Wi-Fi network. The app a child is making stays on the left, while their conversation with a friendly coding buddy stays on the right.

## What makes it different

- A simple, touch-friendly project chooser and creative workspace
- Open-ended creation instead of a fixed collection of lessons
- Age-aware, child-safe agent instructions
- Separate worker and read-only supervisor agents
- Automatic checks and repair loops before a new version is shown
- A last-known-good version when an attempted change fails
- Self-contained HTML apps without third-party packages or trackers
- A custom local project logo generated from the child's first idea
- Separate framework and project repositories with version history
- Friendly in-page progress and errors; children do not need developer tools

## Install on a Raspberry Pi

After installing Node.js 20+ and Git, the npm distribution installs Kiddo Programmer and its Codex CLI dependency together:

```bash
npm install --global kiddo-programmer
codex login --device-auth
kiddo-programmer setup
```

The setup command checks the machine, creates a machine-specific system service, starts it immediately, enables it at boot, and prints the address to open on the iPad. See the complete beginner-friendly [Raspberry Pi setup guide](SETUP.md) for prerequisites, sign-in, updating, backups, and troubleshooting.

A normal `npm install` deliberately does not request administrator access or launch an account sign-in inside npm's lifecycle hooks. Keeping those actions in the visible `kiddo-programmer setup` command makes installation understandable and safe.

The `kiddo-programmer` package metadata is prepared in this repository but version 0.2.0 still needs to be published to npm before the command above is publicly available. Until then, use the Git checkout instructions in the setup guide.

For development from a Git checkout without installing a service:

```bash
npm test
npm start
```

The terminal prints the local URL. Projects default to a sibling folder named `kiddo_projects`, keeping generated apps and conversation data outside this framework repository.

## How project versions work

Each new project and every supervisor-approved update becomes a separate local Git commit in the projects repository. The supervisor reviews staged work and writes the update summary; rejected builds are not published or committed. If the projects repository has an `origin` remote, approved versions are also pushed there. A failed remote backup never prevents the child from continuing locally.

`chat.json` files remain local and are ignored by the projects repository. Commit messages never contain the child's chat messages.

## Configuration

Service installations keep their settings in `/etc/kiddo-programmer.env`. Development runs can use the same environment variables directly:

- `PORT` — web port, default `3000`
- `HOST` — listening address, default `0.0.0.0`
- `KIDDO_PROJECTS_DIR` — separate project storage path, default `../kiddo_projects`
- `CODEX_BIN` — alternate path to the Codex executable for development runs
- `CODEX_WORKER_MODEL` — worker model, default `gpt-5.6-sol`
- `CODEX_SUPERVISOR_MODEL` — supervisor model, default `gpt-5.6-sol`
- `CODEX_TIMEOUT_MS` — maximum agent turn time, default four minutes
- `SUPERVISOR_TIMEOUT_MS` — maximum supervisor review time, default two minutes
- `MAX_SUPERVISOR_ROUNDS` — emergency ceiling for worker/reviewer rounds, default `6` and capped at `10`

Both Codex roles explicitly use low reasoning effort to keep ordinary requests responsive and control model usage.

## Safety boundary

The preview runs in a sandboxed iframe and every coding turn is scoped to one project's staged folder. Generated apps are blocked from network requests and external resources. Codex runs non-interactively: the worker can write only inside staging, while the supervisor receives read-only access. Requests outside those boundaries fail instead of waiting for permission.

There is intentionally no login or access key. Use Kiddo Programmer only on a trusted home or classroom network with adult supervision, and never expose its port directly to the public internet.

The framework and project files live on the Pi, but the default Codex models use OpenAI's service. An internet connection and eligible ChatGPT plan or API billing are therefore required for code generation.

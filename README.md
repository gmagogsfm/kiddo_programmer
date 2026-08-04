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

## How it works

A worker agent builds each request in a temporary staging folder. Automated checks inspect the HTML, JavaScript, external resources, navigation, storage use, and generated logo. A separate supervisor agent reviews the result without write access. If it finds a problem, its feedback goes back to the worker for another repair round instead of being shown to the child.

Only an approved build replaces the visible app. If a request cannot be completed safely, the previous working version remains available.

## Project ownership and versions

Children's projects are stored separately from the framework. Each new project and every supervisor-approved update becomes a local Git commit in the projects repository. Rejected builds are not published or committed.

If the projects repository has an `origin` remote, approved versions are also pushed there. A failed remote backup never prevents the child from continuing locally. Conversation files named `chat.json` stay local and are excluded from Git commits; commit messages never contain the child's chat messages.

## Safety boundary

The preview runs in a sandboxed iframe and every coding turn is scoped to one project's staged folder. Generated apps are blocked from network requests and external resources. Codex runs non-interactively: the worker can write only inside staging, while the supervisor receives read-only access. Requests outside those boundaries fail instead of waiting for permission.

There is intentionally no login or access key. Use Kiddo Programmer only on a trusted home or classroom network with adult supervision, and never expose its port directly to the public internet.

The framework and project files live on the Pi, but the default Codex models use OpenAI's service. Creating apps therefore requires an internet connection and an eligible ChatGPT plan or API billing. Do not ask children to enter names, addresses, contact details, school information, or other personal information in their requests.

## License

Kiddo Programmer is licensed under the [Apache License 2.0](LICENSE). The software is provided on an "AS IS" basis, without warranties or conditions of any kind. See [NOTICE](NOTICE) for project attribution.

## Raspberry Pi setup

This setup turns a Raspberry Pi into a small home server. Nothing needs to be installed on the iPad.

### What you need

- A Raspberry Pi running 64-bit Raspberry Pi OS with an internet connection
- An iPad and the Pi connected to the same trusted Wi-Fi network
- A keyboard and screen for the Pi, or SSH access to it
- A ChatGPT plan that includes Codex, or an OpenAI API account with billing enabled

### 1. Install the basic tools

Open a terminal on the Pi and run:

```bash
sudo apt update
sudo apt install -y git nodejs npm
node --version
```

Kiddo Programmer requires Node.js 20 or newer. If the reported version begins with `v18` or lower, install a current LTS release using the instructions at [nodejs.org](https://nodejs.org/en/download) and check the version again.

### 2. Install Kiddo Programmer

The npm package installs Kiddo Programmer and its Codex CLI dependency together:

```bash
npm install --global kiddo-programmer
```

If npm reports a permissions error, follow npm's guide for [avoiding global-install permission errors](https://docs.npmjs.com/resolving-eacces-permissions-errors) rather than running npm as root.

Version 0.3.2 is ready to package but has not yet been published to npm. Until it is published, use the source installation below and install Codex separately:

```bash
npm install --global @openai/codex
git clone https://github.com/gmagogsfm/KiddoProgrammer.git
cd KiddoProgrammer
./install.sh
```

### 3. Run the guided setup

For the npm installation, run:

```bash
kiddo-programmer setup
```

The wizard will:

1. Ask which coding agent to use. OpenAI Codex is currently supported.
2. Check whether that agent is signed in.
3. If needed, show a device code and web address so a grown-up can finish signing in from any device.
4. Create a separate `kiddo_projects` folder in the Pi user's home directory.
5. Create `/etc/kiddo-programmer.env` for settings.
6. Install and start the `kiddo-programmer` system service.
7. Configure the service to start automatically whenever the Pi boots.
8. Print the address to open on the iPad.

The installer requests the Pi password only when it needs to create the system service. Coding agents always run as the normal Pi user, not as root.

Codex supports ChatGPT sign-in for subscription access and API-key sign-in for usage-based access. The guided Pi flow uses device sign-in. Treat the files under `~/.codex` as private credentials—never copy them into the project repository or share them.

### 4. Open it on the iPad

The final setup message shows an address similar to:

```text
http://192.168.1.42:3000
```

Open that address in Safari. To make it feel like an app, use Safari's Share button and choose **Add to Home Screen**.

The address can change if the router gives the Pi a new IP address. Reserving the Pi's address in the home router is the most reliable solution. You can always find the current address by running:

```bash
hostname -I
```

## Administration

Check whether the service is running:

```bash
kiddo-programmer status
```

See recent server messages:

```bash
kiddo-programmer logs
```

Check Node, Git, Codex, sign-in, and the expected iPad address:

```bash
kiddo-programmer check
```

Restart the service after changing settings:

```bash
sudo systemctl restart kiddo-programmer
```

### Configuration

Edit the service settings with:

```bash
sudo nano /etc/kiddo-programmer.env
sudo systemctl restart kiddo-programmer
```

The defaults are suitable for one family. Available settings are:

- `PORT` — web port, default `3000`
- `HOST` — listening address, default `0.0.0.0`
- `KIDDO_PROJECTS_DIR` — where children's projects are stored
- `KIDDO_AGENT` — coding-agent adapter selected during setup; currently `codex`
- `CODEX_BIN` — alternate path to the Codex executable
- `CODEX_WORKER_MODEL` — model used to build apps, default `gpt-5.6-sol`
- `CODEX_SUPERVISOR_MODEL` — model used to review apps, default `gpt-5.6-sol`
- `CODEX_TIMEOUT_MS` — maximum worker time in milliseconds
- `SUPERVISOR_TIMEOUT_MS` — maximum supervisor time in milliseconds
- `MAX_SUPERVISOR_ROUNDS` — maximum build-and-review rounds, from 2 through 10

Both Codex roles explicitly use low reasoning effort to keep ordinary requests responsive and control model usage.

### Update Kiddo Programmer

The framework and children's projects are in separate folders, so updating the npm package does not replace their work:

```bash
npm update --global kiddo-programmer
kiddo-programmer setup
```

The setup command preserves `/etc/kiddo-programmer.env` and refreshes the service definition. For a Git checkout, use:

```bash
git pull --ff-only
npm test
./install.sh
```

### Back up projects

By default, projects are stored in `~/kiddo_projects`. Copy that entire folder to another drive or backup system. It is automatically a Git repository, so advanced users can also connect it to a private remote repository:

```bash
cd ~/kiddo_projects
git remote add origin git@github.com:YOUR-NAME/YOUR-PRIVATE-REPO.git
git push -u origin main
```

Do not use a public repository for children's projects. Conversation history stays local in `chat.json` and is excluded from Git commits.

## Troubleshooting

### The page does not open

Confirm that the service is running and that both devices use the same Wi-Fi:

```bash
kiddo-programmer status
hostname -I
```

Use the first address shown by `hostname -I`, followed by `:3000`.

### The coding buddy says a grown-up must sign in

Run the guided setup as the same normal Pi user that originally installed the service. It will launch sign-in and restart the service:

```bash
kiddo-programmer setup
```

### The service stopped after an update

Run the checks and inspect the latest service messages:

```bash
kiddo-programmer check
kiddo-programmer logs
```

### GitHub backup does not push

The child can continue working because every approved version is committed locally first. Configure the remote repository's SSH key on the Pi, then run `git push` manually to see GitHub's detailed error.

## Development

Run Kiddo Programmer from a source checkout without installing a system service:

```bash
npm test
npm start
```

The terminal prints the local URL. Projects default to a sibling folder named `kiddo_projects`, keeping generated apps and conversation data outside the framework repository.

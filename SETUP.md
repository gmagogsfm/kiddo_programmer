# Set up Kiddo Programmer on a Raspberry Pi

This guide turns a Raspberry Pi into a small home server. A child uses Kiddo Programmer from an iPad on the same private Wi-Fi network; nothing needs to be installed on the iPad.

## What you need

- A Raspberry Pi running 64-bit Raspberry Pi OS with an internet connection
- An iPad and the Pi connected to the same trusted Wi-Fi network
- A keyboard and screen for the Pi, or SSH access to it
- A ChatGPT plan that includes Codex, or an OpenAI API account with billing enabled

Kiddo Programmer and its project files run on the Pi. Codex currently uses OpenAI's service to generate code, so creating apps requires internet access and may consume plan allowance or paid API usage.

## 1. Install the basic tools

Open a terminal on the Pi and run:

```bash
sudo apt update
sudo apt install -y git nodejs npm
node --version
```

Kiddo Programmer requires Node.js 20 or newer. If the reported version begins with `v18` or lower, install a current LTS release using the instructions at [nodejs.org](https://nodejs.org/en/download) and check the version again.

## 2. Install Kiddo Programmer

The Kiddo Programmer npm package includes the Codex CLI dependency:

```bash
npm install --global kiddo-programmer
```

If npm reports a permissions error, follow npm's guide for [avoiding global-install permission errors](https://docs.npmjs.com/resolving-eacces-permissions-errors) rather than running npm as root.

Version 0.3.1 is ready to package but has not yet been published to npm. Until it is published, use the source installation shown below and install Codex separately with `npm install --global @openai/codex`.

## 3. Set up the Raspberry Pi service

Run the guided setup from the installed package:

```bash
kiddo-programmer setup
```

The wizard will:

1. Ask which coding agent to use. OpenAI Codex is currently supported.
2. Check whether that agent is signed in.
3. If needed, show a device code and web address so a grown-up can finish signing in from any device.
4. Continue automatically after sign-in and install the Raspberry Pi service.

Codex supports ChatGPT sign-in for subscription access and API-key sign-in for usage-based access. The guided Pi flow uses device sign-in. Treat the files under `~/.codex` as private credentials—never copy them into the project repository or share them.

The installer asks for your Pi password so it can create a system service. It does not run the coding agents as root. It will:

- Create a separate `kiddo_projects` folder beside the framework
- Create `/etc/kiddo-programmer.env` for settings
- Install and start the `kiddo-programmer` system service
- Configure the service to start automatically whenever the Pi boots
- Print the address to open on the iPad

To install the unpublished version or work on the framework itself, clone the source. The repository contains the same installer:

```bash
git clone https://github.com/gmagogsfm/KiddoProgrammer.git
cd KiddoProgrammer
./install.sh --check
./install.sh
```

## 4. Open it on the iPad

The final installer message shows an address similar to:

```text
http://192.168.1.42:3000
```

Open that address in Safari. To make it feel like an app, use Safari's Share button and choose **Add to Home Screen**.

The address can change if the router gives the Pi a new IP address. Reserving the Pi's address in the home router is the most reliable solution. You can always find the current address by running:

```bash
hostname -I
```

## Everyday administration

Check whether the service is running:

```bash
sudo systemctl status kiddo-programmer
```

Restart it after changing settings:

```bash
sudo systemctl restart kiddo-programmer
```

See recent server messages:

```bash
sudo journalctl -u kiddo-programmer -n 100
```

Run the built-in checks:

```bash
kiddo-programmer check
```

## Settings

Edit the settings with:

```bash
sudo nano /etc/kiddo-programmer.env
sudo systemctl restart kiddo-programmer
```

The defaults are suitable for one family. Available settings are:

- `PORT`: web port, default `3000`
- `HOST`: listening address, default `0.0.0.0`
- `KIDDO_PROJECTS_DIR`: where children's projects are stored
- `KIDDO_AGENT`: coding-agent adapter selected during setup; currently `codex`
- `CODEX_WORKER_MODEL`: model used to build apps
- `CODEX_SUPERVISOR_MODEL`: model used to review them
- `CODEX_TIMEOUT_MS`: maximum worker time in milliseconds
- `SUPERVISOR_TIMEOUT_MS`: maximum review time in milliseconds
- `MAX_SUPERVISOR_ROUNDS`: maximum build-and-review rounds, from 2 through 10

The framework intentionally has no public-internet authentication. Keep it on a trusted home or classroom network and do not forward port 3000 from the router.

## Update Kiddo Programmer

The framework and children's projects are in separate folders, so updating the npm package does not replace their work:

```bash
npm update --global kiddo-programmer
kiddo-programmer setup
```

The installer preserves `/etc/kiddo-programmer.env` during updates and refreshes the service definition in case its requirements changed.

For a Git checkout, use `git pull --ff-only`, run `npm test`, and then run `./install.sh` again.

## Back up projects

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
sudo systemctl status kiddo-programmer
hostname -I
```

Use the first address shown by `hostname -I`, followed by `:3000`.

### The coding buddy says a grown-up must sign in

Sign in as the same normal Pi user that installed the service, then restart it:

```bash
codex login --device-auth
sudo systemctl restart kiddo-programmer
```

### The service stopped after an update

Run the checks and inspect the latest service messages:

```bash
kiddo-programmer check
kiddo-programmer logs
```

### GitHub backup does not push

The child can continue working because every approved version is committed locally first. Configure the remote repository's SSH key on the Pi, then run `git push` manually to see GitHub's detailed error.

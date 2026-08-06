# Kiddo Programmer

Kiddo Programmer is a free, local AI programming workshop designed for kids. A child describes an idea in simple language, and a coding buddy builds a working web app beside the conversation.

Everything Kiddo Programmer owns runs on your Raspberry Pi:

- The website is served from your home network.
- Projects, conversations, logos, and Git history stay on your Pi.
- There is no Kiddo Programmer cloud account, subscription, tracking, or advertising.
- The framework is free to use under the Apache-2.0 license.

AI generation uses the adult's own supported coding-agent account. OpenAI Codex is currently supported, so the adult needs an eligible ChatGPT subscription or API billing. Requests sent to that agent are subject to its provider's terms and privacy practices.

## Designed for kids

- Age-aware conversation with short, approachable replies
- Open-ended creation instead of fixed lessons
- Touch-friendly project selection and app previews for iPad
- No microphone, purchases, external links, ads, or child accounts
- Friendly progress and errors instead of developer consoles

## Builds that keep working

A worker agent builds each request in a temporary folder. Automated checks inspect the result, then a separate read-only supervisor reviews it. Problems go back to the worker for repair. Only an approved version is shown to the child; otherwise, the previous working version stays available.

Every approved update becomes a local Git commit. Generated projects live separately from the framework, so an agent cannot accidentally modify Kiddo Programmer itself.

## Safety and privacy

Generated apps are self-contained HTML and run in a sandboxed preview. They cannot load external resources, make network requests, navigate the browser, or access other projects. Coding agents run as the normal Pi user with narrowly scoped filesystem access, never as root.

Use Kiddo Programmer only on a trusted home or classroom network with adult supervision. Do not expose port 3000 to the public internet, and teach children not to enter names, addresses, school information, or other personal details in prompts.

## Raspberry Pi setup

You need 64-bit Raspberry Pi OS, an iPad on the same Wi-Fi, and an adult-owned Codex account.

### 1. Install the basic tools

```bash
sudo apt update
sudo apt install -y git nodejs npm
node --version
```

Node.js 20 or newer is required. If the version is older, install a current LTS release from [nodejs.org](https://nodejs.org/en/download).

### 2. Install the current release

The npm package is prepared but not published yet. Install from GitHub for now:

```bash
npm install --global @openai/codex
git clone https://github.com/gmagogsfm/KiddoProgrammer.git
cd KiddoProgrammer
./install.sh
```

The guided setup selects the coding agent, completes adult sign-in when needed, installs a system service, enables startup at boot, and prints the iPad address. It requests `sudo` only for service installation; the agents remain unprivileged.

After the npm package is published, installation will be:

```bash
npm install --global kiddo-programmer
kiddo-programmer setup
```

### 3. Open it on the iPad

Open the address printed by setup, such as `http://192.168.1.42:3000`, in Safari. Use **Share → Add to Home Screen** for an app-like icon.

If the address changes, run `hostname -I` on the Pi or reserve the Pi's address in your router.

## Administration

For an npm installation:

```bash
kiddo-programmer status
kiddo-programmer logs
kiddo-programmer check
```

Settings live in `/etc/kiddo-programmer.env`. Restart after editing them:

```bash
sudo systemctl restart kiddo-programmer
```

Projects default to `~/kiddo_projects`. Back up that entire folder. Conversation files remain local and are excluded from Git commits.

To update an npm installation:

```bash
npm update --global kiddo-programmer
kiddo-programmer setup
```

For a Git installation, run `git pull --ff-only`, `npm test`, and `./install.sh`.

## Troubleshooting

If the page does not open, confirm that the iPad and Pi use the same Wi-Fi, then run:

```bash
sudo systemctl status kiddo-programmer
hostname -I
```

If the agent needs sign-in or the service stopped after an update, rerun `./install.sh` from a Git checkout or `kiddo-programmer setup` from an npm installation.

## Development

```bash
npm test
npm start
```

## License

Kiddo Programmer is free software under the [Apache License 2.0](LICENSE). It is provided on an "AS IS" basis without warranties or conditions of any kind. See [NOTICE](NOTICE) for attribution.

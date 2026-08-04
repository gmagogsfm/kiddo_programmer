# Kiddo Programmer

Kiddo Programmer is a small, local web-app workshop for children. The app they are making stays on the left, and their conversation with a coding buddy stays on the right. It runs on a Raspberry Pi and opens in Safari on an iPad.

## What is included

- One-page, touch-friendly interface
- Separate saved projects with the maker's age
- Text chat plus browser voice input
- Age-aware, child-safe agent instructions
- Self-contained HTML apps that work without CDNs or packages
- Automatic HTML and JavaScript checks after every change
- Last-known-good rollback if an agent edit does not pass
- A private access key for devices on the local network

## Start it

Requirements: Node.js 20+ and an authenticated Codex CLI.

```bash
codex login
npm test
npm start
```

The terminal prints a private URL. Find the Pi's address with:

```bash
hostname -I
```

Replace `<PI-IP>` in the printed iPad URL with that address, keep the `?key=...` part, and open the result in Safari. The Pi and iPad must be on the same Wi-Fi network.

Projects are saved under `projects/`. The access key is saved under `data/`; neither directory is committed to Git.

## Start automatically with the Pi

The included `kiddo-programmer.service` matches this Pi's current username and project path. Install it once:

```bash
sudo cp kiddo-programmer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kiddo-programmer
sudo systemctl status kiddo-programmer
```

Afterward, use `sudo journalctl -u kiddo-programmer` to see the private iPad link. If the project is moved or the Pi username changes, update the paths and `User` in the service file first.

## Configuration

Environment variables:

- `PORT` — web port, default `3000`
- `HOST` — listening address, default `0.0.0.0`
- `KIDDO_ACCESS_KEY` — fixed private access key instead of the generated one
- `CODEX_BIN` — alternate path to the Codex executable
- `CODEX_TIMEOUT_MS` — maximum agent turn time, default four minutes

## Voice input on iPad

The microphone button uses Safari's speech-recognition support when available. Browser and iOS versions differ, and microphone features can be limited on a plain local `http://` address. The microphone on the iPad keyboard remains a good fallback. For a long-term deployment, put the server behind local HTTPS (for example with Caddy and a locally trusted certificate).

## Safety notes

The preview runs in a sandboxed iframe and each coding turn is scoped to its project's folder. Generated apps are blocked from network requests and external resources. The access key prevents casual access from other devices on the Wi-Fi, but this is still intended for a trusted home or classroom network with adult supervision—not direct exposure to the public internet.

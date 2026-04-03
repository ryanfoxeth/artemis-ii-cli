# Artemis II CLI Tracker

A terminal-based (TUI) tracker for the Artemis II mission, showing live spacecraft telemetry from NASA/JPL Horizons directly in your terminal.

![Screenshot](screenshot.png)

## Features

- Live Orion spacecraft position relative to Earth and Moon
- ASCII tracker visualization showing Orion's position between Earth and Moon
- Mission timeline with color-coded event status
- Velocity vector display
- Crew manifest
- Auto-refreshes every 2 minutes
- Toggle between km and miles

## Install

```bash
npx artemis-ii-cli
```

Or clone and run locally:

```bash
git clone https://github.com/yourusername/artemis-ii-cli.git
cd artemis-ii-cli
npm install
npm start
```

## Keyboard

| Key | Action |
|-----|--------|
| `q` | Quit |
| `Ctrl+C` | Quit |
| `m` | Toggle miles/km |
| `r` | Force refresh |

## Data Source

All telemetry data is fetched directly from the [JPL Horizons API](https://ssd.jpl.nasa.gov/horizons/) (NASA/JPL). The spacecraft ID is `-1024` (Artemis II / Orion EM-2).

## License

MIT - Ryan Fox

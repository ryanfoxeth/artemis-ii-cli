#!/usr/bin/env node

import blessed from 'blessed';
import { fetchTelemetry, MISSION_EVENTS, CREW } from './lib/horizons.js';

// ─── State ───────────────────────────────────────────────────────────
let useMiles = true;
let telemetry = null;
let lastUpdate = null;
let errorMsg = null;
let refreshTimer = null;

const EARTH_MOON_KM = 384_400;
const EARTH_MOON_MI = Math.round(EARTH_MOON_KM * 0.621371);

// Block characters for visual effects
const BLOCKS = {
  full: '█', light: '░', medium: '▒', dark: '▓',
  left: '▌', right: '▐', top: '▀', bottom: '▄',
  diamond: '◆', circle: '●', ring: '○', dot: '·',
  arrowR: '▸', arrowL: '◂', bar: '─', dbar: '═',
  tl: '╔', tr: '╗', bl: '╚', br: '╝', vert: '║', horiz: '═',
  cross: '┼', ltee: '├', rtee: '┤',
};

// ─── Screen Setup ────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: 'Artemis II Tracker',
  fullUnicode: true,
});

// ─── Main Container ─────────────────────────────────────────────────
const mainBox = blessed.box({
  parent: screen,
  top: 0, left: 0, width: '100%', height: '100%',
  style: { bg: 'black' },
});

// ─── Title Bar ──────────────────────────────────────────────────────
const titleBar = blessed.box({
  parent: mainBox, top: 0, left: 0, width: '100%', height: 3,
  tags: true, style: { bg: 'black', fg: 'cyan' },
});

// ─── Telemetry Box ──────────────────────────────────────────────────
const telemetryBox = blessed.box({
  parent: mainBox, top: 3, left: 1, width: '34%', height: 13,
  label: ` ${BLOCKS.diamond} TELEMETRY `,
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true },
    bg: 'black', fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Orion Tracker ──────────────────────────────────────────────────
const trackerBox = blessed.box({
  parent: mainBox, top: 3, left: '36%', width: '63%', height: 9,
  label: ` ${BLOCKS.diamond} ORION TRACKER `,
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true },
    bg: 'black', fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Velocity Box ───────────────────────────────────────────────────
const velocityBox = blessed.box({
  parent: mainBox, top: 16, left: 1, width: '34%', height: 8,
  label: ` ${BLOCKS.diamond} VELOCITY `,
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true },
    bg: 'black', fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Mission Timeline ───────────────────────────────────────────────
const timelineBox = blessed.box({
  parent: mainBox, top: 12, left: '36%', width: '63%', height: 12,
  label: ` ${BLOCKS.diamond} MISSION TIMELINE `,
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true },
    bg: 'black', fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Crew Box ───────────────────────────────────────────────────────
const crewBox = blessed.box({
  parent: mainBox, top: 24, left: 1, width: '98%', height: 5,
  label: ` ${BLOCKS.diamond} CREW — ARTEMIS II `,
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true },
    bg: 'black', fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Status Bar ─────────────────────────────────────────────────────
const statusBar = blessed.box({
  parent: mainBox, bottom: 0, left: 0, width: '100%', height: 1,
  tags: true, style: { bg: 'black', fg: 'white' },
});

// ─── Formatting ─────────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null || isNaN(n)) return '---';
  return Math.round(n).toLocaleString('en-US');
}

function fmtDist(km, mi) {
  return useMiles ? `${fmtNum(mi)} mi` : `${fmtNum(km)} km`;
}

function fmtSpeed(kmph, mph) {
  return useMiles ? `${fmtNum(mph)} mph` : `${fmtNum(kmph)} km/h`;
}

function toEDT(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(',', '');
}

function nowEDT() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }) + ' EDT';
}

// ─── Progress bar helper ────────────────────────────────────────────
function progressBar(ratio, width, fillChar = '█', emptyChar = '░') {
  const filled = Math.round(ratio * width);
  return fillChar.repeat(filled) + emptyChar.repeat(width - filled);
}

// ─── Render Functions ───────────────────────────────────────────────

function renderTitle() {
  const w = screen.width;
  const title = `${BLOCKS.tl}${BLOCKS.horiz.repeat(2)} ARTEMIS II TRACKER ${BLOCKS.horiz.repeat(Math.max(0, w - 28))}${BLOCKS.tr}`;
  const met = telemetry ? `MET ${telemetry.mission_elapsed.formatted}` : 'CONNECTING...';
  const metPos = Math.max(0, w - met.length - 4);
  titleBar.setContent(
    `{bold}{cyan-fg}${title}{/cyan-fg}{/bold}\n` +
    `{cyan-fg}${BLOCKS.vert}{/cyan-fg}  {bold}{white-fg}ARTEMIS II{/white-fg}{/bold}  {yellow-fg}${BLOCKS.circle} LIVE{/yellow-fg}` +
    ' '.repeat(Math.max(1, metPos - 22)) +
    `{green-fg}${met}{/green-fg}  {cyan-fg}${BLOCKS.vert}{/cyan-fg}`
  );
}

function renderTelemetry() {
  if (!telemetry) {
    telemetryBox.setContent(errorMsg
      ? `{red-fg}${BLOCKS.circle} ${errorMsg}{/red-fg}`
      : `{yellow-fg}${BLOCKS.medium.repeat(3)} Loading...{/yellow-fg}`);
    return;
  }

  const d = telemetry;
  const earthPct = Math.min(1, d.earth.distance_km / EARTH_MOON_KM);
  const moonPct = Math.min(1, d.moon.distance_km / EARTH_MOON_KM);

  const lines = [
    `{cyan-fg}SPACECRAFT{/cyan-fg}  {bold}{white-fg}${d.spacecraft}{/white-fg}{/bold}`,
    `{cyan-fg}PHASE     {/cyan-fg}  {bold}{yellow-fg}${d.mission_phase}{/yellow-fg}{/bold}`,
    `{cyan-fg}MET       {/cyan-fg}  {white-fg}${d.mission_elapsed.formatted}{/white-fg}`,
    ``,
    `{cyan-fg}EARTH DIST{/cyan-fg}  {white-fg}${fmtDist(d.earth.distance_km, d.earth.distance_miles)}{/white-fg}`,
    `  {blue-fg}${progressBar(earthPct, 26, '▓', '░')}{/blue-fg}`,
    `{cyan-fg}MOON DIST {/cyan-fg}  {white-fg}${fmtDist(d.moon.distance_km, d.moon.distance_miles)}{/white-fg}`,
    `  {white-fg}${progressBar(1 - moonPct, 26, '▓', '░')}{/white-fg}`,
    `{cyan-fg}SPEED     {/cyan-fg}  {white-fg}${fmtSpeed(d.earth.speed_kmph, d.earth.speed_mph)}{/white-fg}`,
    `{cyan-fg}NEXT EVENT{/cyan-fg}  {yellow-fg}${d.next_event ? d.next_event.event : 'Mission Complete'}{/yellow-fg}`,
  ];
  telemetryBox.setContent(lines.join('\n'));
}

function renderTracker() {
  if (!telemetry) {
    trackerBox.setContent(`{yellow-fg}${BLOCKS.medium.repeat(3)} Loading...{/yellow-fg}`);
    return;
  }

  const d = telemetry;
  const innerWidth = Math.max(30, (trackerBox.width || 60) - 4);
  const ratio = Math.min(1, Math.max(0, d.earth.distance_km / EARTH_MOON_KM));
  const trackLen = innerWidth - 6;
  const orionPos = Math.round(ratio * (trackLen - 1));

  // Distance labels
  const earthLabel = fmtDist(d.earth.distance_km, d.earth.distance_miles);
  const moonLabel = fmtDist(d.moon.distance_km, d.moon.distance_miles);

  // Build starfield line
  let stars = '';
  for (let i = 0; i < innerWidth; i++) {
    stars += (i * 7 + 3) % 11 === 0 ? '{black-fg}·{/black-fg}' : ' ';
  }

  // Build track with trajectory
  let track = '';
  for (let i = 0; i < trackLen; i++) {
    if (i === orionPos) {
      track += '{bold}{yellow-fg}◆{/yellow-fg}{/bold}';
    } else if (i < orionPos) {
      track += '{yellow-fg}─{/yellow-fg}';
    } else {
      track += '{black-fg}╌{/black-fg}';
    }
  }

  // Scale bar
  const maxDist = useMiles ? EARTH_MOON_MI : EARTH_MOON_KM;
  const unit = useMiles ? 'mi' : 'km';
  const seg = Math.floor(trackLen / 4);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(p => `${fmtNum(Math.round(maxDist * p))}${p === 0 ? unit : ''}`);
  let scaleLine = '{black-fg}';
  let pos = 0;
  for (let i = 0; i < ticks.length; i++) {
    const target = i * seg;
    scaleLine += ' '.repeat(Math.max(0, target - pos));
    scaleLine += `│${ticks[i]}`;
    pos = target + ticks[i].length + 1;
  }
  scaleLine += '{/black-fg}';

  const earthDistLine = ' '.repeat(Math.max(0, Math.floor(orionPos / 2) - earthLabel.length / 2 + 3)) +
    `{yellow-fg}${earthLabel}{/yellow-fg}` +
    ' '.repeat(Math.max(1, trackLen - orionPos - moonLabel.length / 2 - earthLabel.length / 2)) +
    `{yellow-fg}${moonLabel}{/yellow-fg}`;

  trackerBox.setContent([
    stars,
    earthDistLine,
    `  {bold}{blue-fg}●{/blue-fg}{/bold} ${track} {white-fg}○{/white-fg}`,
    `  {blue-fg}EARTH{/blue-fg}` + ' '.repeat(Math.max(1, orionPos - 3)) +
      `{yellow-fg}ORION{/yellow-fg}` +
      ' '.repeat(Math.max(1, trackLen - orionPos - 7)) + `{white-fg}MOON{/white-fg}`,
    `  ${scaleLine}`,
  ].join('\n'));
}

function renderVelocity() {
  if (!telemetry) {
    velocityBox.setContent(`{yellow-fg}${BLOCKS.medium.repeat(3)} Loading...{/yellow-fg}`);
    return;
  }

  const v = telemetry.earth.velocity_kmps;
  const mag = telemetry.earth.speed_kmps;

  // Speed gauge
  const maxSpeed = 3.0; // km/s roughly max for this mission
  const speedRatio = Math.min(1, mag / maxSpeed);
  const gauge = progressBar(speedRatio, 28, '█', '░');

  const lines = [
    `{cyan-fg}Vx{/cyan-fg}  {white-fg}${v.vx >= 0 ? '+' : ''}${v.vx.toFixed(3)}{/white-fg} {black-fg}km/s{/black-fg}`,
    `{cyan-fg}Vy{/cyan-fg}  {white-fg}${v.vy >= 0 ? '+' : ''}${v.vy.toFixed(3)}{/white-fg} {black-fg}km/s{/black-fg}`,
    `{cyan-fg}Vz{/cyan-fg}  {white-fg}${v.vz >= 0 ? '+' : ''}${v.vz.toFixed(3)}{/white-fg} {black-fg}km/s{/black-fg}`,
    ``,
    `{cyan-fg}|V|{/cyan-fg} {bold}{white-fg}${mag.toFixed(3)}{/white-fg}{/bold} {black-fg}km/s{/black-fg}`,
    `{cyan-fg}${gauge}{/cyan-fg}`,
  ];
  velocityBox.setContent(lines.join('\n'));
}

function renderTimeline() {
  const now = new Date();
  let currentIdx = -1;
  for (let i = 0; i < MISSION_EVENTS.length; i++) {
    if (now >= new Date(MISSION_EVENTS[i].time)) currentIdx = i;
  }

  const lines = MISSION_EVENTS.map((evt, i) => {
    const isPast = i <= currentIdx;
    const isCurrent = i === currentIdx;

    // Connector line
    const connector = i < MISSION_EVENTS.length - 1
      ? (isPast ? '{green-fg}│{/green-fg}' : '{black-fg}│{/black-fg}')
      : ' ';

    // Status indicator
    let dot, nameColor, timeColor;
    if (isCurrent) {
      dot = `{bold}{yellow-fg}${BLOCKS.arrowR}${BLOCKS.circle}{/yellow-fg}{/bold}`;
      nameColor = 'yellow';
      timeColor = 'yellow';
    } else if (isPast) {
      dot = `{green-fg} ${BLOCKS.circle}{/green-fg}`;
      nameColor = 'green';
      timeColor = 'green';
    } else {
      dot = `{black-fg} ${BLOCKS.ring}{/black-fg}`;
      nameColor = 'black';
      timeColor = 'black';
    }

    const padLen = Math.max(1, 18 - evt.event.length);
    const timeStr = toEDT(evt.time) + ' EDT';

    return `${dot} {${nameColor}-fg}${evt.event}{/${nameColor}-fg}${' '.repeat(padLen)}{${timeColor}-fg}${timeStr}{/${timeColor}-fg}`;
  });

  timelineBox.setContent(lines.join('\n'));
}

function renderCrew() {
  const cards = CREW.map(c => {
    return `{cyan-fg}┌──────────────────────┐{/cyan-fg}\n` +
           `{cyan-fg}│{/cyan-fg} {bold}{white-fg}${c.name}{/white-fg}{/bold}` +
           ' '.repeat(Math.max(0, 20 - c.name.length)) + `{cyan-fg}│{/cyan-fg}\n` +
           `{cyan-fg}│{/cyan-fg} {black-fg}${c.role}{/black-fg}` +
           ' '.repeat(Math.max(0, 20 - c.role.length)) + `{cyan-fg}│{/cyan-fg}\n` +
           `{cyan-fg}└──────────────────────┘{/cyan-fg}`;
  });

  // Lay out cards side by side
  const cardLines = cards.map(c => c.split('\n'));
  const rows = cardLines[0].length;
  const combined = [];
  for (let row = 0; row < rows; row++) {
    combined.push(cardLines.map(c => c[row] || '').join('  '));
  }
  crewBox.setContent(combined.join('\n'));
  crewBox.height = rows + 2;
}

function renderStatusBar() {
  const source = `{cyan-fg}${BLOCKS.diamond} JPL Horizons (NASA/JPL){/cyan-fg}`;
  const updated = lastUpdate
    ? `{cyan-fg}Updated {bold}{white-fg}${lastUpdate}{/white-fg}{/bold}{/cyan-fg}`
    : `{yellow-fg}${BLOCKS.medium.repeat(2)} Fetching...{/yellow-fg}`;
  const keys = `{black-fg}q{/black-fg}:quit  {black-fg}m{/black-fg}:${useMiles ? 'km' : 'mi'}  {black-fg}r{/black-fg}:refresh`;
  statusBar.setContent(` ${source}  ${BLOCKS.dot}  ${updated}  ${BLOCKS.dot}  ${keys}`);
}

function renderAll() {
  renderTitle();
  renderTelemetry();
  renderTracker();
  renderVelocity();
  renderTimeline();
  renderCrew();
  renderStatusBar();
  screen.render();
}

// ─── Data Refresh ───────────────────────────────────────────────────

async function refresh() {
  try {
    errorMsg = null;
    telemetry = await fetchTelemetry();
    lastUpdate = nowEDT();
  } catch (err) {
    errorMsg = err.message || 'Failed to fetch data';
  }
  renderAll();
}

function startRefreshLoop() {
  refresh();
  refreshTimer = setInterval(refresh, 120_000);
}

// ─── Keyboard Handlers ─────────────────────────────────────────────

screen.key(['q', 'C-c'], () => {
  if (refreshTimer) clearInterval(refreshTimer);
  process.exit(0);
});

screen.key(['m'], () => {
  useMiles = !useMiles;
  renderAll();
});

screen.key(['r'], () => {
  lastUpdate = null;
  renderStatusBar();
  screen.render();
  refresh();
});

screen.on('resize', () => renderAll());

// ─── Start ──────────────────────────────────────────────────────────
renderAll();
startRefreshLoop();

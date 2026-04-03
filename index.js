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
  parent: mainBox, top: 3, left: '36%', width: '63%', height: 7,
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
  parent: mainBox, top: 10, left: '36%', width: '63%', height: 11,
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
  parent: mainBox, top: 21, left: 1, width: '98%', height: 4,
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
  const boxW = (trackerBox.width || 60) - 4;
  const trackLen = boxW - 2; // room for Earth ● and Moon ○
  const ratio = Math.min(0.95, Math.max(0.05, d.earth.distance_km / EARTH_MOON_KM));
  const orionPos = Math.round(ratio * trackLen);

  const earthLabel = fmtDist(d.earth.distance_km, d.earth.distance_miles);
  const moonLabel = fmtDist(d.moon.distance_km, d.moon.distance_miles);

  // Line 1: distance labels positioned above the track
  const pad1 = Math.max(1, orionPos - Math.floor(earthLabel.length / 2));
  const gap1 = Math.max(1, trackLen - orionPos - Math.floor(moonLabel.length / 2) - pad1 - earthLabel.length + 2);
  const distLine = ' '.repeat(pad1) + `{yellow-fg}${earthLabel}{/yellow-fg}` +
    ' '.repeat(gap1) + `{yellow-fg}${moonLabel}{/yellow-fg}`;

  // Line 2: the track itself — all one string, no wrapping
  // Build as array of single chars, then join
  const chars = [];
  chars.push('{blue-fg}●{/blue-fg}');
  for (let i = 0; i < trackLen; i++) {
    if (i === orionPos) {
      chars.push('{yellow-fg}◆{/yellow-fg}');
    } else if (i < orionPos) {
      chars.push('{yellow-fg}─{/yellow-fg}');
    } else {
      chars.push('{black-fg}·{/black-fg}');
    }
  }
  chars.push('{white-fg}●{/white-fg}');
  const trackLine = chars.join('');

  // Line 3: labels — build as plain string first, then colorize
  const totalVisible = boxW;
  const lbl1gap = Math.max(1, orionPos - 4);
  const lbl2gap = Math.max(1, totalVisible - 5 - lbl1gap - 5 - 4); // EARTH + gap + ORION + gap + MOON
  // Build plain to verify length, then add colors
  const plainLbl = 'EARTH' + ' '.repeat(lbl1gap) + 'ORION' + ' '.repeat(lbl2gap) + 'MOON';
  // Truncate or pad to fit exactly
  const lblLine = `{blue-fg}EARTH{/blue-fg}${' '.repeat(lbl1gap)}{yellow-fg}ORION{/yellow-fg}${' '.repeat(lbl2gap)}{white-fg}MOON{/white-fg}`;

  trackerBox.setContent([
    distLine,
    trackLine,
    lblLine,
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
  const line = CREW.map(c => {
    return `{bold}{white-fg}${c.name}{/white-fg}{/bold} {black-fg}${c.role}{/black-fg}`;
  }).join('  {cyan-fg}│{/cyan-fg}  ');

  crewBox.setContent(`\n ${line}`);
  crewBox.height = 4;
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

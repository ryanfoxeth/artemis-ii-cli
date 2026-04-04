#!/usr/bin/env node

import blessed from 'blessed';
import { fetchTelemetry, getExtrapolatedTelemetry, MISSION_EVENTS, CREW } from './lib/horizons.js';

// ─── State ───────────────────────────────────────────────────────────
let useMiles = true;
let telemetry = null;
let lastUpdateDate = null;
let errorMsg = null;
let refreshTimer = null;
let tickTimer = null;

const TIMEZONES = [
  { label: 'EST', id: 'America/New_York' },
  { label: 'CST', id: 'America/Chicago' },
  { label: 'PST', id: 'America/Los_Angeles' }
];
let currentTzIdx = 0;

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

// ─── Observer Box ───────────────────────────────────────────────────
const observerBox = blessed.box({
  parent: mainBox, top: 21, left: '36%', width: '63%', height: 4,
  label: ` ${BLOCKS.diamond} OBSERVER `,
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
  parent: mainBox, top: 25, left: 1, width: '98%', height: 4,
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
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDist(km, mi) {
  return useMiles ? `${fmtNum(mi)} mi` : `${fmtNum(km)} km`;
}

function fmtSpeed(kmph, mph) {
  return useMiles ? `${fmtNum(mph)} mph` : `${fmtNum(kmph)} km/h`;
}

function fmtTime(isoStrOrDate) {
  const d = new Date(isoStrOrDate);
  const tz = TIMEZONES[currentTzIdx];
  return d.toLocaleString('en-US', {
    timeZone: tz.id,
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(',', '') + ' ' + tz.label;
}

function nowTime() {
  const tz = TIMEZONES[currentTzIdx];
  return new Date().toLocaleString('en-US', {
    timeZone: tz.id,
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }) + ' ' + tz.label;
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

  const barW = Math.max(5, (telemetryBox.width || 30) - 6);
  const lines = [
    `{cyan-fg}SPACECRAFT{/cyan-fg}  {bold}{white-fg}${d.spacecraft}{/white-fg}{/bold}`,
    `{cyan-fg}PHASE     {/cyan-fg}  {bold}{yellow-fg}${d.mission_phase}{/yellow-fg}{/bold}`,
    `{cyan-fg}MET       {/cyan-fg}  {white-fg}${d.mission_elapsed.formatted}{/white-fg}`,
    ``,
    `{cyan-fg}EARTH DIST{/cyan-fg}  {white-fg}${fmtDist(d.earth.distance_km, d.earth.distance_miles)}{/white-fg}`,
    `  {blue-fg}${progressBar(earthPct, barW, '▓', '░')}{/blue-fg}`,
    `{cyan-fg}MOON DIST {/cyan-fg}  {white-fg}${fmtDist(d.moon.distance_km, d.moon.distance_miles)}{/white-fg}`,
    `  {white-fg}${progressBar(1 - moonPct, barW, '▓', '░')}{/white-fg}`,
    `{cyan-fg}SPEED     {/cyan-fg}  {white-fg}${fmtSpeed(d.earth.speed_kmph, d.earth.speed_mph)}{/white-fg}`,
    `{cyan-fg}NEXT EVENT{/cyan-fg}  {yellow-fg}${d.next_event ? d.next_event.event : 'Mission Complete'}{/yellow-fg}`,
  ];
  telemetryBox.setContent(lines.join('\n'));
}

function renderTracker() {
  if (!telemetry) {
    trackerBox.setContent('{yellow-fg}Loading...{/yellow-fg}');
    return;
  }

  const d = telemetry;
  const boxW = (trackerBox.width || 60) - 4;
  const trackLen = boxW - 2;
  const ratio = Math.min(0.95, Math.max(0.05, d.earth.distance_km / EARTH_MOON_KM));
  const orionPos = Math.round(ratio * trackLen);

  const earthDist = fmtDist(d.earth.distance_km, d.earth.distance_miles);
  const moonDist = fmtDist(d.moon.distance_km, d.moon.distance_miles);

  // Use separate blessed text nodes instead of inline tags to avoid wrapping
  // Clear any previous children
  while (trackerBox.children.length) trackerBox.children[0].detach();

  // Distance labels (row 0)
  blessed.text({ parent: trackerBox, top: 0, left: orionPos - earthDist.length, content: earthDist, style: { fg: 'yellow', bg: 'black' }, tags: false });
  blessed.text({ parent: trackerBox, top: 0, right: 1, content: moonDist, style: { fg: 'yellow', bg: 'black' }, tags: false });

  // Track line (row 1) — build as 3 segments
  const beforeOrion = '─'.repeat(orionPos);
  const afterOrion = '·'.repeat(Math.max(0, trackLen - orionPos - 1));
  blessed.text({ parent: trackerBox, top: 2, left: 0, content: '●', style: { fg: 'blue', bg: 'black', bold: true }, tags: false });
  blessed.text({ parent: trackerBox, top: 2, left: 1, content: beforeOrion, style: { fg: 'yellow', bg: 'black' }, tags: false });
  blessed.text({ parent: trackerBox, top: 2, left: 1 + orionPos, content: '◆', style: { fg: 'yellow', bg: 'black', bold: true }, tags: false });
  blessed.text({ parent: trackerBox, top: 2, left: 2 + orionPos, content: afterOrion, style: { fg: 'white', bg: 'black' }, tags: false });
  blessed.text({ parent: trackerBox, top: 2, right: 0, content: '●', style: { fg: 'white', bg: 'black' }, tags: false });

  // Labels (row 3)
  blessed.text({ parent: trackerBox, top: 3, left: 0, content: 'EARTH', style: { fg: 'blue', bg: 'black' }, tags: false });
  blessed.text({ parent: trackerBox, top: 3, left: Math.max(6, orionPos - 2), content: 'ORION', style: { fg: 'yellow', bg: 'black' }, tags: false });
  blessed.text({ parent: trackerBox, top: 3, right: 0, content: 'MOON', style: { fg: 'white', bg: 'black' }, tags: false });
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
    `{cyan-fg}Vx{/cyan-fg}  {white-fg}${v.vx >= 0 ? '+' : ''}${v.vx.toFixed(3)}{/white-fg} {white-fg}km/s{/white-fg}`,
    `{cyan-fg}Vy{/cyan-fg}  {white-fg}${v.vy >= 0 ? '+' : ''}${v.vy.toFixed(3)}{/white-fg} {white-fg}km/s{/white-fg}`,
    `{cyan-fg}Vz{/cyan-fg}  {white-fg}${v.vz >= 0 ? '+' : ''}${v.vz.toFixed(3)}{/white-fg} {white-fg}km/s{/white-fg}`,
    ``,
    `{cyan-fg}|V|{/cyan-fg} {bold}{white-fg}${mag.toFixed(3)}{/white-fg}{/bold} {white-fg}km/s{/white-fg}`,
    `{cyan-fg}${gauge}{/cyan-fg}`,
  ];
  velocityBox.setContent(lines.join('\n'));
}

function renderTimeline() {
  const now = new Date();
  const mStart = new Date('2026-04-01T22:35:00Z');
  let currentIdx = -1;
  for (let i = 0; i < MISSION_EVENTS.length; i++) {
    if (now >= new Date(MISSION_EVENTS[i].time)) currentIdx = i;
  }

  const lines = MISSION_EVENTS.map((evt, i) => {
    const isPast = i < currentIdx;
    const isCurrent = i === currentIdx;

    // Status indicator
    let dot, nameColor, timeColor;
    if (isCurrent) {
      dot = `{bold}{yellow-fg}${BLOCKS.arrowR}${BLOCKS.circle}{/yellow-fg}{/bold}`;
      nameColor = 'yellow';
      timeColor = 'yellow';
    } else if (isPast) {
      dot = `{green-fg} ${BLOCKS.circle}{/green-fg}`;
      nameColor = 'green';
      timeColor = 'white';
    } else {
      dot = `{white-fg} ${BLOCKS.ring}{/white-fg}`;
      nameColor = 'white';
      timeColor = 'white';
    }

    const timeStr = fmtTime(evt.time);
    
    // Calculate abbreviated expected MET
    const evtTime = new Date(evt.time);
    const diff = evtTime - mStart;
    const isNegative = diff < 0;
    const absDiff = Math.abs(diff);
    const d = Math.floor(absDiff / 86400000);
    const h = Math.floor((absDiff % 86400000) / 3600000);
    const sign = isNegative ? 'T-' : 'T+';
    const metStr = `(${sign}${d}d ${h.toString().padStart(2, '0')}h)`;

    const padLen = Math.max(1, 16 - evt.event.length);
    return `${dot} {${nameColor}-fg}${evt.event}{/${nameColor}-fg}${' '.repeat(padLen)}{${timeColor}-fg}${timeStr} ${metStr}{/${timeColor}-fg}`;
  });

  timelineBox.setContent(lines.join('\n'));
}

function renderObserver() {
  if (!telemetry || !telemetry.observer) {
    observerBox.setContent(`{yellow-fg}${BLOCKS.medium.repeat(3)} Loading...{/yellow-fg}`);
    return;
  }
  
  const obs = telemetry.observer;
  const lt = telemetry.earth.light_time_sec;
  
  const delayStr = Number(lt || 0).toFixed(3) + 's';

  const lines = [
    `{cyan-fg}COMMS DELAY{/cyan-fg}  {bold}{yellow-fg}${delayStr}{/yellow-fg}{/bold}  ` +
    `               ` +
    `{cyan-fg}SKY POS{/cyan-fg}  RA ${obs.ra}  DEC ${obs.dec}`
  ];
  observerBox.setContent('\n ' + lines.join('\n'));
}

function renderCrew() {
  const line = CREW.map(c => {
    return `{bold}{white-fg}${c.name}{/white-fg}{/bold} {white-fg}${c.role}{/white-fg}`;
  }).join('  {cyan-fg}│{/cyan-fg}  ');

  crewBox.setContent(`\n ${line}`);
  crewBox.height = 4;
}

function renderStatusBar() {
  const source = `{cyan-fg}${BLOCKS.diamond} JPL Horizons (NASA/JPL){/cyan-fg}`;
  const updated = lastUpdateDate
    ? `{cyan-fg}API sync at {bold}{white-fg}${fmtTime(lastUpdateDate)}{/white-fg}{/bold}{/cyan-fg}`
    : `{yellow-fg}${BLOCKS.medium.repeat(2)} Fetching API...{/yellow-fg}`;
  const keys = `{white-fg}q{/white-fg}:quit  {white-fg}m{/white-fg}:${useMiles ? 'km' : 'mi'}  {white-fg}t{/white-fg}:tz (${TIMEZONES[currentTzIdx].label})  {white-fg}r{/white-fg}:refresh API`;
  statusBar.setContent(` ${source}  ${BLOCKS.dot}  ${updated}  ${BLOCKS.dot}  ${keys}`);
}

function renderAll() {
  renderTitle();
  renderTelemetry();
  renderTracker();
  renderVelocity();
  renderTimeline();
  renderObserver();
  renderCrew();
  renderStatusBar();
  screen.render();
}

// ─── Data Refresh ───────────────────────────────────────────────────

async function refreshAPI() {
  try {
    errorMsg = null;
    await fetchTelemetry();
    telemetry = getExtrapolatedTelemetry();
    lastUpdateDate = new Date();
    renderAll();
  } catch (err) {
    errorMsg = err.message || 'Failed to fetch API';
    renderAll();
  }
}

function tickLive() {
  try {
    const liveTpl = getExtrapolatedTelemetry();
    if (liveTpl) {
      telemetry = liveTpl;
      renderAll();
    }
  } catch (e) {
    // Fail silently on ticks if extrapolation breaks
  }
}

function startRefreshLoop() {
  refreshAPI(); // Initial fetch
  refreshTimer = setInterval(refreshAPI, 120_000); // JPL API sync 2 mins
  tickTimer = setInterval(tickLive, 250); // Math update 4 FPS
}

// ─── Keyboard Handlers ─────────────────────────────────────────────

screen.key(['q', 'C-c'], () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (tickTimer) clearInterval(tickTimer);
  process.exit(0);
});

screen.key(['m'], () => {
  useMiles = !useMiles;
  renderAll();
});

screen.key(['t'], () => {
  currentTzIdx = (currentTzIdx + 1) % TIMEZONES.length;
  renderAll();
});

screen.key(['r'], () => {
  lastUpdateDate = null;
  renderStatusBar();
  screen.render();
  refreshAPI();
});

screen.on('resize', () => renderAll());

// ─── Start ──────────────────────────────────────────────────────────
renderAll();
startRefreshLoop();

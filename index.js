#!/usr/bin/env node

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { fetchTelemetry, MISSION_EVENTS, CREW } from './lib/horizons.js';

// ─── State ───────────────────────────────────────────────────────────
let useMiles = false;
let telemetry = null;
let lastUpdate = null;
let errorMsg = null;
let refreshTimer = null;

// Average Earth-Moon distance for the tracker bar
const EARTH_MOON_AVG_KM = 384_400;
const EARTH_MOON_AVG_MI = Math.round(EARTH_MOON_AVG_KM * 0.621371);

// ─── Screen Setup ────────────────────────────────────────────────────
const screen = blessed.screen({
  smartCSR: true,
  title: 'Artemis II Tracker',
  fullUnicode: true,
});

// ─── Main Container ─────────────────────────────────────────────────
const mainBox = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  style: {
    bg: 'black',
  },
});

// ─── Title Bar ──────────────────────────────────────────────────────
const titleBar = blessed.box({
  parent: mainBox,
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  content: '',
  tags: true,
  style: {
    bg: 'black',
    fg: 'cyan',
  },
});

// ─── Telemetry Box (left column, top) ───────────────────────────────
const telemetryBox = blessed.box({
  parent: mainBox,
  top: 3,
  left: 1,
  width: '30%',
  height: 11,
  label: ' TELEMETRY ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true },
    bg: 'black',
    fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Orion Tracker (right column, top) ──────────────────────────────
const trackerBox = blessed.box({
  parent: mainBox,
  top: 3,
  left: '32%',
  width: '67%',
  height: 7,
  label: ' ORION TRACKER ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true },
    bg: 'black',
    fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Velocity Box (left column, bottom) ─────────────────────────────
const velocityBox = blessed.box({
  parent: mainBox,
  top: 14,
  left: 1,
  width: '30%',
  height: 7,
  label: ' VELOCITY ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true },
    bg: 'black',
    fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Mission Timeline (right column, bottom) ────────────────────────
const timelineBox = blessed.box({
  parent: mainBox,
  top: 10,
  left: '32%',
  width: '67%',
  height: 11,
  label: ' MISSION TIMELINE ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true },
    bg: 'black',
    fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Crew Box (full width) ──────────────────────────────────────────
const crewBox = blessed.box({
  parent: mainBox,
  top: 21,
  left: 1,
  width: '98%',
  height: 4,
  label: ' CREW ',
  tags: true,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    label: { fg: 'cyan', bold: true },
    bg: 'black',
    fg: 'white',
  },
  padding: { left: 1, right: 1 },
});

// ─── Status Bar ─────────────────────────────────────────────────────
const statusBar = blessed.box({
  parent: mainBox,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: {
    bg: 'black',
    fg: 'white',
  },
});

// ─── Formatting Helpers ─────────────────────────────────────────────
function fmtNum(n) {
  if (n == null || isNaN(n)) return '---';
  return n.toLocaleString('en-US');
}

function fmtDist(km, mi) {
  if (useMiles) return `${fmtNum(mi)} mi`;
  return `${fmtNum(km)} km`;
}

function fmtSpeed(kmph, mph) {
  if (useMiles) return `${fmtNum(mph)} mph`;
  return `${fmtNum(kmph)} km/h`;
}

function toEDT(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(',', '') + ' EDT';
}

function toEDTShort(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(',', '');
}

function nowEDT() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' EDT';
}

// ─── Render Functions ───────────────────────────────────────────────

function renderTitle() {
  const w = screen.width;
  const title = ' ARTEMIS II TRACKER ';
  const pad = Math.max(0, Math.floor((w - title.length) / 2));
  titleBar.setContent(
    '\n' +
    '{bold}{cyan-fg}' + ' '.repeat(pad) + title + '{/cyan-fg}{/bold}'
  );
}

function renderTelemetry() {
  if (!telemetry) {
    telemetryBox.setContent(errorMsg
      ? `{red-fg}${errorMsg}{/red-fg}`
      : '{yellow-fg}Loading...{/yellow-fg}');
    return;
  }

  const d = telemetry;
  const unit = useMiles ? 'mi' : 'km';
  const lines = [
    `{cyan-fg}Spacecraft:{/cyan-fg} {white-fg}${d.spacecraft}{/white-fg}`,
    `{cyan-fg}Phase:{/cyan-fg}      {yellow-fg}${d.mission_phase}{/yellow-fg}`,
    `{cyan-fg}MET:{/cyan-fg}        {white-fg}${d.mission_elapsed.formatted}{/white-fg}`,
    `{cyan-fg}Earth:{/cyan-fg}      {white-fg}${fmtDist(d.earth.distance_km, d.earth.distance_miles)}{/white-fg}`,
    `{cyan-fg}Moon:{/cyan-fg}       {white-fg}${fmtDist(d.moon.distance_km, d.moon.distance_miles)}{/white-fg}`,
    `{cyan-fg}Speed:{/cyan-fg}      {white-fg}${fmtSpeed(d.earth.speed_kmph, d.earth.speed_mph)}{/white-fg}`,
    `{cyan-fg}Next:{/cyan-fg}       {white-fg}${d.next_event ? d.next_event.event : 'Mission Complete'}{/white-fg}`,
  ];
  telemetryBox.setContent(lines.join('\n'));
}

function renderTracker() {
  if (!telemetry) {
    trackerBox.setContent(errorMsg
      ? `{red-fg}${errorMsg}{/red-fg}`
      : '{yellow-fg}Loading...{/yellow-fg}');
    return;
  }

  const d = telemetry;
  const earthDist = d.earth.distance_km;
  const moonDist = d.moon.distance_km;
  const totalDist = earthDist + moonDist;

  // Available width inside the box (accounting for border + padding)
  const innerWidth = Math.max(20, (trackerBox.width || 60) - 4);

  // Position of Orion on the track (0 = Earth, 1 = Moon)
  const ratio = Math.min(1, Math.max(0, earthDist / totalDist));
  const trackLen = innerWidth - 2; // leave room for Earth and Moon symbols
  const orionPos = Math.round(ratio * (trackLen - 1));

  // Build the track line
  let track = '';
  for (let i = 0; i < trackLen; i++) {
    if (i === orionPos) {
      track += '{yellow-fg}\u25C6{/yellow-fg}'; // diamond for Orion
    } else {
      track += '{black-fg}\u2500{/black-fg}'; // dim dash
    }
  }

  const line1 = `{blue-fg}\u25CF{/blue-fg}${track}{white-fg}\u25CB{/white-fg}`;
  const line2 = `{blue-fg}EARTH{/blue-fg}` +
    ' '.repeat(Math.max(1, Math.floor(orionPos / 2))) +
    '{yellow-fg}ORION{/yellow-fg}' +
    ' '.repeat(Math.max(1, trackLen - orionPos - 5)) +
    '{white-fg}MOON{/white-fg}';

  // Scale bar
  const unit = useMiles ? 'mi' : 'km';
  const maxDist = useMiles ? EARTH_MOON_AVG_MI : EARTH_MOON_AVG_KM;
  const q1 = Math.round(maxDist * 0.25);
  const q2 = Math.round(maxDist * 0.5);
  const q3 = Math.round(maxDist * 0.75);
  const scaleWidth = innerWidth;
  const seg = Math.floor(scaleWidth / 4);
  const s0 = `0${unit}`;
  const s1 = `${fmtNum(q1)}`;
  const s2 = `${fmtNum(q2)}`;
  const s3 = `${fmtNum(q3)}`;
  const s4 = `${fmtNum(maxDist)}`;

  const scaleLine = '{black-fg}' +
    s0 + ' '.repeat(Math.max(1, seg - s0.length)) +
    s1 + ' '.repeat(Math.max(1, seg - s1.length)) +
    s2 + ' '.repeat(Math.max(1, seg - s2.length)) +
    s3 + ' '.repeat(Math.max(1, seg - s3.length)) +
    s4 +
    '{/black-fg}';

  trackerBox.setContent(`\n${line1}\n${line2}\n${scaleLine}`);
}

function renderVelocity() {
  if (!telemetry) {
    velocityBox.setContent(errorMsg
      ? `{red-fg}Error{/red-fg}`
      : '{yellow-fg}Loading...{/yellow-fg}');
    return;
  }

  const v = telemetry.earth.velocity_kmps;
  const lines = [
    '',
    `{cyan-fg}Vx:{/cyan-fg}  {white-fg}${v.vx.toFixed(3)} km/s{/white-fg}`,
    `{cyan-fg}Vy:{/cyan-fg}  {white-fg}${v.vy.toFixed(3)} km/s{/white-fg}`,
    `{cyan-fg}Vz:{/cyan-fg}  {white-fg}${v.vz.toFixed(3)} km/s{/white-fg}`,
    `{cyan-fg}|V|:{/cyan-fg} {white-fg}${telemetry.earth.speed_kmps.toFixed(3)} km/s{/white-fg}`,
  ];
  velocityBox.setContent(lines.join('\n'));
}

function renderTimeline() {
  const now = new Date();
  const lines = MISSION_EVENTS.map((evt) => {
    const evtTime = new Date(evt.time);
    const isPast = now >= evtTime;

    // Check if this is the "current" event (last completed event)
    let isCurrent = false;
    if (isPast) {
      const idx = MISSION_EVENTS.indexOf(evt);
      const nextEvt = MISSION_EVENTS[idx + 1];
      if (!nextEvt || now < new Date(nextEvt.time)) {
        isCurrent = true;
      }
    }

    const dot = isCurrent
      ? '{yellow-fg}\u25CF{/yellow-fg}'
      : isPast
        ? '{green-fg}\u25CF{/green-fg}'
        : '{black-fg}\u25CB{/black-fg}';

    const evtName = isCurrent
      ? `{yellow-fg}${evt.event}{/yellow-fg}`
      : isPast
        ? `{green-fg}${evt.event}{/green-fg}`
        : `{black-fg}${evt.event}{/black-fg}`;

    const timeStr = toEDTShort(evt.time) + ' EDT';
    const timeColored = isCurrent
      ? `{yellow-fg}${timeStr}{/yellow-fg}`
      : isPast
        ? `{green-fg}${timeStr}{/green-fg}`
        : `{black-fg}${timeStr}{/black-fg}`;

    // Pad event name for alignment
    const padLen = Math.max(1, 18 - evt.event.length);
    return `${dot} ${evtName}${' '.repeat(padLen)}${timeColored}`;
  });
  timelineBox.setContent(lines.join('\n'));
}

function renderCrew() {
  const crewStr = CREW.map(c => `{white-fg}${c.name}{/white-fg} {cyan-fg}(${c.role}){/cyan-fg}`).join('    ');
  crewBox.setContent('\n' + crewStr);
}

function renderStatusBar() {
  const source = '{cyan-fg}Data: JPL Horizons (NASA/JPL){/cyan-fg}';
  const updated = lastUpdate
    ? `{cyan-fg}Updated {white-fg}${lastUpdate}{/white-fg}{/cyan-fg}`
    : '{yellow-fg}Fetching...{/yellow-fg}';
  const keys = '{cyan-fg}q{/cyan-fg}:quit  {cyan-fg}m{/cyan-fg}:' + (useMiles ? 'km' : 'mi') + '  {cyan-fg}r{/cyan-fg}:refresh';
  statusBar.setContent(` ${source}  |  ${updated}  |  ${keys}`);
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
  refreshTimer = setInterval(refresh, 120_000); // 2 minutes
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

// ─── Handle Resize ──────────────────────────────────────────────────
screen.on('resize', () => {
  renderAll();
});

// ─── Start ──────────────────────────────────────────────────────────
renderAll();
startRefreshLoop();

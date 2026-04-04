import fetch from 'node-fetch';

// JPL Horizons API base
const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const ORION_ID = '-1024'; // Artemis II / Integrity Orion EM-2

// Cache to avoid hammering JPL (they ask for one request at a time)
let cache = { earth: null, moon: null, observer: null };
let cacheTime = { earth: 0, moon: 0, observer: 0 };
const CACHE_TTL = 120_000; // 2 minutes

// Mission timeline events (UTC) — sourced from JPL Horizons spacecraft object data
export const MISSION_EVENTS = [
  { time: '2026-04-01T22:35:00Z', event: 'Launch', description: 'SLS liftoff from LC-39B, Kennedy Space Center' },
  { time: '2026-04-02T23:49:00Z', event: 'TLI', description: 'Trans-Lunar Injection burn (5m 55s, 388 m/s delta-v)' },
  { time: '2026-04-06T04:43:00Z', event: 'Lunar SOI Entry', description: 'Orion enters lunar sphere of influence' },
  { time: '2026-04-06T23:06:00Z', event: 'Lunar Flyby', description: 'Closest approach to the Moon' },
  { time: '2026-04-07T17:27:00Z', event: 'Lunar SOI Exit', description: 'Orion exits lunar sphere of influence' },
  { time: '2026-04-11T00:04:00Z', event: 'Entry Interface', description: 'Entry interface — 122 km above Earth' },
  { time: '2026-04-11T00:17:00Z', event: 'Splashdown', description: 'Pacific Ocean splashdown off Baja California' },
];

// Crew manifest
export const CREW = [
  { name: 'Reid Wiseman', role: 'CDR' },
  { name: 'Victor Glover', role: 'PLT' },
  { name: 'Christina Koch', role: 'MS1' },
  { name: 'Jeremy Hansen', role: 'MS2, CSA' },
];

/**
 * Parse Horizons vector table text into structured data.
 * The result field contains the full text output; we extract
 * rows between $$SOE and $$EOE markers.
 */
function parseVectors(resultText) {
  const soeIdx = resultText.indexOf('$$SOE');
  const eoeIdx = resultText.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return [];

  const block = resultText.substring(soeIdx + 5, eoeIdx).trim();
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

  const entries = [];
  // Horizons vector table format: each entry is 3 lines
  // Line 1: JDTDB = ..., CalendarDate(TDB) = ...
  // Line 2: X = ... Y = ... Z = ...
  // Line 3: VX= ... VY= ... VZ= ...
  for (let i = 0; i < lines.length; i += 4) {
    if (i + 3 >= lines.length) break;
    const timeLine = lines[i];
    const posLine = lines[i + 1];
    const velLine = lines[i + 2];
    const exLine = lines[i + 3];

    // Extract calendar date
    const calMatch = timeLine.match(/A\.D\.\s+(\d{4}-[A-Za-z]{3}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/);
    const jdMatch = timeLine.match(/(\d+\.\d+)\s*=/);

    // Extract position values
    const xMatch = posLine.match(/X\s*=\s*([-\d.E+]+)/i);
    const yMatch = posLine.match(/Y\s*=\s*([-\d.E+]+)/i);
    const zMatch = posLine.match(/Z\s*=\s*([-\d.E+]+)/i);

    // Extract velocity values
    const vxMatch = velLine.match(/VX\s*=\s*([-\d.E+]+)/i);
    const vyMatch = velLine.match(/VY\s*=\s*([-\d.E+]+)/i);
    const vzMatch = velLine.match(/VZ\s*=\s*([-\d.E+]+)/i);

    // Extract LT
    const ltMatch = exLine.match(/LT=\s*([-\d.E+]+)/i);

    if (xMatch && yMatch && zMatch && vxMatch && vyMatch && vzMatch) {
      const x = parseFloat(xMatch[1]);
      const y = parseFloat(yMatch[1]);
      const z = parseFloat(zMatch[1]);
      const vx = parseFloat(vxMatch[1]);
      const vy = parseFloat(vyMatch[1]);
      const vz = parseFloat(vzMatch[1]);
      const distance = Math.sqrt(x * x + y * y + z * z);
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const lt = ltMatch ? parseFloat(ltMatch[1]) : 0;

      let timestampMs = null;
      if (calMatch) {
        // e.g. "2026-Apr-03 22:15:00.000" -> we append Z to parse as UTC
        const parsedDate = new Date(calMatch[1].trim() + 'Z');
        if (!isNaN(parsedDate.getTime())) {
          timestampMs = parsedDate.getTime();
        }
      }

      entries.push({
        calendar: calMatch ? calMatch[1].trim() : null,
        timestampMs,
        jd: jdMatch ? parseFloat(jdMatch[1]) : null,
        position: { x, y, z },
        velocity: { vx, vy, vz },
        distance_km: distance,
        speed_kmps: speed,
        speed_kmph: speed * 3600,
        light_time_sec: lt,
      });
    }
  }
  return entries;
}

/**
 * Fetch vectors from Horizons for a given center body.
 * center: '500@399' (Earth) or '500@301' (Moon)
 */
async function fetchVectors(center, startTime, stopTime, stepSize = '10m') {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${ORION_ID}'`,
    EPHEM_TYPE: 'VECTORS',
    CENTER: `'${center}'`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: `'${stepSize}'`,
    OUT_UNITS: 'KM-S',
    VEC_TABLE: '3',
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
  });

  const resp = await fetch(`${HORIZONS_API}?${params}`);
  if (!resp.ok) throw new Error(`Horizons API returned ${resp.status}`);
  const json = await resp.json();
  if (!json.result) throw new Error('No result from Horizons (VECTORS)');
  return parseVectors(json.result);
}

function parseObserver(resultText) {
  const soeIdx = resultText.indexOf('$$SOE');
  const eoeIdx = resultText.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) return [];

  const block = resultText.substring(soeIdx + 5, eoeIdx).trim();
  const lines = block.split('\n').filter(Boolean);

  const entries = [];
  const regex = /\s*(\d{4}-[A-Za-z]{3}-\d\d\s+\d\d:\d\d)\s+(\d{1,2}\s+\d{1,2}\s+[\d.]+)\s+([+-]\d{1,2}\s+\d{1,2}\s+[\d.]+)\s+/;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      entries.push({
        timeStr: match[1],
        ra: match[2].replace(/\s+/g, ':'), // e.g., 15:55:51.34
        dec: match[3].replace(/\s+/g, ':'), // e.g., -25:17:47.1
      });
    }
  }
  return entries;
}

async function fetchObserver(center, startTime, stopTime, stepSize = '10m') {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${ORION_ID}'`,
    EPHEM_TYPE: 'OBSERVER',
    CENTER: `'${center}'`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: `'${stepSize}'`,
    QUANTITIES: `'1,20,24'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
  });

  const resp = await fetch(`${HORIZONS_API}?${params}`);
  if (!resp.ok) throw new Error(`Horizons API returned ${resp.status}`);
  const json = await resp.json();
  if (!json.result) throw new Error('No result from Horizons (OBSERVER)');
  return parseObserver(json.result);
}

/**
 * Fetch current Artemis II telemetry data and update local cache.
 */
export async function fetchTelemetry() {
  const now = new Date();
  const start = new Date(now.getTime() - 5 * 60_000); // 5 min ago
  const stop = new Date(now.getTime() + 5 * 60_000);  // 5 min ahead
  // Vector dates use "YYYY-MM-DD HH:MM:SS" (no T)
  const fmt = (d) => d.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
  const useCache = (key) => cache[key] && (Date.now() - cacheTime[key] < CACHE_TTL);

  if (!useCache('earth') || !useCache('moon') || !useCache('observer')) {
    const earthData = await fetchVectors('500@399', fmt(start), fmt(stop), '5m');
    cache.earth = earthData;
    cacheTime.earth = Date.now();

    const moonData = await fetchVectors('500@301', fmt(start), fmt(stop), '5m');
    cache.moon = moonData;
    cacheTime.moon = Date.now();
    
    // Observer endpoint accepts the exact same format
    const obsData = await fetchObserver('500@399', fmt(start), fmt(stop), '5m');
    cache.observer = obsData;
    cacheTime.observer = Date.now();
  }
}

/**
 * Returns the latest telemetry dynamically extrapolated to the exact current millisecond.
 */
export function getExtrapolatedTelemetry() {
  if (!cache.earth || !cache.moon) return null;

  const now = new Date();
  
  const pickClosest = (entries) => {
    if (!entries || entries.length === 0) return null;
    return entries[Math.floor(entries.length / 2)];
  };

  const earthBase = pickClosest(cache.earth);
  const moonBase = pickClosest(cache.moon);
  const obsBase = pickClosest(cache.observer);

  if (!earthBase || !moonBase) {
    throw new Error('No ephemeris data available in cache');
  }

  const applyExtrapolation = (base, nowMs) => {
    if (!base.timestampMs) return base; // fallback
    const dt = (nowMs - base.timestampMs) / 1000;
    const x = base.position.x + base.velocity.vx * dt;
    const y = base.position.y + base.velocity.vy * dt;
    const z = base.position.z + base.velocity.vz * dt;
    const distance_km = Math.sqrt(x*x + y*y + z*z);

    return {
      position_km: { x, y, z },
      velocity_kmps: base.velocity,
      distance_km: Math.round(distance_km * 100) / 100, // Two decimals to see changes
      distance_miles: Math.round(distance_km * 0.621371 * 100) / 100,
      speed_kmps: Math.round(base.speed_kmps * 1000) / 1000,
      speed_kmph: Math.round(base.speed_kmph),
      speed_mph: Math.round(base.speed_kmph * 0.621371),
      light_time_sec: base.light_time_sec || 0,
    };
  };

  const earth = applyExtrapolation(earthBase, now.getTime());
  const moon = applyExtrapolation(moonBase, now.getTime());

  // Determine mission elapsed time
  const missionStart = new Date('2026-04-01T22:35:00Z');
  const elapsed = now - missionStart;
  const elapsedHours = elapsed / 3_600_000;
  const elapsedDays = elapsed / 86_400_000;

  let currentEvent = null;
  let nextEvent = null;
  for (let i = 0; i < MISSION_EVENTS.length; i++) {
    const eventTime = new Date(MISSION_EVENTS[i].time);
    if (now >= eventTime) {
      currentEvent = MISSION_EVENTS[i];
    } else if (!nextEvent) {
      nextEvent = MISSION_EVENTS[i];
    }
  }

  return {
    timestamp: now.toISOString(),
    mission_elapsed: {
      hours: Math.round(elapsedHours * 10) / 10,
      days: Math.round(elapsedDays * 100) / 100,
      formatted: `${Math.floor(elapsedDays)}d ${Math.floor(elapsedHours % 24)}h ${Math.floor((elapsed / 60_000) % 60)}m ${String(Math.floor((elapsed / 1000) % 60)).padStart(2, '0')}s`,
    },
    earth,
    moon,
    observer: obsBase || { ra: 'N/A', dec: 'N/A' },
    mission_phase: currentEvent?.event || 'Pre-Launch',
    current_event: currentEvent,
    next_event: nextEvent ? {
      event: nextEvent.event,
      description: nextEvent.description,
      time: nextEvent.time,
    } : null,
    source: 'JPL Horizons (NASA/JPL)',
    spacecraft: 'Orion',
  };
}

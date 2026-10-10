/**
 * A small line-icon set (24×24, stroke = currentColor), same visual language
 * as the agent-harness demo.
 */
const dot = (cx, cy, r = 1.1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

const P = {
  agent: `<rect x="4.5" y="8" width="15" height="11.5" rx="3.2"/><path d="M12 4.5V8"/>${dot(12, 3.6, 1.2)}${dot(9.4, 13.2)}${dot(14.6, 13.2)}<path d="M9.8 16.4h4.4"/><path d="M2.5 12.5v3M21.5 12.5v3"/>`,
  host: `<rect x="3.5" y="7" width="17" height="12.5" rx="3.2"/><path d="M8 7V4.5h8V7"/>${dot(9, 13)}${dot(15, 13)}<path d="M9.5 16.2h5"/>`,
  user: `<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.4-3.8 4.2-5.6 7.5-5.6s6.1 1.8 7.5 5.6"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/>`,
  coin: `<circle cx="12" cy="12" r="8.6"/><path d="M14.8 9.2c-.5-1-1.6-1.6-2.8-1.6-1.6 0-2.8.9-2.8 2.1 0 2.9 5.8 1.6 5.8 4.5 0 1.2-1.3 2.2-3 2.2-1.3 0-2.5-.6-3-1.7M12 6v1.6M12 16.4V18"/>`,
  pin: `<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>`,
  globe: `<circle cx="12" cy="12" r="8.8"/><path d="M3.2 12h17.6M12 3.2c2.4 2.6 3.6 5.5 3.6 8.8s-1.2 6.2-3.6 8.8c-2.4-2.6-3.6-5.5-3.6-8.8s1.2-6.2 3.6-8.8z"/>`,
  card: `<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="8.5" cy="11" r="2"/><path d="M6 15.5c.6-1.3 1.5-2 2.5-2s1.9.7 2.5 2M13.5 10h4.5M13.5 13.5h3"/>`,
  task: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4"/><path d="M8.5 11l2 2 4-4M8.5 16.5h7"/>`,
  artifact: `<path d="M12 3.5l8 4.5v8l-8 4.5-8-4.5V8z"/><path d="M4 8l8 4.5L20 8M12 12.5V20.5"/>`,
  stream: `<path d="M3.5 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 2.5-2M3.5 14c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 2.5-2"/>`,
  chat: `<path d="M4 5h16v11H9.5L5 19.8V16H4z"/>`,
  link: `<path d="M10 14a4 4 0 005.7 0l3.2-3.2a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3.2 3.2a4 4 0 005.7 5.7l1-1"/>`,
  shield: `<path d="M12 3l7 2.8v5.4c0 4.4-2.9 7.9-7 9.8-4.1-1.9-7-5.4-7-9.8V5.8z"/><path d="M9 12l2.1 2.1L15.2 10"/>`,
  model: `<path d="M11 3.5l1.9 4.9 4.9 1.9-4.9 1.9L11 17.1l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.2 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>`,
  question: `<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.4a2.5 2.5 0 014.8.9c0 1.7-2.4 2.1-2.4 3.7"/>${dot(12, 17)}`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  checkCircle: `<circle cx="12" cy="12" r="8.8"/><path d="M8.2 12.3l2.6 2.6 5-5.2"/>`,
  x: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  xCircle: `<circle cx="12" cy="12" r="8.8"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>`,
  alert: `<path d="M12 4l9 15.5H3z"/><path d="M12 10v4"/>${dot(12, 16.9)}`,
  info: `<circle cx="12" cy="12" r="8.8"/><path d="M12 11v5.2"/>${dot(12, 7.9)}`,
  clock: `<circle cx="12" cy="12" r="8.8"/><path d="M12 7v5l3.2 2"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>`,
  compass: `<circle cx="12" cy="12" r="8.8"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>`,
  download: `<path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>`,
  external: `<path d="M13.5 4.5h6v6M19.5 4.5l-8 8"/><path d="M17 13.5v5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 014 18.5v-10A1.5 1.5 0 015.5 7h5"/>`,
  refresh: `<path d="M4.5 12a7.5 7.5 0 0112.8-5.3L19.5 9"/><path d="M19.5 4v5h-5"/><path d="M19.5 12a7.5 7.5 0 01-12.8 5.3L4.5 15"/><path d="M4.5 20v-5h5"/>`,
  trash: `<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>`,
  book: `<path d="M4.5 5.5A2.5 2.5 0 017 3h12.5v15H7a2.5 2.5 0 00-2.5 2.5z"/><path d="M4.5 20.5v-15"/><path d="M8.5 7.5h7"/>`,
};

export function icon(name, size = 16, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.info}</svg>`;
}

/** Raw path data, for drawing icons inside the SVG map. */
export const iconPaths = (name) => P[name] ?? P.agent;

/** Task states: short label, colour token, plain-English meaning. */
export const STATES = {
  TASK_STATE_SUBMITTED: { short: 'Submitted', tone: 'neutral', what: 'The agent accepted the task and gave it an id.' },
  TASK_STATE_WORKING: { short: 'Working', tone: 'accent', what: 'The agent is busy on it.' },
  TASK_STATE_INPUT_REQUIRED: { short: 'Input required', tone: 'warn', what: 'Paused: the agent asked a question and waits for an answer on the same task.' },
  TASK_STATE_AUTH_REQUIRED: { short: 'Auth required', tone: 'warn', what: 'Paused: the agent needs the user to sign in somewhere first.' },
  TASK_STATE_COMPLETED: { short: 'Completed', tone: 'ok', what: 'Done. The results are in its artifacts.' },
  TASK_STATE_FAILED: { short: 'Failed', tone: 'err', what: 'The agent tried, but something went wrong.' },
  TASK_STATE_REJECTED: { short: 'Rejected', tone: 'err', what: 'The agent declined the task (outside what it does).' },
  TASK_STATE_CANCELED: { short: 'Canceled', tone: 'muted', what: 'Stopped by the client with CancelTask.' },
};
export const stateInfo = (s) => STATES[s] ?? { short: String(s ?? '?').replace('TASK_STATE_', '').toLowerCase(), tone: 'neutral', what: '' };
export const TERMINAL = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_REJECTED', 'TASK_STATE_CANCELED'];

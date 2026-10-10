/**
 * Agent Card handling: turn a card (A2A 1.0, or the older 0.3 shape) into one
 * internal format, and list problems a careful client should notice.
 *
 *  1.0: endpoints live in `supportedInterfaces[] = { url, protocolBinding, protocolVersion }`
 *  0.3: one `url` + `preferredTransport` (+ `additionalInterfaces`) and a top-level `protocolVersion`
 */
const REQUIRED = ['name', 'description', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills'];
const INJECTION = /ignore (all |any )?(previous|prior|above)|disregard|system prompt|you must|you are now|reveal|send (me|us) (the|your)|api key|password/i;

export function normalizeCard(raw, cardUrl) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['The response is not a JSON object, so it is not an Agent Card.'], warnings, raw };
  }

  let rpcUrl = null;
  let protocolVersion = null;
  let binding = null;
  const offered = [];

  if (Array.isArray(raw.supportedInterfaces) && raw.supportedInterfaces.length) {
    for (const i of raw.supportedInterfaces) offered.push(`${i.protocolBinding} ${i.protocolVersion}`);
    const rpc = raw.supportedInterfaces.filter((i) => /json-?rpc/i.test(i.protocolBinding ?? ''));
    const pick = rpc.find((i) => /^1(\.|$)/.test(i.protocolVersion ?? '')) ?? rpc[0];
    if (pick) {
      rpcUrl = pick.url;
      protocolVersion = pick.protocolVersion ?? '1.0';
      binding = 'JSONRPC';
    } else errors.push(`No JSON-RPC interface. This demo speaks the JSON-RPC binding; the agent offers: ${offered.join(', ')}.`);
  } else if (raw.url) {
    protocolVersion = raw.protocolVersion ?? '0.3';
    const transports = [{ url: raw.url, transport: raw.preferredTransport ?? 'JSONRPC' }, ...(raw.additionalInterfaces ?? [])];
    const rpc = transports.find((t) => /json-?rpc/i.test(t.transport ?? ''));
    if (rpc) {
      rpcUrl = rpc.url;
      binding = 'JSONRPC';
    } else errors.push('No JSON-RPC transport in this 0.3 card.');
    warnings.push(`Uses the older A2A ${protocolVersion} card format. The client will talk 0.3 to it (slash-style methods like message/send, lowercase states).`);
  } else {
    errors.push('The card has neither supportedInterfaces (A2A 1.0) nor url (A2A 0.3), so there is no endpoint to call.');
  }

  const missing = REQUIRED.filter((k) => raw[k] == null);
  if (missing.length) warnings.push(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);

  if (rpcUrl) {
    try { rpcUrl = new URL(rpcUrl, cardUrl).href; } catch { errors.push(`Endpoint URL is not valid: ${rpcUrl}`); rpcUrl = null; }
  }
  if (rpcUrl && cardUrl && new URL(rpcUrl).origin !== new URL(cardUrl).origin) {
    warnings.push(`Its endpoint (${new URL(rpcUrl).host}) is on a different host from its card (${new URL(cardUrl).host}). Fine if expected, but worth checking.`);
  }

  const schemes = Object.keys(raw.securitySchemes ?? {});
  const needsAuth = schemes.length > 0 && ((raw.securityRequirements ?? raw.security ?? []).length > 0);
  if (needsAuth) warnings.push(`Requires authentication (${schemes.join(', ')}). This demo can’t sign in for you, so calls will probably be refused with 401/403.`);

  const skills = (Array.isArray(raw.skills) ? raw.skills : []).map((s) => ({
    id: String(s.id ?? ''),
    name: String(s.name ?? s.id ?? 'skill'),
    description: String(s.description ?? ''),
    tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
    examples: Array.isArray(s.examples) ? s.examples.map(String) : [],
  }));
  if (!skills.length) warnings.push('Lists no skills, so a host agent can’t tell what it is good at.');

  const textToScan = [raw.description, ...skills.flatMap((s) => [s.description, ...s.examples])].join(' ');
  if (INJECTION.test(textToScan)) {
    warnings.push('Its description contains text that reads like instructions to an AI. Cards are written by the agent’s owner and are untrusted input: the host is told to treat them as data.');
  }

  return {
    errors,
    warnings,
    raw,
    cardUrl,
    name: String(raw.name ?? 'Unnamed agent'),
    description: String(raw.description ?? ''),
    version: String(raw.version ?? '?'),
    protocolVersion: protocolVersion ?? '?',
    is03: !!protocolVersion && !/^1(\.|$)/.test(protocolVersion),
    binding,
    rpcUrl,
    streaming: !!raw.capabilities?.streaming,
    pushNotifications: !!raw.capabilities?.pushNotifications,
    provider: raw.provider?.organization ?? null,
    documentationUrl: raw.documentationUrl ?? null,
    inputModes: raw.defaultInputModes ?? [],
    outputModes: raw.defaultOutputModes ?? [],
    needsAuth,
    securitySchemes: schemes,
    skills,
  };
}

/** Where to look for a card, given whatever the user typed. */
export function cardCandidates(input) {
  const url = new URL(input.trim());
  if (/\.json$/i.test(url.pathname)) return [url.href];
  const base = url.href.replace(/\/+$/, '');
  return [`${base}/.well-known/agent-card.json`, `${base}/.well-known/agent.json`];
}

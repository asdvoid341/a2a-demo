/**
 * Provider registry. Every adapter implements the same small interface:
 *   buildRequest({ system, tools, messages, model, apiKey, effort }) → { url, headers, body }
 *   parseResponse(json, model) → { content, reasoning, stopReason, usage, native }
 *   send?(req, signal)          (optional; defaults to an HTTP POST)
 * The adapters are shared with the agent-harness demo.
 */
import { anthropic } from './anthropic.js';
import { openai } from './openai.js';
import { gemini } from './gemini.js';
import { createDemoProvider } from './demo.js';
import { scriptedResponse } from '../host/demo-model.js';

export const PROVIDERS = {
  demo: createDemoProvider(scriptedResponse),
  anthropic,
  openai,
  gemini,
};

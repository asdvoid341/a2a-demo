import { toAnthropicMessages, parseAnthropicResponse } from './anthropic.js';
import { sleep } from '../host/util.js';

/**
 * Demo provider: a scripted stand-in for the LLM, so the site works without a key.
 *
 * Only the host's *reasoning* is fake. Discovery, every A2A request, the
 * streaming, the task lifecycle and the remote agents (with their real data
 * sources) are all real. It speaks the Anthropic wire format so the inspector
 * shows a realistic model request.
 */
export function createDemoProvider(respond) {
  return {
    id: 'demo',
    label: 'Demo (scripted host, no key)',
    keyPlaceholder: '',
    models: ['scripted-host'],
    defaultModel: 'scripted-host',
    needsKey: false,
    supportsEffort: false,

    buildRequest({ system, tools, messages, model }) {
      return {
        url: 'demo://scripted-model (runs in your browser, no network)',
        headers: { 'content-type': 'application/json' },
        body: {
          model,
          max_tokens: 16000,
          system,
          ...(tools.length && { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) }),
          messages: toAnthropicMessages(messages, model, 'demo'),
        },
      };
    },

    async send(req, signal) {
      await sleep(350 + Math.random() * 450, signal);
      return respond(req.body);
    },

    parseResponse: (json, model) => parseAnthropicResponse(json, model, 'demo'),
  };
}

/**
 * Currency Agent: a NON-streaming A2A agent backed by Frankfurter (ECB rates).
 * Shows: the plain SendMessage request/response, a direct Message reply with
 * no task (for "help"), INPUT_REQUIRED for a missing currency and REJECTED for
 * a currency it does not handle.
 */
(function () {
  'use strict';

  const SUPPORTED = 'AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR'.split(' ');
  const ALIASES = {
    '₹': 'INR', rupee: 'INR', rupees: 'INR', rs: 'INR', '$': 'USD', dollar: 'USD', dollars: 'USD', usd: 'USD',
    '€': 'EUR', euro: 'EUR', euros: 'EUR', '£': 'GBP', pound: 'GBP', pounds: 'GBP', '¥': 'JPY', yen: 'JPY',
    baht: 'THB', lira: 'TRY', yuan: 'CNY', franc: 'CHF', francs: 'CHF', bitcoin: 'BTC', btc: 'BTC',
  };
  const code = (s) => {
    if (!s) return null;
    const k = s.toLowerCase();
    return ALIASES[k] ?? ALIASES[s] ?? (/^[a-z]{3}$/i.test(s) ? s.toUpperCase() : null);
  };

  /** "Convert ₹75,000 to EUR" / "75k INR in euros" → { amount, from, to } */
  function parse(text, data) {
    if (data?.from || data?.amount) return { amount: Number(data.amount) || 1, from: code(data.from), to: code(data.to) };
    const t = text.replace(/,/g, '');
    const m = t.match(/([₹$€£¥])\s?(\d+(?:\.\d+)?)\s?(k|m)?/i) ?? t.match(/(\d+(?:\.\d+)?)\s?(k|m)?\s?([a-z]{3}\b|rupees?|dollars?|euros?|pounds?|yen|baht|lira|yuan|francs?|bitcoin)/i);
    let amount = 1;
    let from = null;
    if (m) {
      const symbolFirst = /[₹$€£¥]/.test(m[1]);
      const n = Number(symbolFirst ? m[2] : m[1]);
      const mult = (symbolFirst ? m[3] : m[2])?.toLowerCase();
      amount = n * (mult === 'k' ? 1e3 : mult === 'm' ? 1e6 : 1);
      from = code(symbolFirst ? m[1] : m[3]);
    }
    const toM = t.match(/\b(?:to|into|in)\s+([₹$€£¥]|[a-z]{3}\b|rupees?|dollars?|euros?|pounds?|yen|baht|lira|yuan|francs?|bitcoin)/i);
    return { amount, from, to: code(toM?.[1]) };
  }

  A2AServer.register({
    id: 'fx',
    card: (base) => ({
      name: 'Currency Agent',
      description: `Converts money between ${SUPPORTED.length} currencies using the European Central Bank’s daily reference rates.`,
      version: '0.9.1',
      supportedInterfaces: [{ url: `${base}a2a/v1`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      provider: { organization: 'A2A Demo (built-in agent)', url: 'https://frankfurter.dev' },
      documentationUrl: 'https://frankfurter.dev',
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
      skills: [
        {
          id: 'convert',
          name: 'Convert currency',
          description: `Convert an amount from one currency to another at today’s ECB rate. Supported: ${SUPPORTED.join(', ')}.`,
          tags: ['currency', 'money', 'exchange rate', 'budget', 'finance'],
          examples: ['Convert 75000 INR to EUR', '{"amount": 250, "from": "USD", "to": "JPY"}'],
        },
      ],
    }),

    // Questions that need no work get a direct Message back instead of a Task.
    quickReply(text) {
      if (/^\s*(help|what can you do|list|which currencies|supported)\b/i.test(text)) {
        return `I convert between ${SUPPORTED.length} currencies at the ECB’s daily rate: ${SUPPORTED.join(', ')}. Try “Convert 100 USD to EUR”.`;
      }
      return null;
    },

    async execute(ctx) {
      let req = ctx.resumed ? { ...ctx.internal.request } : parse(ctx.text, ctx.data);
      if (ctx.resumed) {
        const c = code(ctx.text.trim().replace(/[^\p{L}₹$€£¥]/gu, '')) ?? parse(`to ${ctx.text}`).to;
        if (!req.from) req.from = c; else req.to = c;
      }
      ctx.internal.request = req;
      if (!req.from) return ctx.inputRequired('Which currency is the amount in (e.g. INR, USD, EUR)?');
      if (!req.to) return ctx.inputRequired(`Which currency should I convert ${req.amount} ${req.from} into?`);
      for (const c of [req.from, req.to]) {
        if (!SUPPORTED.includes(c)) return ctx.reject(`I can’t convert ${c}. I only handle the ${SUPPORTED.length} currencies the ECB publishes rates for.`);
      }
      if (req.from === req.to) return ctx.complete(`${req.amount} ${req.from} is ${req.amount} ${req.to}.`);

      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${req.from}&symbols=${req.to}`, { signal: ctx.signal });
      if (!res.ok) return ctx.fail(`The rates service returned HTTP ${res.status}.`);
      const fx = await res.json();
      const rate = fx.rates?.[req.to];
      if (!rate) return ctx.fail('No rate came back for that pair.');
      const converted = Math.round(req.amount * rate * 100) / 100;
      const fmt = (n, c) => `${n.toLocaleString('en', { maximumFractionDigits: 2 })} ${c}`;
      await ctx.artifact({
        name: 'conversion',
        parts: [
          { text: `${fmt(req.amount, req.from)} = ${fmt(converted, req.to)} (ECB rate ${rate}, ${fx.date})` },
          { data: { amount: req.amount, from: req.from, to: req.to, rate, converted, date: fx.date, source: 'European Central Bank via frankfurter.dev' }, mediaType: 'application/json' },
        ],
      });
      await ctx.complete(`${fmt(req.amount, req.from)} is ${fmt(converted, req.to)}.`);
    },
  });
})();

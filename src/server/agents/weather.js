/**
 * Weather Agent: a streaming A2A agent backed by the free Open-Meteo API.
 * Shows: status updates while working, an artifact streamed in chunks
 * (append / lastChunk), INPUT_REQUIRED when the city is missing and FAILED
 * when the city does not exist.
 */
(function () {
  'use strict';
  const { sleep } = A2AServer.helpers;

  const WMO = [
    [[0], 'Clear sky', 'sun'], [[1], 'Mostly clear', 'sun'], [[2], 'Partly cloudy', 'cloud-sun'], [[3], 'Overcast', 'cloud'],
    [[45, 48], 'Fog', 'fog'], [[51, 53, 55, 56, 57], 'Drizzle', 'drizzle'], [[61, 63, 65, 66, 67], 'Rain', 'rain'],
    [[71, 73, 75, 77], 'Snow', 'snow'], [[80, 81, 82], 'Rain showers', 'rain'], [[85, 86], 'Snow showers', 'snow'], [[95, 96, 99], 'Thunderstorm', 'storm'],
  ];
  const describe = (code) => {
    const hit = WMO.find(([codes]) => codes.includes(code));
    return { conditions: hit?.[1] ?? 'Unknown', icon: hit?.[2] ?? 'cloud' };
  };

  /** "Weather in Lisbon for the next 3 days" → { city: 'Lisbon', days: 3 } */
  function parse(text, data) {
    if (data?.city) return { city: String(data.city), days: Number(data.days) || 3, startDate: data.startDate };
    const daysMatch = text.match(/(\d{1,2})\s*-?\s*days?/i);
    const days = daysMatch ? Number(daysMatch[1]) : 3;
    const startDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
    let city = text.match(/\b(?:in|for|at)\s+([A-ZÀ-ɏ][\p{L}'.-]*(?:[ -][A-ZÀ-ɏ][\p{L}'.-]*)*)/u)?.[1];
    if (!city) {
      const cleaned = text
        .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, ' ')
        .replace(/\b(what'?s|what is|the|daily|weather|forecast|please|next|for|in|at|days?|\d+|like|will|be|it|how|is|from|starting)\b/gi, ' ')
        .replace(/[^\p{L}' -]/gu, ' ')
        .trim();
      city = cleaned.split(/\s{2,}/)[0]?.trim();
    }
    return { city: city || null, days, startDate };
  }

  A2AServer.register({
    id: 'weather',
    card: (base) => ({
      name: 'Weather Agent',
      description: 'Day-by-day weather forecasts for any city in the world, up to 16 days ahead. Data from Open-Meteo.',
      version: '1.2.0',
      supportedInterfaces: [{ url: `${base}a2a/v1`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      provider: { organization: 'A2A Demo (built-in agent)', url: 'https://open-meteo.com' },
      documentationUrl: 'https://open-meteo.com/en/docs',
      capabilities: { streaming: true, pushNotifications: false },
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
      skills: [
        {
          id: 'daily-forecast',
          name: 'Daily forecast',
          description: 'High/low temperature, chance of rain and conditions for each day. Give a city, optionally a number of days (1–16) and a start date (YYYY-MM-DD).',
          tags: ['weather', 'forecast', 'travel', 'temperature', 'rain'],
          examples: ['Weather in Lisbon for the next 3 days', '{"city": "Tokyo", "days": 5, "startDate": "2026-10-20"}'],
        },
      ],
    }),

    async execute(ctx) {
      let { city, days, startDate } = ctx.resumed ? { ...ctx.internal.request, city: ctx.text } : parse(ctx.text, ctx.data);
      ctx.internal.request = { city, days, startDate };
      if (!city) return ctx.inputRequired('Which city should I forecast?');
      days = Math.max(1, Math.min(16, days || 3));

      await ctx.working(`Finding “${city}” on the map…`);
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`, { signal: ctx.signal }).then((r) => r.json());
      const place = geo.results?.[0];
      if (!place) return ctx.fail(`I couldn’t find a place called “${city}”.`);

      const where = `${place.name}, ${place.country ?? place.country_code}`;
      await ctx.working(`Found ${where}. Fetching a ${days}-day forecast…`);
      const q = new URLSearchParams({
        latitude: place.latitude, longitude: place.longitude, timezone: 'auto',
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code',
      });
      const today = new Date().toISOString().slice(0, 10);
      if (startDate && startDate >= today) {
        const end = new Date(Date.parse(startDate) + (days - 1) * 86400000).toISOString().slice(0, 10);
        q.set('start_date', startDate);
        q.set('end_date', end);
      } else q.set('forecast_days', days);
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: ctx.signal });
      const fc = await res.json();
      if (!res.ok || !fc.daily) return ctx.fail(`The forecast service said: ${fc.reason ?? res.status}. (Forecasts only go 16 days ahead.)`);

      const d = fc.daily;
      const out = d.time.map((date, i) => ({
        date,
        high: Math.round(d.temperature_2m_max[i]),
        low: Math.round(d.temperature_2m_min[i]),
        rainChance: d.precipitation_probability_max[i] ?? null,
        ...describe(d.weather_code[i]),
      }));

      // Stream the artifact one day at a time: the first chunk creates it, the rest append.
      const artifactId = `forecast-${ctx.task.id.slice(0, 8)}`;
      for (let i = 0; i < out.length; i++) {
        const x = out[i];
        const line = `${x.date}: ${x.conditions}, ${x.low}–${x.high}°C${x.rainChance != null ? `, ${x.rainChance}% chance of rain` : ''}`;
        const last = i === out.length - 1;
        await ctx.artifact({
          artifactId,
          name: 'forecast',
          description: `Daily forecast for ${where}`,
          parts: last
            ? [{ text: line }, { data: { city: place.name, country: place.country, countryCode: place.country_code, timezone: fc.timezone, latitude: place.latitude, longitude: place.longitude, days: out }, mediaType: 'application/json' }]
            : [{ text: line }],
          append: i > 0,
          lastChunk: last,
        });
        if (!last) await sleep(180);
      }
      await ctx.complete(`${out.length}-day forecast for ${where} is ready.`);
    },
  });
})();

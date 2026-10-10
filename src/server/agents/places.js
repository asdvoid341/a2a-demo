/**
 * Local Guide Agent: a streaming A2A agent backed by Wikipedia.
 * Shows: a multi-turn task. If you don't say what you're interested in, it
 * pauses in INPUT_REQUIRED and asks; the client answers by sending a new
 * message with the same taskId, and the same task carries on.
 */
(function () {
  'use strict';

  const CATEGORIES = {
    history: /palace|castle|monaster|fortress|fort\b|tower|monument|ruin|cathedral|church|basilica|convent|chapel|abbey|temple|shrine|mosque|synagogue|archaeolog|historic|aqueduct|memorial|tomb|mausoleum|citadel|wall/i,
    art: /museum|gallery|art\b|arts\b|theatre|theater|opera|foundation|cultural cent/i,
    nature: /park|garden|beach|viewpoint|miradouro|botanical|forest|aquarium|zoo|river|lake|hill|bay|island|nature/i,
    neighbourhoods: /neighbo(u)?rhood|quarter|district|market|square|street|avenue|praça|plaza|piazza|bairro|old town|bridge/i,
  };
  const SKIP = /university|school|college|station|metro|railway|hospital|company|club|stadium|football|ministry|embassy|court|bank|hotel|regime|government|parliament|police|airport|newspaper|party|federation|faculty|institute|parish/i;

  function parseInterests(text) {
    if (/\b(any|anything|everything|all|surprise|don'?t mind|no preference)\b/i.test(text)) return Object.keys(CATEGORIES);
    const t = text.toLowerCase();
    const out = [];
    if (/histor|old|ancient|castle|church|palace|heritage/.test(t)) out.push('history');
    if (/\bart|museum|galler|culture|design/.test(t)) out.push('art');
    if (/nature|park|garden|outdoor|beach|view|green|walk/.test(t)) out.push('nature');
    if (/neighbo|food|market|street|local|nightlife|shopping|vibe|square|eat/.test(t)) out.push('neighbourhoods');
    return out;
  }

  function parseCity(text, data) {
    if (data?.city) return String(data.city);
    return text.match(/\b(?:in|of|around|near|visit(?:ing)?|to)\s+([A-ZÀ-ɏ][\p{L}'.-]*(?:[ -][A-ZÀ-ɏ][\p{L}'.-]*)*)/u)?.[1] ?? null;
  }

  A2AServer.register({
    id: 'places',
    card: (base) => ({
      name: 'Local Guide Agent',
      description: 'Suggests sights worth visiting near a city centre, matched to what you enjoy. Uses Wikipedia’s geographic index.',
      version: '2.0.0',
      supportedInterfaces: [{ url: `${base}a2a/v1`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      provider: { organization: 'A2A Demo (built-in agent)', url: 'https://www.wikipedia.org' },
      capabilities: { streaming: true, pushNotifications: false },
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain', 'application/json'],
      skills: [
        {
          id: 'sights',
          name: 'Sights to see',
          description: 'Top sights within 10 km of a city centre, filtered by interest: history, art, nature or neighbourhoods. If you don’t say what you like, it will ask.',
          tags: ['travel', 'sightseeing', 'attractions', 'museums', 'itinerary'],
          examples: ['Top sights in Lisbon for history and art', '{"city": "Kyoto", "interests": ["history", "nature"]}'],
        },
      ],
    }),

    async execute(ctx) {
      const st = ctx.internal;
      if (ctx.resumed) {
        if (!st.city) st.city = parseCity(`in ${ctx.text}`, null) ?? ctx.text.trim();
        else st.interests = parseInterests(ctx.text);
      } else {
        st.city = parseCity(ctx.text, ctx.data);
        st.interests = Array.isArray(ctx.data?.interests) ? ctx.data.interests.filter((i) => CATEGORIES[i]) : parseInterests(ctx.text);
      }
      if (!st.city) return ctx.inputRequired('Which city are you visiting?');
      if (!st.interests?.length) {
        return ctx.inputRequired(`What are you into in ${st.city}? For example history, art, nature or neighbourhoods (or say “anything”).`);
      }

      await ctx.working(`Looking up ${st.city} on Wikipedia…`);
      const sumRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(st.city.replace(/ /g, '_'))}`, { signal: ctx.signal });
      const summary = sumRes.ok ? await sumRes.json() : null;
      const coords = summary?.coordinates;
      if (!coords) return ctx.fail(`I couldn’t find the centre of “${st.city}” on Wikipedia.`);

      await ctx.working(`Scanning places within 10 km of ${summary.title} for ${st.interests.join(', ')}…`);
      const q = new URLSearchParams({
        action: 'query', generator: 'geosearch', ggscoord: `${coords.lat}|${coords.lon}`, ggsradius: '10000', ggslimit: '500',
        prop: 'description|info|coordinates', format: 'json', formatversion: '2', origin: '*',
      });
      const geo = await fetch(`https://en.wikipedia.org/w/api.php?${q}`, { signal: ctx.signal }).then((r) => r.json());
      const pages = geo.query?.pages ?? [];

      const sights = [];
      for (const p of pages) {
        const label = `${p.title} ${p.description ?? ''}`;
        if (p.title === summary.title || SKIP.test(label)) continue;
        const category = st.interests.find((c) => CATEGORIES[c].test(label));
        if (!category) continue;
        const c = p.coordinates?.[0];
        const km = c ? Math.round(haversine(coords.lat, coords.lon, c.lat, c.lon) * 10) / 10 : null;
        sights.push({ title: p.title, description: p.description ?? '', category, distanceKm: km, size: p.length ?? 0, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}` });
      }
      // Article length is a decent proxy for how notable a place is.
      sights.sort((a, b) => b.size - a.size);
      const top = [];
      for (const cat of st.interests) top.push(...sights.filter((s) => s.category === cat).slice(0, Math.ceil(9 / st.interests.length)));
      const picked = top.slice(0, 9).map(({ size, ...s }) => s);
      if (!picked.length) return ctx.fail(`I didn’t find ${st.interests.join('/')} sights near ${summary.title}. Try other interests.`);

      await ctx.artifact({
        name: 'sights',
        description: `Sights in ${summary.title} for ${st.interests.join(', ')}`,
        parts: [
          { text: picked.map((s, i) => `${i + 1}. ${s.title} (${s.category}${s.distanceKm != null ? `, ${s.distanceKm} km from centre` : ''}): ${s.description}`).join('\n') },
          { data: { city: summary.title, about: summary.extract, interests: st.interests, sights: picked }, mediaType: 'application/json' },
        ],
      });
      await ctx.complete(`Picked ${picked.length} sights in ${summary.title}.`);
    },
  });

  function haversine(lat1, lon1, lat2, lon2) {
    const r = (d) => (d * Math.PI) / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }
})();

/**
 * Minimal Server-Sent Events reader for a fetch() Response.
 * (EventSource can't be used: A2A streams are opened with a POST body.)
 * Yields the `data:` payload of each event.
 */
export async function* readSSE(response) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const chunk = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const data = chunk
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
      }
    }
    if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

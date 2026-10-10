/** Short concept notes for the Technical view, with links to where each lives in the code. */
export const CONCEPTS = [
  {
    icon: 'link', title: 'A2A in one paragraph',
    body: 'A2A (Agent2Agent) is an open protocol, now at version 1.0 under the Linux Foundation, for agents built by different teams, on different frameworks, to work together. One agent (the <b>client</b>, here the host) sends a <b>message</b> to another (the <b>remote agent</b>). The remote agent either answers directly or creates a <b>task</b>, works on it, and returns <b>artifacts</b>. The remote agent stays <b>opaque</b>: its prompts, tools and memory are never exposed.',
  },
  {
    icon: 'model', title: 'A2A vs MCP',
    body: '<b>MCP</b> connects an agent to <i>tools and data</i>: the agent sees each tool’s schema and decides exactly how to call it. <b>A2A</b> connects an agent to <i>other agents</i>: you describe the goal in natural language and the other agent decides how to do it, can ask questions, and can take minutes or hours. They fit together: a remote agent may use MCP internally. See the <a href="https://asdvoid341.github.io/agent-harness/" target="_blank" rel="noopener">agent-harness demo</a> for the tool side.',
  },
  {
    icon: 'card', title: 'Agent Card',
    body: 'A JSON document at <code>https://host/.well-known/agent-card.json</code>. Required: <code>name</code>, <code>description</code>, <code>version</code>, <code>supportedInterfaces</code> (URL + <code>protocolBinding</code> + <code>protocolVersion</code>), <code>capabilities</code>, <code>defaultInputModes</code>/<code>defaultOutputModes</code> and <code>skills</code>. Optional: <code>provider</code>, <code>securitySchemes</code>, signatures. It is how agents are discovered, and the only thing a client knows about the agent.',
    code: [['card.js', 'src/a2a/card.js'], ['weather card', 'src/server/agents/weather.js']],
  },
  {
    icon: 'task', title: 'Task and its states',
    body: 'A task has an <code>id</code>, a <code>contextId</code>, a <code>status</code> (state + optional message + timestamp), <code>artifacts</code> and <code>history</code>. States: <code>SUBMITTED</code>, <code>WORKING</code>, <code>INPUT_REQUIRED</code> and <code>AUTH_REQUIRED</code> (paused, waiting on the client), and the terminal <code>COMPLETED</code>, <code>FAILED</code>, <code>CANCELED</code>, <code>REJECTED</code>. A terminal task never restarts; follow-up work is a new task in the same context.',
    code: [['server task lifecycle', 'src/server/a2a-server.js']],
  },
  {
    icon: 'stream', title: 'Messages, parts and artifacts',
    body: 'Messages have a <code>role</code> (<code>ROLE_USER</code> or <code>ROLE_AGENT</code>) and <code>parts</code>. Each part holds exactly one of <code>text</code>, <code>data</code> (any JSON), <code>url</code> or <code>raw</code> bytes, plus an optional <code>mediaType</code>. Messages carry the conversation; <b>artifacts</b> carry the deliverables. Artifacts can arrive in chunks (<code>append</code>, <code>lastChunk</code>).',
  },
  {
    icon: 'stream', title: 'Three ways to get results',
    body: '<b>Request/response</b>: <code>SendMessage</code>, then poll with <code>GetTask</code> if it isn’t done. <b>Streaming</b>: <code>SendStreamingMessage</code> keeps the connection open and pushes Server-Sent Events (task, status updates, artifact updates). <b>Push notifications</b>: for very long tasks, the agent calls your webhook. This demo shows the first two (the Currency Agent doesn’t stream, the others do).',
    code: [['client.js', 'src/a2a/client.js'], ['sse.js', 'src/a2a/sse.js']],
  },
  {
    icon: 'link', title: 'JSON-RPC binding (and what changed in 1.0)',
    body: 'Calls are JSON-RPC 2.0 over HTTPS with an <code>A2A-Version: 1.0</code> header. Methods are PascalCase: <code>SendMessage</code>, <code>SendStreamingMessage</code>, <code>GetTask</code>, <code>ListTasks</code>, <code>CancelTask</code>, <code>SubscribeToTask</code>. Versus 0.3: no more <code>kind</code> fields, enums are <code>TASK_STATE_COMPLETED</code>-style, and the card lists endpoints in <code>supportedInterfaces</code>. The same operations also exist as gRPC and HTTP+JSON bindings. This client still talks 0.3 to older agents.',
    code: [['0.3 compatibility', 'src/a2a/client.js']],
  },
  {
    icon: 'shield', title: 'Trust and safety',
    body: 'Cards and agent outputs are written by someone else, so they are <b>untrusted input</b>: they can contain prompt injection. The host prompt says to treat them as data, the client flags suspicious card text, and the user approves before any message goes to an external agent. Real deployments add authentication (<code>securitySchemes</code>), signed cards and allow-lists.',
    code: [['host prompt', 'src/host/prompt.js'], ['approval', 'src/host/host.js']],
  },
  {
    icon: 'globe', title: 'Why a CORS proxy?',
    body: 'Browsers block a page from reading responses from another site unless that site sends CORS headers. Most A2A agents are built for server-to-server use and don’t. The built-in agents here run in this page’s Service Worker (same origin), so they just work; for agents elsewhere you can deploy the small Cloudflare Worker in <code>proxy/</code>.',
    code: [['sw.js', 'sw.js'], ['proxy/worker.js', 'proxy/worker.js']],
  },
];

/**
 * Site configuration.
 *  - repoUrl: your GitHub repository, so "where in the code" links work.
 *  - author / authorUrl: byline in the header. Leave author empty to hide it.
 *  - siblingUrl: link to the companion agent-harness demo.
 */
export const APP_CONFIG = {
  repoUrl: 'https://github.com/asdvoid341/a2a-demo',
  branch: 'main',
  author: 'asdvoid341',
  authorUrl: 'https://github.com/asdvoid341',
  siblingUrl: 'https://asdvoid341.github.io/agent-harness/',
};

export const sourceUrl = (path) => `${APP_CONFIG.repoUrl}/${path.endsWith('/') ? 'tree' : 'blob'}/${APP_CONFIG.branch}/${path}`;

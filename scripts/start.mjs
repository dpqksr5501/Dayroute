import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (!existsSync('node_modules/vite')) {
  console.error('Dependencies are missing. Run pnpm install first. See README.md.');
  process.exit(1);
}
const { createServer, preview } = await import('vite');
const server = process.argv.includes('--preview') ? await preview() : await createServer();
if ('listen' in server) await server.listen();
server.printUrls();
console.log('\nDayroute is local to this computer. Press Ctrl+C to stop.\n');

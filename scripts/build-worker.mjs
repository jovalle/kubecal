import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const output = 'dist-worker';
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const path of [
  'assets',
  'data',
  'style.css',
  ...(await readdir('.')).filter((name) => name.endsWith('.mjs')),
])
  await cp(path, `${output}/${path}`, { recursive: true });
const html = (await readFile('index.html', 'utf8')).replace(
  'name="proxy" content=""',
  'name="proxy" content="/api/slides"',
);
await writeFile(`${output}/index.html`, html);

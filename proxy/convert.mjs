import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const bundledOffice = join(
  homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice',
);
const office = existsSync(bundledOffice) ? bundledOffice : 'soffice';

export async function convert(response, res) {
  const directory = await mkdtemp(join(tmpdir(), 'kubecal-slides-'));
  try {
    let bytes = 0;
    const limit = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > 100 * 1024 * 1024 ? new Error('Slide too large') : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limit,
      createWriteStream(join(directory, 'slides.pptx')),
    );
    await exec(
      office,
      [
        `-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        directory,
        join(directory, 'slides.pptx'),
      ],
      { timeout: 120000 },
    );
    const pdf = join(directory, 'slides.pdf');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': (await stat(pdf)).size,
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    await pipeline(createReadStream(pdf), res);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

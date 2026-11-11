import { createServer } from 'node:http';
import { Readable, pipeline } from 'node:stream';
import worker from './worker.mjs';
import { convert } from './convert.mjs';

createServer(async (req, res) => {
  if (req.headers.host !== '127.0.0.1:5466') {
    res.writeHead(403).end();
    return;
  }
  if (req.headers.origin === 'http://127.0.0.1:5465') {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5465');
    res.setHeader('Vary', 'Origin');
  }
  try {
    const response = await worker.fetch(
      new Request(`http://127.0.0.1:5466${req.url}`, {
        method: req.method,
        headers: req.headers,
      }),
    );
    if (
      response.ok &&
      response.headers.get('content-type')?.includes('presentationml')
    ) {
      await convert(response, res);
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) pipeline(Readable.fromWeb(response.body), res, () => {});
    else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(502).end('Slide unavailable');
    else res.destroy();
  }
}).listen(5466, '127.0.0.1');

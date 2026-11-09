import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const offlineData = new Set(['/data/speakers.json', '/data/sponsors.json']);
const scheduleFile = 'tmp/offline/schedule.json';
const maxBody = 1024 * 1024;

function schedule(req, res) {
  res.setHeader('X-KubeCal-Store', 'disk');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    if (!existsSync(scheduleFile)) {
      res.statusCode = 204;
      return res.end();
    }
    res.setHeader('Content-Type', 'application/json');
    return res.end(readFileSync(scheduleFile));
  }
  if (req.method !== 'PUT') {
    res.statusCode = 405;
    return res.end();
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > maxBody) req.destroy();
  });
  req.on('end', () => {
    try {
      const text = JSON.stringify(JSON.parse(body), null, 2) + '\n';
      writeFileSync(scheduleFile + '.part', text);
      renameSync(scheduleFile + '.part', scheduleFile);
      res.statusCode = 204;
    } catch {
      res.statusCode = 400;
    }
    res.end();
  });
}

export default {
  server: { watch: { ignored: ['**/tmp/**'] } },
  plugins: [
    {
      name: 'kubecal-offline',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split('?')[0];
          if (path === '/api/schedule') return schedule(req, res);
          if (!offlineData.has(path)) return next();
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(`tmp/offline${path}`));
        });
      },
    },
  ],
};

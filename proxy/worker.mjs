import data from '../data/sessions.json' with { type: 'json' };

const slides = new Map();
for (const session of data.sessions) {
  for (const link of session.links) {
    if (link.label.trim().toLowerCase() !== 'slides') continue;
    try {
      const url = new URL(link.url);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'sessionize.com' ||
        url.port ||
        !url.pathname.startsWith('/download/')
      )
        continue;
      const extension = url.pathname.toLowerCase().split('.').pop();
      const type = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        png: 'image/png',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }[extension];
      if (type) slides.set(link.url, type);
    } catch {
      // Ignore malformed schedule links.
    }
  }
}

export default {
  async fetch(request) {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    const url = new URL(request.url).searchParams.get('url');
    const type = slides.get(url);
    if (!type) return new Response('Slide not found', { status: 404 });
    const headers = new Headers();
    for (const name of [
      'range',
      'if-range',
      'if-none-match',
      'if-modified-since',
    ]) {
      if (!type.includes('presentationml') && request.headers.has(name))
        headers.set(name, request.headers.get(name));
    }
    let upstream;
    try {
      upstream = await fetch(url, {
        method: request.method,
        headers,
        redirect: 'manual',
      });
    } catch {
      return new Response('Slide unavailable', { status: 502 });
    }
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      try {
        const original = new URL(url);
        const redirect = new URL(upstream.headers.get('location'), original);
        if (
          redirect.protocol !== 'https:' ||
          redirect.host !== 'cdn.sessionize.com' ||
          redirect.username ||
          redirect.password ||
          redirect.pathname !== original.pathname ||
          redirect.search !== original.search
        )
          throw new Error('Invalid redirect');
        upstream = await fetch(redirect.href, {
          method: request.method,
          headers,
          redirect: 'manual',
        });
      } catch {
        return new Response('Slide unavailable', { status: 502 });
      }
    }
    if (![200, 206, 304, 416].includes(upstream.status))
      return new Response('Slide unavailable', { status: 502 });
    const output = new Headers({
      'Content-Type': type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'no-store',
    });
    for (const name of [
      'accept-ranges',
      'content-range',
      'content-length',
      'etag',
      'last-modified',
    ]) {
      if (upstream.headers.has(name))
        output.set(name, upstream.headers.get(name));
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: output,
    });
  },
};

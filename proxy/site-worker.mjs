import slides from './worker.mjs';

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/slides') {
      try {
        if (
          new URL(url.searchParams.get('url')).pathname
            .toLowerCase()
            .endsWith('.pptx')
        )
          return new Response('Preview unavailable', { status: 404 });
      } catch {
        return new Response('Slide not found', { status: 404 });
      }
      return slides.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

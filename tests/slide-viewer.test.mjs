import test from 'node:test';
import assert from 'node:assert/strict';
import { slideViewerUrl } from '../slide-viewer.mjs';

test('uses the native viewer on desktop and the full PDF viewer on mobile', () => {
  const pdf = 'https://example.com/api/slides?url=deck.pdf';
  assert.equal(slideViewerUrl(pdf, false), `${pdf}#view=Fit`);
  assert.equal(
    slideViewerUrl(pdf, true),
    `./assets/pdfjs/web/viewer.html?file=${encodeURIComponent(pdf)}#zoom=page-fit`,
  );
});

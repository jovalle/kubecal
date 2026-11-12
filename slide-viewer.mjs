export function slideViewerUrl(src, mobile) {
  return mobile
    ? `./assets/pdfjs/web/viewer.html?file=${encodeURIComponent(src)}#zoom=page-fit`
    : `${src.split('#')[0]}#view=Fit`;
}

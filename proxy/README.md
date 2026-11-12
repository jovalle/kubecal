# Slide preview proxy

`just serve local` starts the local proxy on `127.0.0.1:5466` and uses it to preview Sessionize PDFs and images without storing slide copies. Slide previews and downloads need internet; the rest of the offline data remains available locally. PowerPoint files are converted to PDF temporarily for preview using LibreOffice; ZIP files are download-only. Install LibreOffice and make `soffice` available on PATH if the bundled Codex runtime is unavailable. Converted PDFs are removed after viewing.

The proxy serves only slide URLs in `data/sessions.json`, follows the matching Sessionize CDN redirect, and streams the response. The local proxy stops when `just serve local` exits.

The site and hosted proxy run together as a Cloudflare Worker at `kubecon.4j.do`. Run `npm run deploy:worker` with Wrangler authenticated to build and deploy them after updating the schedule or site. PowerPoint preview requires the local proxy; the hosted site offers the original file for download.

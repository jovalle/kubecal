# Slide preview proxy

`just local` starts the local proxy on `127.0.0.1:5466` and uses it to preview Sessionize PDFs and images without storing slide copies. Slide previews and downloads need internet; the rest of the offline data remains available locally. PowerPoint files are converted to PDF temporarily for preview using LibreOffice; ZIP files are download-only. Install LibreOffice and make `soffice` available on PATH if the bundled Codex runtime is unavailable. Converted PDFs are removed after viewing.

The proxy serves only slide URLs in `data/sessions.json`, follows the matching Sessionize CDN redirect, and streams the response. The local proxy stops when `just local` exits. The Worker handler can also be deployed separately for a hosted site; GitHub Pages cannot run it. If deployed, set the `proxy` meta tag in `index.html` to its HTTPS URL and update the Worker when the schedule changes.

# Mix / Moni

A mobile-friendly, browser-only mix maker. Live target: https://mix.moni.dev

## Use it

1. Add YouTube reference links and attach the corresponding audio files, or add MP3/WAV audio directly. The converter link opens an external website; this app does not download or upload audio.
2. Name and order the songs, then choose each song's excerpt with start/end times (`m:ss` or seconds).
3. Leave creative freedom at its default midpoint, or choose fixed/flexible.
4. Transitions are automatic. When two plausible approaches differ meaningfully, listen to A/B previews and select a favorite. Otherwise, the app selects a transition and offers an optional preview. No waveform editor or manual transition-point controls.
5. Make the mix, play it, and download stereo WAV or 192 kbps MP3.

Try a demo generates two original loops locally. It never replaces an existing lineup.

## Mixing engine

- Local onset-envelope autocorrelation estimates tempo and beat phase. Repeated accents estimate a four-beat boundary; quarter-second RMS windows estimate energy.
- Flexibility controls timing adjustments up to ±8 seconds and tempo adjustments up to ±12%. Fixed preserves requested excerpt boundaries and tempo.
- Transition planning looks for nearby rhythmic boundaries and compares local normalized energy. Quick handoffs and longer equal-power blends are the two styles.
- Uncertain rhythm estimates favor a smooth blend. Clear energy lifts may select a quick handoff automatically. A/B options require confident rhythms, compatible pace, sufficient energy, and a perceptible contrast.
- The pace correction controls adjust the detected tempo by half/double, without directly speeding up the original song.
- Tempo changes use waveform-similarity overlap-add to preserve pitch. Output uses bounded RMS gain adjustment and peak normalization.
- Analysis, rendering, and MP3 encoding run in a Web Worker.

This is a working first-version heuristic engine, not professional DJ mastering. Musical downbeats, phrases, and drops are not reliably identifiable from these estimates alone. It does not perform semantic drop detection, key matching, section repetition, stem separation, or extreme tempo transformations. Dense vocals and unfamiliar genres may need different excerpts. Conservative crossfades handle cases where rhythm estimates are uncertain.

## State and limits

IndexedDB stores the lineup, attached audio files, excerpt times, flexibility, and transition choices in this browser. Audio is never sent to a server. Clearing site data removes the project; browser storage may be evicted. Rendered output is not persisted: download it or render again after reloading. Storage errors are surfaced rather than silently claiming success.

This version supports 12 songs, at most 15 minutes of attached source audio, 80 MB per file, and a rendered mix under 12 minutes. Browser memory limits apply; shorter excerpts and sources work best on phones. Audio decoding uses the browser's supported codecs. The app has no server or dedicated database. Fonts are fetched from Google Fonts, with system-font fallbacks.

## Development

Use Node 22+ for checks. No build or dependency installation is required.

```sh
npm run check
npm test
python3 -m http.server 8000
```

Open http://localhost:8000. ES modules and Web Workers need an HTTP server; opening index.html as a file is not supported.

The tests cover tempo fixtures, fixed/flexible planning, choice gating and automatic fallback, time-stretch pitch retention, clipping protection, WAV structure, and worker rendering/MP3 encoding. Browser/mobile visual and real-song listening QA remain necessary before treating this as production-quality audio tooling.

## GitHub Pages

Settings → Pages → Deploy from a branch → **main**, **/ (root)**. The static files need no build. `.nojekyll` bypasses Jekyll. Set Custom domain to **mix.moni.dev**, add a DNS CNAME for **mix** pointing to **rohitmoni.github.io**, and enable Enforce HTTPS once a certificate is available. Preserve the existing CNAME file.

## Third-party software

MP3 encoding uses unmodified lamejs 1.2.1, loaded separately in the worker. See [vendor/README.md](vendor/README.md) and [LGPL 2.1](vendor/LICENSE-LGPL-2.1.txt).

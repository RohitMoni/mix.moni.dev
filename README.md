# Mix / Moni

Browser-based song mixing app, currently showing an under-construction page.

## GitHub Pages

1. Open Settings → Pages.
2. Under Build and deployment, select **Deploy from a branch**.
3. Select **main**, folder **/ (root)**, and save.
4. Set your exact hostname in **Custom domain** and save before changing DNS.
5. For a subdomain, add a CNAME at your DNS provider pointing to **rohitmoni.github.io** (no protocol or path).
6. Enable **Enforce HTTPS** when GitHub finishes issuing the certificate.

Expected default URL after enabling Pages: https://rohitmoni.github.io/mix.moni.dev/

Pages availability for this private repository depends on the GitHub account plan. Do not change repository visibility just to enable hosting without an explicit decision.

Reference: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

## Planned experience

- YouTube references and attached MP3/WAV files; browser-local persistence.
- Song ordering and source excerpt start/end times.
- A fixed ↔ flexible slider, centered by default.
- Automatic beat, tempo, and energy estimates.
- Playable A/B transition choices with plain-language descriptions. No waveforms, track dragging, or manual transition-point controls.
- Mix playback and WAV/MP3 exports.

# Browser security policies

The web app keeps camera access limited to the application itself with
`Permissions-Policy: camera=(self)`; microphone and geolocation stay disabled.

The offline TV LAN flow needs the HTTPS/HTTP application to contact a dynamic
private TV address. CSP cannot express RFC1918 CIDR ranges, so `connect-src`
allows the `http:` scheme while all TV LAN URLs remain validated by the
application protocol before use. Other CSP directives remain restrictive.

Regression coverage verifies the production headers in a real Chromium page and
performs a native cross-origin HTTP fetch to a local LAN fixture. This is a
browser-policy regression only; it does not replace the physical BTV/mobile
homologation tracked by #417/#422.

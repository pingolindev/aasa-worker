// AASA worker — serves Apple's apple-app-site-association files for
// Pingolin's iOS apps. One worker, four route bindings (track + note
// across dev + prod). The rest of each hostname is unaffected.
//
// To extend with Android assetlinks.json: add a parallel handler for
// /.well-known/assetlinks.json keyed off the same APPS table.

const TEAM_ID = "BDGP8KM3NK";

const APPS = {
  "track.pingolindev.com": "com.pingolin.track",
  "track.pingolin.com":    "com.pingolin.track",
  "note.pingolindev.com":  "com.pingolin.note",
  "note.pingolin.com":     "com.pingolin.note",
};

function aasaFor(bundleId) {
  const appId = `${TEAM_ID}.${bundleId}`;
  return {
    // Modern (iOS 13+) format. Track + note both target iOS 17+.
    applinks: {
      details: [{
        appIDs: [appId],
        components: [{ "/": "/*" }],
      }],
    },
    // Passkey autofill + Sign in with Apple for the bundle.
    webcredentials: {
      apps: [appId],
    },
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/.well-known/apple-app-site-association") {
      return new Response("not found", { status: 404 });
    }
    const bundleId = APPS[url.hostname];
    if (!bundleId) {
      return new Response(`unknown host: ${url.hostname}`, { status: 404 });
    }
    return new Response(JSON.stringify(aasaFor(bundleId)), {
      status: 200,
      headers: {
        // Apple requires application/json; rejects anything that 30x
        // redirects, so this must be served inline.
        "Content-Type": "application/json",
        // Apple's swcd has its own ~24h cache; this header just helps
        // Cloudflare's edge cache for any non-Apple fetchers.
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
};

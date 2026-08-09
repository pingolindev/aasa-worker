// App-association worker — serves the two files a mobile OS fetches before it
// will open an https link in an app instead of a browser:
//
//   /.well-known/apple-app-site-association   (iOS)
//   /.well-known/assetlinks.json              (Android)
//
// One worker, several route bindings. Every other path on each hostname
// continues through the LB to the app origin unaffected.
//
// The two live on DIFFERENT hostnames, because the apps declare their links on
// different hosts. iOS claims links on the web app (track./note.); Android's
// verify-email App Link is declared on the AUTH API host (api-auth.*) in both
// apps' manifests. Adding a host here is not enough on its own — it also needs
// a route in wrangler.toml, or Cloudflare never runs this worker for it.

const TEAM_ID = "BDGP8KM3NK";

const APPS = {
  "track.pingolindev.com": "com.pingolin.track",
  "track.pingolin.com":    "com.pingolin.track",
  "note.pingolindev.com":  "com.pingolin.note",
  "note.pingolin.com":     "com.pingolin.note",
};

// SHA-256 of the release signing certificate (O=Pingolin LLC), read from a
// signed APK with `apksigner verify --print-certs`. Every flavour of both
// Android apps is signed with this one key, so a single fingerprint covers all
// of them.
//
// CAVEAT for Play distribution: if an app is enrolled in Play App Signing,
// Google re-signs it and the installed APK carries GOOGLE's certificate, not
// this one. That variant's fingerprint has to be copied from Play Console
// (Setup -> App signing -> App signing key certificate) and added alongside
// this one, or verification fails for Play installs only — which looks like
// "App Links work when I sideload but not from the Store".
const RELEASE_CERT_SHA256 =
  "96:80:0D:E9:37:79:01:BA:57:00:BF:63:4B:62:B9:AE:25:B2:52:0F:F3:25:87:FB:C1:9C:85:C6:46:E3:B5:F7";

// Host -> every application id allowed to claim that host's https links.
// Ids are the base applicationId plus the flavour suffixes, in flavour-
// dimension order (environment, then distribution): a libre dev build is
// `<base>.dev.libre`. Every variant that ships must be listed, or Android
// silently declines to verify it.
const ANDROID_APPS = {
  "api-auth.pingolindev.com": [
    "com.pingolindev.note.dev",
    "com.pingolindev.note.dev.libre",
    "com.pingolin.track.dev",
  ],
  "api-auth.pingolin.com": [
    "com.pingolindev.note",
    "com.pingolindev.note.libre",
    "com.pingolin.track",
  ],
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

function assetlinksFor(packageNames) {
  // One statement per application id. Android requires the whole document to
  // be a JSON array, even for a single app.
  return packageNames.map((packageName) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: [RELEASE_CERT_SHA256],
    },
  }));
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      // Both platforms require application/json and neither follows a 30x,
      // so these must be served inline rather than redirected.
      "Content-Type": "application/json",
      // Apple's swcd and Android's verifier both cache on their own schedule;
      // this header only helps Cloudflare's edge for other fetchers.
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/apple-app-site-association") {
      const bundleId = APPS[url.hostname];
      if (!bundleId) {
        return new Response(`unknown host: ${url.hostname}`, { status: 404 });
      }
      return json(aasaFor(bundleId));
    }

    if (url.pathname === "/.well-known/assetlinks.json") {
      const packageNames = ANDROID_APPS[url.hostname];
      if (!packageNames) {
        return new Response(`unknown host: ${url.hostname}`, { status: 404 });
      }
      return json(assetlinksFor(packageNames));
    }

    return new Response("not found", { status: 404 });
  },
};

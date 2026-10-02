import posthog from "posthog-js";

// Product analytics (PostHog): how many people try the app, and how far they get:
//   video_requested → storyboard_ready → video_ready → video_exported
// plus autocapture and session replay. What people write stays private: inputs are masked, so is the text of
// anything marked .ova-private (the chat, project titles), clicks carry no element text, and page titles
// (the project title) are dropped. Anonymous: the id is a random install id the CLI keeps
// in ~/.opus-video-agent, so one person counts once even when the port changes. Off when the user opts out
// (`npx opus-video-agent --no-telemetry`, OVA_TELEMETRY=0 or DO_NOT_TRACK=1), and off in development.

// The project's public key: safe to ship (it can only send events). Empty = telemetry off.
const POSTHOG_KEY = "phc_C2VNrBe6wWF87sih62ewWtSoyMkcfxKF35yWyGzf842c";
const POSTHOG_HOST = "https://us.i.posthog.com";

type Ova = { telemetry?: boolean; installId?: string; version?: string };
const ova = (window as { __OVA__?: Ova }).__OVA__;
const enabled = !!POSTHOG_KEY && !!ova?.telemetry && !!ova.installId;

if (enabled) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    bootstrap: { distinctID: ova!.installId },
    person_profiles: "always",
    autocapture: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    property_denylist: ["title"],
    capture_pageview: false, // hash routes: sent below on every route change
    session_recording: { maskAllInputs: true, maskTextSelector: ".ova-private" },
    persistence: "localStorage",
  });
  posthog.register({ app_version: ova!.version });
  const pageview = () => posthog.capture("$pageview", { route: location.hash.startsWith("#/p/") ? "project" : "home" });
  pageview();
  addEventListener("hashchange", pageview);
}

export function track(event: string, props?: Record<string, unknown>) {
  if (enabled) posthog.capture(event, props);
}

/** A funnel step for a project, sent once per project (a reload or a revisit doesn't count it again). */
export function trackOnce(projectId: string, event: string, props?: Record<string, unknown>) {
  if (!enabled) return;
  const key = `ova-sent:${projectId}:${event}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {}
  posthog.capture(event, { project_id: projectId, ...props });
}

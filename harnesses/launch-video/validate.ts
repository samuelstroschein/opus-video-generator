// Contract checks for the launch-video pages. Returns warnings; the shell saves the file and shows them to the agent.
export default function validate(rel: string, content: string): string[] {
  const w: string[] = [];
  if (rel === "brief.html" && !/<meta[^>]*name=["']lva:product["'][^>]*content=["'][^"']+["']/i.test(content)) {
    w.push('brief.html is missing <meta name="lva:product" content="Product name">, which titles the project.');
  }
  if (rel === "storyboard.html") {
    if (!/data-lva-beat/.test(content)) w.push("storyboard.html has no data-lva-beat cards (one per beat, each also with data-lva-scene and data-lva-title).");
    if (!/id=["']lva-plan["']/.test(content)) w.push('storyboard.html is missing the hidden <script type="application/json" id="lva-plan"> with the detailed plan.');
    if (!/data-lva-send=["']Story approved/.test(content)) w.push('storyboard.html needs the Approve button: data-lva-send="Story approved. Build the video."');
  }
  if (rel === "video.html") {
    const m = content.match(/window\.LVA_SCENES\s*=\s*'([^']*)'/);
    if (!m) w.push("video.html must declare window.LVA_SCENES as a JSON string literal in a plain inline script.");
    else {
      try {
        const scenes = JSON.parse(m[1]);
        if (!Array.isArray(scenes) || scenes.some((s) => !s.name || !(Number(s.dur) > 0))) w.push("LVA_SCENES entries need a name and a positive dur.");
      } catch {
        w.push("window.LVA_SCENES is not valid JSON.");
      }
    }
    if (!/<Composition/.test(content)) w.push("video.html does not mount <Composition>.");
    if (!/_lva\/engine\.js/.test(content)) w.push('video.html must load <script src="_lva/engine.js">.');
  }
  return w;
}

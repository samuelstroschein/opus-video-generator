// Contract checks for the launch-video pages. Returns warnings; the shell saves the file and shows them to the agent.
export default function validate(rel: string, content: string): string[] {
  const w: string[] = [];
  if (rel === "brief.html" && !/<meta[^>]*name=["']lva:product["'][^>]*content=["'][^"']+["']/i.test(content)) {
    w.push('brief.html is missing <meta name="lva:product" content="Product name">, which titles the project.');
  }
  if (rel === "storyboard.html") {
    if (!/data-lva-version=/.test(content)) w.push('storyboard.html has no <section class="version" data-lva-version="v1"> sections. The storyboard is a canvas of versions.');
    if (!/data-lva-beat/.test(content)) w.push("storyboard.html has no data-lva-beat cards (one per beat, each also with data-lva-scene and data-lva-title).");
    if (!/id=["']lva-plan["']/.test(content)) w.push('storyboard.html is missing the hidden <script type="application/json" id="lva-plan"> with the detailed plan.');
    if (/\[[A-Z][^\]]{2,40}\]/.test(content.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ""))) w.push("Frames contain bracketed placeholder labels like [Logo]. Draw the real thing at mid fidelity: real words, the real layout of the product. Placeholders are only for imagery and art.");
    if (/<button/i.test(content)) w.push("The storyboard has no buttons: the user answers in chat. Guide the next step in your reply instead.");
    if (/cursive|Segoe Print|Bradley Hand|Chalkboard|Comic Sans/i.test(content)) w.push("Use a normal sans-serif font in the storyboard, no handwriting fonts.");
    const versions = [...content.matchAll(/data-lva-version=["'](v\d+)["']/g)].map((m) => Number(m[1].slice(1)));
    if (versions.length > 1 && versions.some((v, i) => i > 0 && v >= versions[i - 1])) w.push("Versions must be ordered newest first (v3, v2, v1 from top to bottom).");
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

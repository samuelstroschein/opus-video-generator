// HTML pages the agent is in the middle of writing, kept in memory so the canvas can show them as they stream in.
// The agent's write_file arguments arrive as partial JSON; we pull the path and the part of `content` received so far.

const drafts = new Map<string, Map<string, string>>(); // project → page → partial html

export const setDraft = (id: string, page: string, html: string) => {
  if (!drafts.has(id)) drafts.set(id, new Map());
  drafts.get(id)!.set(page, html);
};
export const getDraft = (id: string, page: string) => drafts.get(id)?.get(page);
export const clearDraft = (id: string, page?: string) => (page ? drafts.get(id)?.delete(page) : drafts.delete(id));

/** The string value of `key` in a JSON object that may be cut off anywhere, decoded as far as it goes. */
export function partialJsonString(json: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  return m ? decodeLoose(json, m.index + m[0].length) : null;
}

function decodeLoose(json: string, start: number): string {
  let out = "";
  for (let i = start; i < json.length; i++) {
    const c = json[i];
    if (c === '"') break;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = json[i + 1];
    if (n === undefined) break;
    if (n === "u") {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[n] ?? n;
      i += 1;
    }
  }
  return out;
}

/** Injected after a partial page so it fits the viewport while it grows (the page's own scripts have not arrived yet). */
/**
 * A page cut off mid-write, made safe to show: a tag left half-written at the end ("<meta charse") is dropped, and
 * an unclosed comment, <script>, <style>, <title> or <textarea> is closed. Otherwise whatever follows (our fit
 * script) lands inside that tag or block and shows up on the page as raw text.
 */
export function safeDraft(html: string): string {
  let s = html;
  const open = s.lastIndexOf("<");
  if (open > s.lastIndexOf(">")) s = s.slice(0, open);
  if (s.lastIndexOf("<!--") > s.lastIndexOf("-->")) s += "-->";
  for (const tag of ["script", "style", "title", "textarea"]) {
    const lower = s.toLowerCase();
    if (lower.lastIndexOf(`<${tag}`) > lower.lastIndexOf(`</${tag}`)) s += `</${tag}>`;
  }
  return s;
}

export const DRAFT_FIT = `<script>(()=>{const w=document.getElementById("versions");if(!w)return;w.style.transformOrigin="0 0";const f=()=>{const z=Math.min((innerWidth-60)/w.offsetWidth,(innerHeight-60)/w.offsetHeight,1.2);w.style.transform="translate("+(innerWidth-w.offsetWidth*z)/2+"px,30px) scale("+z+")"};f();addEventListener("resize",f)})()</script>`;

import { useEffect, useRef } from "react";

// A live WebGL scene behind the landing page: a planet's edge at the bottom of the screen with an orbital sunrise,
// a slowly drifting nebula and twinkling stars. Rendered at the screen's real resolution (retina included, up to 2x),
// stepping down only if frames get slow; paused while the tab is hidden, and drawn once (no motion) for people who
// ask their system to reduce motion.

const FRAG = `precision highp float;uniform vec2 R;uniform float T;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
const mat2 M=mat2(1.6,1.2,-1.2,1.6);
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<6;i++){s+=a*noise(p);p=M*p;a*=.5;}return s;}
float stars(vec2 p,float d){vec2 g=floor(p*d),f=fract(p*d)-.5;float h=hash(g);float b=step(.965,h);float tw=.6+.4*sin(T*1.7+h*40.);return b*tw*smoothstep(.09,0.,length(f-vec2(hash(g+1.)-.5,hash(g+2.)-.5)*.6));}
void main(){vec2 uv=(gl_FragCoord.xy-.5*R)/R.y;vec2 q=uv+vec2(T*.008,0.);
vec2 w=vec2(fbm(q*2.+T*.01),fbm(q*2.+3.1));float neb=fbm(q*1.6+w*1.4);
vec3 col=vec3(.012,.014,.03);col+=vec3(.32,.14,.42)*pow(neb,3.)*1.1+vec3(.10,.30,.40)*pow(fbm(q*2.3-w),4.)*1.3+vec3(.75,.38,.28)*pow(neb,6.)*.9;
col+=stars(q,60.)*.9+stars(q*1.7+.3,90.)*.6;
vec2 c=vec2(0.,-1.55);float rad=1.25;float d=length(uv-c);
if(d<rad){vec3 n=normalize(vec3(uv-c,sqrt(max(rad*rad-d*d,0.))));vec2 sp=vec2(atan(n.x,n.z)+T*.02,n.y);
float land=fbm(sp*vec2(3.,5.));float cloud=fbm(sp*vec2(6.,9.)+vec2(T*.01,0.));vec3 sd=normalize(vec3(.9,.25,.35));float l=clamp(dot(n,sd),0.,1.);
vec3 surf=mix(vec3(.04,.09,.20),vec3(.10,.16,.12),smoothstep(.5,.62,land));surf=mix(surf,vec3(.85),smoothstep(.55,.8,cloud)*.8);col=surf*(.06+1.3*l);
col+=vec3(1.,.55,.3)*pow(1.-n.z,4.)*l*.6;}
float rim=exp(-abs(d-rad)*22.);float side=smoothstep(-.6,.9,uv.x);col+=vec3(.35,.6,1.)*rim*.9*side+vec3(1.,.62,.36)*rim*1.4*smoothstep(.3,.95,uv.x);
vec2 sunp=c+normalize(vec2(.62,1.))*rad;float sg=length(uv-sunp);col+=vec3(1.,.8,.62)*(.02/(sg+.01))*.35+vec3(1.,.55,.3)*exp(-sg*6.)*.25;
col=1.-exp(-col*1.25);gl_FragColor=vec4(col,1.);}`;

export function SpaceBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const gl = c?.getContext("webgl", { antialias: false, alpha: false });
    if (!c || !gl) return; // no WebGL: the page's dark fallback color shows instead
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}"));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, "R");
    const uT = gl.getUniformLocation(prog, "T");

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now() - 20_000; // start mid-drift, not at the very first frame
    // Pixels per CSS pixel: the device's own (sharp on retina), lowered in steps if the GPU can't hold ~50fps.
    const max = Math.min(devicePixelRatio || 1, 2);
    let scale = max;
    let frames = 0;
    let since = performance.now();
    let raf = 0;
    const adapt = () => {
      if (++frames < 45) return;
      const ms = (performance.now() - since) / frames;
      if (ms > 20 && scale > 0.6) scale = Math.max(0.6, scale * 0.8);
      else if (ms < 12 && scale < max) scale = Math.min(max, scale * 1.15);
      frames = 0;
      since = performance.now();
    };
    const draw = () => {
      const w = Math.round(c.clientWidth * scale);
      const h = Math.round(c.clientHeight * scale);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uR, w, h);
      gl.uniform1f(uT, (performance.now() - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && !document.hidden) {
        adapt();
        raf = requestAnimationFrame(draw);
      }
    };
    const onVisible = () => {
      cancelAnimationFrame(raf);
      frames = 0;
      since = performance.now();
      if (!document.hidden) draw();
    };
    const onResize = () => still && draw();
    draw();
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full bg-[#05060c]" />;
}

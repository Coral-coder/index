// Lava-lamp background: WebGL metaballs that slowly rise, sink and merge.
// Rendered at reduced resolution (the blobs are soft, so it upscales cleanly),
// capped to ~30fps, paused when the tab is hidden, and frozen for reduced motion.

const canvas = document.getElementById("lava");
const gl = canvas?.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });

if (gl) {
  const vert = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  const frag = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLight;
const int N = 12;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float waxField(vec2 p, float aspect) {
  float field = 0.0;
  // Smaller blobs on narrow (phone) screens.
  float scale = mix(0.72, 1.0, clamp(aspect - 0.5, 0.0, 1.0));
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float speed = 0.03 + 0.03 * fract(fi * 0.618);
    float phase = fi * 1.731;
    float s = sin(uTime * speed + phase);
    // Spread across the width, drifting a little sideways.
    float x = (0.05 + 0.9 * fract(fi * 0.381 + 0.13)) * aspect + 0.04 * sin(uTime * 0.05 + fi * 2.1);
    float y = 0.5 + 0.66 * s;
    float r = (0.045 + 0.045 * fract(fi * 0.731)) * scale;
    // Stretch vertically while moving fast, round out at the turning points.
    float stretch = 1.0 + 0.35 * abs(cos(uTime * speed + phase));
    vec2 d = p - vec2(x, y);
    d.y /= stretch;
    field += (r * r) / (dot(d, d) + 1e-4);
  }
  // A pool of warm wax resting at the bottom, like the lamp's base.
  vec2 pool = p - vec2(0.5 * aspect, -0.12);
  pool.x *= 0.45;
  field += 0.016 * scale / (dot(pool, pool) + 1e-4) * (0.9 + 0.1 * sin(uTime * 0.2));
  return field;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float aspect = uRes.x / uRes.y;
  vec2 uv = frag / uRes;              // 0..1, y up
  vec2 p = vec2(uv.x * aspect, uv.y);

  // --- wax field -----------------------------------------------------------
  float field = waxField(p, aspect);
  // Treat the wax as rounded: height of a sphere-ish surface from the field,
  // then compare with a sample just above to find which side faces the bulb.
  float e = 0.004;
  float h0 = sqrt(max(0.0, 1.0 - 1.0 / max(field, 1e-3)));
  float h1 = sqrt(max(0.0, 1.0 - 1.0 / max(waxField(p + vec2(0.0, e), aspect), 1e-3)));
  float ny = (h1 - h0) / e * 0.025;
  float under = ny / sqrt(1.0 + ny * ny);   // smooth -1..1, 0 at the middle

  // --- colours (from the lamp: electric blue liquid, lime wax, pale glow) --
  vec3 deep    = mix(vec3(0.008, 0.024, 0.075), vec3(0.86, 0.93, 1.00), uLight);
  vec3 liquid  = mix(vec3(0.020, 0.200, 0.780), vec3(0.62, 0.80, 1.00), uLight);
  vec3 heat    = mix(vec3(0.300, 0.950, 0.350), vec3(0.72, 0.98, 0.55), uLight);
  vec3 waxEdge = mix(vec3(0.360, 0.960, 0.200), vec3(0.45, 0.86, 0.16), uLight);
  vec3 waxCore = mix(vec3(0.800, 1.000, 0.560), vec3(0.80, 1.00, 0.52), uLight);

  // Liquid: dark at the top (keeps text readable), electric blue lower down,
  // green heat bleeding up from the base.
  float h = smoothstep(1.05, 0.0, uv.y);
  vec3 col = mix(deep, liquid, h * h * 0.85);
  float base = exp(-pow((uv.x - 0.5) * 1.6, 2.0)) * smoothstep(0.55, 0.0, uv.y);
  col = mix(col, heat, base * 0.45);

  // Wax: soft anti-aliased edge, brighter towards the middle of each blob.
  float edge = smoothstep(0.97, 1.03, field);
  float core = smoothstep(1.0, 5.0, field);
  // Light comes from the base: wax near the bottom is lit and opaque,
  // wax near the top turns translucent (stays green, never grey).
  float lit = smoothstep(1.0, 0.05, uv.y);
  vec3 wax = mix(waxEdge, waxCore, core * 0.85);
  // Undersides catch the bulb's light; tops fall into soft shade.
  wax *= 0.9 + 0.2 * under;
  wax = mix(wax, waxCore, max(under, 0.0) * 0.4);
  float waxAlpha = edge * mix(mix(0.38, 0.95, lit), mix(0.35, 0.82, lit), uLight);
  // Denser in the middle so cores read as pale lime, not murky.
  waxAlpha = min(1.0, waxAlpha + edge * core * 0.3);
  // Soft halo around the wax.
  float glow = smoothstep(0.4, 1.0, field) * (1.0 - edge) * 0.18 * lit;
  col = mix(col, waxEdge, glow);
  col = mix(col, wax, waxAlpha);

  // Vignette + subtle grain to avoid banding.
  vec2 v = uv - 0.5;
  col *= mix(1.0 - dot(v, v) * 0.9, 1.0, uLight * 0.7);
  col += (hash(frag + fract(uTime)) - 0.5) / 255.0 * 2.0;
  gl_FragColor = vec4(col, 1.0);
}`;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };

  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uLight = gl.getUniformLocation(prog, "uLight");

    // Soft shapes, so a reduced buffer still looks sharp once scaled up.
    const SCALE = 0.6 * Math.min(devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = Math.max(1, Math.round(innerWidth * SCALE));
      const h = Math.max(1, Math.round(innerHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };

    // Follow the page theme (explicit toggle wins over the OS setting).
    const mq = matchMedia("(prefers-color-scheme: light)");
    let light = 0, lightTarget = 0;
    const readTheme = () => {
      const t = document.documentElement.dataset.theme;
      lightTarget = t ? (t === "light" ? 1 : 0) : (mq.matches ? 1 : 0);
    };
    readTheme(); light = lightTarget;
    new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mq.addEventListener("change", readTheme);

    const still = matchMedia("(prefers-reduced-motion: reduce)");
    // Start mid-cycle so the first frame already has blobs spread around.
    const t0 = performance.now() - 40000;
    let last = 0;
    const draw = (now) => {
      light += (lightTarget - light) * 0.12;
      gl.uniform1f(uLight, light);
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (now - last < 33) return; // ~30fps is plenty for lava
      last = now;
      if (still.matches && Math.abs(lightTarget - light) < 0.001) return;
      draw(still.matches ? t0 + 40000 : now);
    };

    addEventListener("resize", () => { resize(); draw(performance.now()); });
    resize();
    draw(performance.now());
    canvas.classList.add("on");
    requestAnimationFrame(loop);
  } catch (e) {
    console.warn("Lava background disabled:", e);
  }
}

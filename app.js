import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { Sky } from "three/addons/objects/Sky.js";
import { STOPS, SITES, LAYERS, REFERENCES } from "./story.js?v=8";

// Heights are true scale (1:1). Sun placed to match the shadows in the county's 2025 flight.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PHONE = matchMedia("(max-width: 899px), (pointer: coarse)").matches;
const $ = (s) => document.querySelector(s);
const COLORS = { farm: 0xa8c495, chadwick: 0xe8c27a, quarry: 0xe9a46a, selib: 0xe9a46a, route: 0xe9a46a };
const CSSC = { farm: "#a8c495", chadwick: "#e8c27a", quarry: "#e9a46a", selib: "#e9a46a" };
const LAYER_SW = { frame: "#a8c495", campus: "#e8dccb", route: "#e9a46a", beyond: "#c98d5f" };
const SUN_AZ = 296, SUN_EL = 40; // degrees: from the west-northwest, matching the photo's shadows

const stage = $("#stage");
const canvas = $("#scene");
const state = { i: -1, layers: {}, anim: null, routeAnim: null, user: false, seen: new Set() };

// ---------------------------------------------------------------- load heights
const setLoading = (t) => ($("#loadingText").textContent = t);
async function heightsFrom(url, cols, rows, scale = 0.1) {
  const blob = await fetch(url).then((r) => r.blob());
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas");
  c.width = cols; c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const h = new Float32Array(cols * rows);
  const b = new Uint8Array(cols * rows);
  for (let k = 0; k < h.length; k++) { h[k] = ((d[k * 4] << 8) | d[k * 4 + 1]) * scale; b[k] = d[k * 4 + 2]; }
  bmp.close?.();
  h.blue = b;
  return h;
}
function sampler(h, cols, rows, xmin, xmax, ymin, ymax) {
  const cw = (xmax - xmin) / cols, ch = (ymax - ymin) / rows;
  return (x, y) => {
    const c = THREE.MathUtils.clamp((x - xmin) / cw - 0.5, 0, cols - 1.001);
    const r = THREE.MathUtils.clamp((ymax - y) / ch - 0.5, 0, rows - 1.001);
    const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, i = r0 * cols + c0;
    return (h[i] * (1 - fc) + h[i + 1] * fc) * (1 - fr) + (h[i + cols] * (1 - fc) + h[i + cols + 1] * fc) * fr;
  };
}
const S = await fetch("data/scene.json", { cache: "no-cache" }).then((r) => r.json());
const E = S.extent, SF = S.surface, C = S.context;
setLoading("Reading the land");
const [surfH, groundH, ctxH] = await Promise.all([
  heightsFrom("data/" + SF.file, SF.cols, SF.rows),
  heightsFrom("data/" + SF.ground, SF.cols, SF.rows),
  heightsFrom("data/" + C.file, C.cols, C.rows),
]);
const surfAt = sampler(surfH, SF.cols, SF.rows, E.xmin, E.xmax, E.ymin, E.ymax);
const groundAt = sampler(groundH, SF.cols, SF.rows, E.xmin, E.xmax, E.ymin, E.ymax);
const ctxAt = sampler(ctxH, C.cols, C.rows, C.xmin, C.xmax, C.ymin, C.ymax);
const crownGrid = Float32Array.from(surfH.blue, (v) => v / 255);
const crownAt = sampler(crownGrid, SF.cols, SF.rows, E.xmin, E.xmax, E.ymin, E.ymax);
const inMain = (x, y) => x > E.xmin && x < E.xmax && y > E.ymin && y < E.ymax;
const topAt = (x, y) => (inMain(x, y) ? Math.max(surfAt(x, y), groundAt(x, y)) : ctxAt(x, y));
const groundY = (x, y) => (inMain(x, y) ? groundAt(x, y) : ctxAt(x, y));
const toWorld = (x, y, lift = 0) => new THREE.Vector3(x, groundY(x, y) + lift, -y);
const siteXY = (key) => (Array.isArray(key) ? key : S.sites[key]);

// ---------------------------------------------------------------- renderer, sky, light
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
// resolution adapts to the machine: it starts at up to 1.5x and steps down when frames run slow, back up when there's room
const QUALITY = { max: Math.min(devicePixelRatio, 1.5), pr: Math.min(devicePixelRatio, 1.5), acc: 0, n: 0, t: 0 };
renderer.setPixelRatio(QUALITY.pr);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.shadowMap.enabled = !PHONE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xbcc8d2);
scene.fog = new THREE.FogExp2(FOG.clone(), 0.000037); // a clear coastal day: the bay stays blue out to the horizon
const camera = new THREE.PerspectiveCamera(38, 1, 1, 400000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = false;
controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
controls.minDistance = 25;
controls.maxDistance = 30000;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.9;

const az = THREE.MathUtils.degToRad(SUN_AZ), el = THREE.MathUtils.degToRad(SUN_EL);
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(300000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.4;
  u.rayleigh.value = 1.7;
  u.mieCoefficient.value = 0.0045;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  return sky;
}
scene.add(makeSky());
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  scene.environment = pmrem.fromScene(envScene, 0, 1, 500000).texture;
  scene.environmentIntensity = 0.55;
}
// Light is calibrated for Lambert surfaces (both terms divide by pi): flat sunlit ground = (sun*sin(el) + sky) / pi ~ 1.0,
// so the aerial photo shows its own colours in the sun, and shade (sky only) sits near half.
const LIGHT = { sky: 1.62, sun: 2.45 };
const hemi = new THREE.HemisphereLight(0xf4f6fa, 0x7d6f5c, LIGHT.sky);
scene.add(hemi);
const lam = (o) => new THREE.MeshLambertMaterial({ toneMapped: false, ...o });
const sun = new THREE.DirectionalLight(0xfffaf2, LIGHT.sun);
sun.castShadow = !PHONE;
sun.shadow.mapSize.set(2048, 2048);
renderer.shadowMap.autoUpdate = false; // shadows are recomputed only when the view moves (see the frame loop)
sun.shadow.bias = -0.0003;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 12000;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- shared land shader: the frame + beyond the map
const U = {
  uFocus: { value: new THREE.Vector3(0, 0, 99999) },
  uFocusAmt: { value: 0 },
  uFrameRot: { value: 0 },
  uBeyond: { value: 0 },
  uTime: { value: 0 },
  uGreen: { value: 1 },
  uSunDir: { value: new THREE.Vector3() },
  uSunHaze: { value: new THREE.Color(0xf3dcc0) },
  uAO: { value: null },
  uAOBox: { value: new THREE.Vector4(E.xmin, E.xmax, E.ymin, E.ymax) },
};
// where the photo shows crops (tools/crops.py): up close those pixels turn to tilled soil and the 3D plants stand in
{
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); blank.needsUpdate = true;
  U.uCropA = { value: blank }; U.uCropBoxA = { value: new THREE.Vector4(0, 0, 1, 1) };
  U.uCropB = { value: blank }; U.uCropBoxB = { value: new THREE.Vector4(0, 0, 1, 1) };
  U.uCropShow = { value: 0 };
  const ms = (S.crops && S.crops.masks) || [];
  ms.slice(0, 2).forEach((m, i) => {
    new THREE.TextureLoader().load("data/" + m.file, (t) => {
      t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
      U[i ? "uCropB" : "uCropA"].value = t;
      U[i ? "uCropBoxB" : "uCropBoxA"].value.set(...m.box);
    });
  });
}
const NOISE_GLSL = `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}`;
const FRAME_GLSL = `
      // crops in the photo become bare tilled soil once the 3D plants are standing on it
      if (uCropShow > 0.001 && uIsBuilding < 0.5) {
        vec2 wp = vec2(vWPos.x, -vWPos.z);
        vec2 a = (wp - uCropBoxA.xy) / (uCropBoxA.zw - uCropBoxA.xy), b = (wp - uCropBoxB.xy) / (uCropBoxB.zw - uCropBoxB.xy);
        float cm = 0.0;
        if (a.x > 0.0 && a.y > 0.0 && a.x < 1.0 && a.y < 1.0) cm = texture2D(uCropA, a).r;
        if (b.x > 0.0 && b.y > 0.0 && b.x < 1.0 && b.y < 1.0) cm = max(cm, texture2D(uCropB, b).r);
        float clod = vnoise(vWPos * 4.0) * 0.6 + vnoise(vWPos * 13.0) * 0.4;
        vec3 soil = vec3(0.19, 0.12, 0.055) * mix(0.72, 1.12, clod);
        diffuseColor.rgb = mix(diffuseColor.rgb, soil, smoothstep(0.15, 0.7, cm) * uCropShow * 0.9);
      }
      // lush season: the 2025 flight was in dry summer; show grass and leaves green (soil, paths, roofs untouched)
      {
        vec3 c0 = diffuseColor.rgb;
        float L0 = dot(c0, vec3(0.2126, 0.7152, 0.0722));
        float gr = c0.g / max(c0.r, 1e-4), bg = c0.b / max(c0.g, 1e-4);
        float veg = smoothstep(0.58, 0.7, gr) * (1.0 - smoothstep(0.5, 0.64, bg)) * smoothstep(0.004, 0.02, L0);
        vec3 lush = L0 * vec3(0.62, 1.06, 0.46) * mix(0.62, 0.9, smoothstep(0.85, 1.1, gr));
        // keep some of the photo's own texture and warmth so it reads as real grass, not paint
        // and the small-scale light/dark of real turf (mowing stripes, clumps, bare patches) comes through from the photo
        lush = mix(lush, c0 * vec3(0.8, 0.97, 0.72), 0.4);
        lush *= mix(0.9, 1.08, vnoise(vWPos * 0.21)) * mix(0.94, 1.04, vnoise(vWPos * 1.3));
        diffuseColor.rgb = mix(c0, lush, veg * uGrade * uGreen);
      }
      // up close the 3-inch photo goes soft; fine clods and grain in the soil (and grass) fill in below its pixels
      {
        float near = (1.0 - uIsBuilding) * (1.0 - smoothstep(40.0, 260.0, distance(cameraPosition, vWPos)));
        float grain = vnoise(vWPos * 7.0) * 0.55 + vnoise(vWPos * 23.0) * 0.3 + vnoise(vWPos * 61.0) * 0.15 - 0.5;
        diffuseColor.rgb *= 1.0 + grain * 0.32 * near;
      }
      // cloud shadows: soft, slow, broken coastal cloud drifting in off the bay
      {
        vec2 cp = vWPos.xz * 0.0011 + vec2(uTime * 0.0055, uTime * 0.002);
        float cl = vnoise(vec3(cp, 0.0)) * 0.65 + vnoise(vec3(cp * 3.1, 1.7)) * 0.35;
        diffuseColor.rgb *= 1.0 - 0.14 * smoothstep(0.56, 0.78, cl) * (1.0 - uBeyond);
      }
      // steep faces (tree crowns, quarry walls) can't show the photo, which was taken from above: shade them as foliage in shadow
      // contact shading where the ground meets building walls (baked from the footprints)
      {
        vec2 auv = vec2((vWPos.x - uAOBox.x) / (uAOBox.y - uAOBox.x), (-vWPos.z - uAOBox.z) / (uAOBox.w - uAOBox.z));
        float inA = step(0.0, auv.x) * step(auv.x, 1.0) * step(0.0, auv.y) * step(auv.y, 1.0);
        diffuseColor.rgb *= mix(1.0, texture2D(uAO, clamp(auv, 0.0, 1.0)).r, inA * (1.0 - uIsBuilding));
      }
      float steep = (1.0 - uIsBuilding) * smoothstep(0.12, 0.65, 1.0 - normalize(vWNrm).y);
      float fol = 0.0;
      // forest floor: when the 3D trees stand on this ground, the photo's treetops become shaded understory
      float under = uGround * smoothstep(2.0, 6.0, vFol.x);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.36, 0.38, 0.32), under);
      // forest seen as the flat photo (before its 3D trees load in) takes the same tone as the 3D forest:
      // darker, with the shade between crowns, so the switch to 3D trees doesn't change the colour
      float flatCan = (1.0 - uGround) * (1.0 - uIsBuilding) * smoothstep(2.0, 6.0, vFol.x);
      float gaps = mix(0.62, 1.0, smoothstep(0.3, 0.7, vnoise(vWPos * 0.22) * 0.65 + vnoise(vWPos * 0.6) * 0.35));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.6, 0.66, 0.6) * gaps, flatCan);
      // foliage: leaf clumps at two scales, and darker deeper in the crown
      float clump = vnoise(vWPos * 0.55) * 0.6 + vnoise(vWPos * 1.9) * 0.4;
      float depth = mix(0.5, 1.0, smoothstep(0.15, 0.95, vFol.y));
      diffuseColor.rgb *= mix(1.0, mix(0.62, 1.18, clump) * depth, fol);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.58, 0.48), steep * mix(0.6, 1.0, fol));
      float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      vec2 rel = vWPos.xz - uFocus.xy;
      float cr = cos(uFrameRot), sr = sin(uFrameRot);
      vec2 q = abs(vec2(cr * rel.x - sr * rel.y, sr * rel.x + cr * rel.y));
      float d = max(q.x, q.y);
      float k = smoothstep(uFocus.z, uFocus.z + 6.0 + uFocus.z * 0.02, d) * uFocusAmt;
      // outside the frame the world stays real, just quieter: colour drains most of the way and the light drops, like the edge of a print
      vec3 quiet = mix(vec3(lum), diffuseColor.rgb, 0.22) * vec3(0.52, 0.5, 0.47);
      diffuseColor.rgb = mix(diffuseColor.rgb, quiet, k);
      // viewfinder light: a warm band along the border, heavier crop marks at the corners
      float corner = step(uFocus.z * 0.74, min(q.x, q.y));
      float lw = (2.0 + uFocus.z * 0.007) * mix(1.0, 2.2, corner);
      float edge = (1.0 - smoothstep(0.0, lw, abs(d - uFocus.z))) * uFocusAmt;
      float glow = (1.0 - smoothstep(0.0, lw * 6.0, uFocus.z - d)) * step(d, uFocus.z) * uFocusAmt;
      diffuseColor.rgb *= 1.0 + glow * 0.1;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.86, 0.62) * 1.1, edge * mix(0.42, 0.9, corner));
      vec3 duo = mix(vec3(0.16, 0.10, 0.06), vec3(0.96, 0.80, 0.56), smoothstep(0.02, 0.62, lum));
      diffuseColor.rgb = mix(diffuseColor.rgb, duo, uBeyond * 0.8);`;
// aerial perspective: haze warms toward the sun, cools away from it, and is thicker in the low air
const HAZE_GLSL = `
#ifdef USE_FOG
  {
    vec3 vdir = normalize(vWPos - cameraPosition);
    float sunA = pow(max(dot(vdir, uSunDir), 0.0), 6.0);
    vec3 fcol = mix(fogColor, uSunHaze, sunA * 0.75);
    fcol = mix(fcol, fcol * vec3(0.9, 0.96, 1.07), (1.0 - sunA) * 0.45);
    float fd = length(vWPos - cameraPosition);
    #ifdef FOG_EXP2
      float ff = 1.0 - exp(-fogDensity * fogDensity * fd * fd);
    #else
      float ff = smoothstep(fogNear, fogFar, fd);
    #endif
    ff *= mix(1.2, 0.75, smoothstep(0.0, 900.0, vWPos.y));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, clamp(ff, 0.0, 1.0));
  }
#endif`;
function landShader(mat, key, isBuilding = 0, grade = isBuilding ? 0 : 1) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nattribute vec2 aFol;\nvarying vec2 vFol;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);\nvFol = aFol;")
      .replace("#include <fog_vertex>", "#include <fog_vertex>\n#ifdef USE_INSTANCING\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif");
    sh.uniforms.uGround = mat.userData.uGround || { value: 0 };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nvarying vec2 vFol;\n${NOISE_GLSL}\nuniform float uGround;\nuniform vec3 uFocus;\nuniform float uFocusAmt;\nuniform float uFrameRot;\nuniform float uBeyond;\nuniform float uTime;\nuniform float uGreen;\nuniform vec3 uSunDir;\nuniform vec3 uSunHaze;\nuniform sampler2D uAO;\nuniform vec4 uAOBox;\nuniform sampler2D uCropA;\nuniform vec4 uCropBoxA;\nuniform sampler2D uCropB;\nuniform vec4 uCropBoxB;\nuniform float uCropShow;\nconst float uIsBuilding = ${isBuilding.toFixed(1)};\nconst float uGrade = ${grade.toFixed(1)};`)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAME_GLSL)
      .replace("#include <fog_fragment>", HAZE_GLSL);
  };
  mat.customProgramCacheKey = () => key + "|" + isBuilding + "|" + grade;
  return mat;
}

U.uSunDir.value.copy(sunDir);
U.uAO.value = await new THREE.TextureLoader().loadAsync("data/" + (S.ao || "ao.png")).catch(() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); t.needsUpdate = true; return t;
});

// ---------------------------------------------------------------- imagery tiles (County of Santa Cruz 2025, 3-inch)
setLoading("Loading the aerial photos");
const TL = S.tiles;
const TW = (E.xmax - E.xmin) / TL.cols, TH = (E.ymax - E.ymin) / TL.rows;
const baseTex = await new THREE.TextureLoader().loadAsync("data/" + TL.base);
baseTex.colorSpace = THREE.SRGBColorSpace;
baseTex.anisotropy = MAX_ANISO;
const bmLoader = new THREE.ImageBitmapLoader();
bmLoader.setOptions({ imageOrientation: "flipY" });
function loadBitmapTex(url) {
  return new Promise((res, rej) => bmLoader.load(url, (bmp) => {
    const t = new THREE.Texture(bmp);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; t.needsUpdate = true;
    res(t);
  }, undefined, rej));
}

function heightNormal(f, x, y, e = 2) {
  const hx = (f(x + e, y) - f(x - e, y)) / (2 * e);
  const hy = (f(x, y + e) - f(x, y - e)) / (2 * e);
  return new THREE.Vector3(-hx, 1, hy).normalize();
}
const SEG = PHONE ? 66 : 128;
const tiles = [];
for (let r = 0; r < TL.rows; r++) {
  for (let c = 0; c < TL.cols; c++) {
    const x0 = E.xmin + c * TW, y1 = E.ymax - r * TH;
    const segY = Math.round((SEG * TH) / TW);
    const g = new THREE.PlaneGeometry(TW, TH, SEG, segY);
    g.rotateX(-Math.PI / 2);
    g.translate(x0 + TW / 2, 0, -(y1 - TH / 2));
    const p = g.attributes.position, n = g.attributes.normal;
    const fol = new Float32Array(p.count * 2);
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = -p.getZ(k);
      const gH = groundAt(x, y);
      p.setY(k, gH);
      fol[k * 2] = Math.max(0, surfAt(x, y) - gH);
      fol[k * 2 + 1] = crownAt(x, y);
      const nn = heightNormal(groundAt, x, y);
      n.setXYZ(k, nn.x, nn.y, nn.z);
    }
    g.setAttribute("aFol", new THREE.BufferAttribute(fol, 2));
    g.computeBoundingSphere();
    const gg = g;
    const map = baseTex.clone();
    map.repeat.set(1 / TL.cols, 1 / TL.rows);
    map.offset.set(c / TL.cols, 1 - (r + 1) / TL.rows);
    const mat = lam({ map });
    mat.userData.uGround = { value: 0 };
    landShader(mat, "land");
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = !PHONE;
    scene.add(mesh);
    const cx = x0 + TW / 2, cy = y1 - TH / 2;
    tiles.push({ r, c, mesh, mat, baseMap: map, tex: {}, loading: {}, target: 0, px: 0, surfGeo: g, groundGeo: gg, trees: {}, treeLvl: 0,
      center: new THREE.Vector3(cx, surfAt(cx, cy), -cy), radius: Math.hypot(TW, TH) / 2 + 30 });
  }
}

// the two gardens' outlines (the Farm, the Chadwick Garden)
const inRing = (x, y, ring) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) c = !c;
  }
  return c;
};
const GARDENS = ["farm", "chadwick"].map((k) => S.places[k].ring);
const inGarden = (x, y) => GARDENS.some((r) => inRing(x, y, r));

// ---------------------------------------------------------------- trees: every crown found in the 3-inch photo, as a 3D tree
setLoading("Growing the trees");
const TR = S.trees;
const treeBytes = await (async () => {
  const blob = await fetch("data/" + TR.file).then((r) => r.blob());
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas");
  c.width = TR.width; c.height = TR.rows;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, TR.width, TR.rows).data;
  const out = new Uint8Array(TR.width * TR.rows * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) { out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2]; }
  bmp.close?.();
  return out;
})();
// ---------------------------------------------------------------- foliage artwork, drawn once in code at high resolution
function makeCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
let aseed = 5;
const arnd = () => (aseed = (aseed * 16807) % 2147483647) / 2147483647;
function sprayTexture() {
  // a redwood / fir branch seen from above: a main axis with flat sprays of short needles; base at the bottom, tip at the top
  const W = 512, H = 1024, [c, g] = makeCanvas(W, H);
  g.lineCap = "round";
  const grey = (v) => `rgb(${v},${v},${v})`;
  const needles = (x0, y0, x1, y1, len) => {
    const n = Math.max(3, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 5));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, l = len * (1 - t * 0.55) * (0.75 + arnd() * 0.5);
      for (const side of [-1, 1]) {
        const a = ang + side * (1.05 + arnd() * 0.35);
        g.strokeStyle = grey(140 + Math.floor(arnd() * 115));
        g.lineWidth = 3 + arnd() * 1.6;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
  };
  const cx = W / 2;
  g.strokeStyle = grey(110); g.lineWidth = 8;
  g.beginPath(); g.moveTo(cx, H - 6); g.lineTo(cx + 6, 20); g.stroke();
  for (let t = 0.04; t < 0.97; t += 0.045) {
    const y = H - 6 - t * (H - 30), x = cx + t * 6;
    const span = (1 - t * 0.72) * W * 0.46 * (0.8 + arnd() * 0.35);
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (0.95 + arnd() * 0.25);
      const x1 = x + Math.cos(a) * span, y1 = y + Math.sin(a) * span * 0.75;
      g.strokeStyle = grey(120); g.lineWidth = 4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
      needles(x, y, x1, y1, 26);
    }
  }
  needles(cx, H - 6, cx + 6, 20, 30);
  return c;
}
function leafTexture() {
  // an oak / bay leaf cluster: clumps of small glossy leaves with twigs
  const W = 1024, [c, g] = makeCanvas(W, W);
  const clumps = 9;
  g.strokeStyle = "rgb(110,110,110)"; g.lineWidth = 5;
  for (let k = 0; k < clumps; k++) {
    const a = arnd() * Math.PI * 2, d = 120 + arnd() * 260;
    const cxx = W / 2 + Math.cos(a) * d, cyy = W / 2 + Math.sin(a) * d;
    g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(cxx, cyy); g.stroke();
    for (let i = 0; i < 70; i++) {
      const r = Math.abs((arnd() + arnd() + arnd()) / 3 - 0.5) * 2 * 120;
      const b = arnd() * Math.PI * 2;
      const x = cxx + Math.cos(b) * r, y = cyy + Math.sin(b) * r;
      const v = 120 + Math.floor(arnd() * 135);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath();
      g.ellipse(x, y, 20 + arnd() * 12, 9 + arnd() * 6, arnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}
function foliageTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const SPRAY_TEX = foliageTex(sprayTexture()), LEAF_TEX = foliageTex(leafTexture());

// ---------------------------------------------------------------- tree geometry from cards (unit height, crown radius 1)
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function cardBuilder() {
  const pos = [], nor = [], uv = [], at = [];
  return {
    quad(a, b, c, d, n, uvs) {
      // a b c d counter-clockwise; uvs [ua,va, ub,vb, uc,vc, ud,vd]
      for (const [p, k] of [[a, 0], [b, 1], [c, 2], [a, 0], [c, 2], [d, 3]]) {
        pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); uv.push(uvs[k * 2], uvs[k * 2 + 1]); at.push(p[1]);
      }
    },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("aT", new THREE.Float32BufferAttribute(at, 1));
      return g;
    },
  };
}
const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
// redwood / Douglas fir: drooping branch sprays in whorls, narrowing to a spire
// irr (0..1) makes a real-looking individual: uneven whorls, missing branches, a crown heavier on one side
function coniferCards(tiers, per, base = 0.15, span = 0.8, width = 1, irr = 0, leader = true) {
  const B = cardBuilder();
  const leanA = rnd() * Math.PI * 2, leanK = irr * 0.38;
  for (let i = 0; i < tiers; i++) {
    const f = THREE.MathUtils.clamp((i + 0.5 + (rnd() - 0.5) * irr * 0.7) / tiers, 0.02, 0.98);
    const y = base + f * span;
    const Rt = width * Math.pow(1 - f * 0.94, 1.05) * (0.82 + rnd() * 0.32);
    for (let k = 0; k < per; k++) {
      if (irr && rnd() < 0.16 * irr) continue;
      const ang = (k / per + i * 0.37 + rnd() * 0.18) * Math.PI * 2;
      const R = Rt * (1 + leanK * Math.cos(ang - leanA)) * (1 - irr * 0.3 + rnd() * irr * 0.6);
      const L = Math.max(0.07, R), droop = 0.05 + 0.24 * R;
      const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz, pz = dx;
      const wB = 0.05, wT = Math.max(0.1, 0.62 * L), yb = y + 0.02, yt = y - droop, tilt = (rnd() - 0.5) * 0.12;
      const n = nrm(dx * 0.7, 0.72, dz * 0.7);
      B.quad([px * wB, yb, pz * wB], [-px * wB, yb, -pz * wB],
             [dx * L - px * wT, yt - tilt, dz * L - pz * wT], [dx * L + px * wT, yt + tilt, dz * L + pz * wT],
             n, [0.42, 0, 0.58, 0, 1, 1, 0, 1]);
    }
  }
  // the leader: two crossed sprays standing up at the top (old redwoods often lose theirs)
  if (leader) for (const a of [0, Math.PI / 2]) {
    const px = Math.cos(a) * 0.09, pz = Math.sin(a) * 0.09;
    B.quad([-px, 0.8, -pz], [px, 0.8, pz], [px * 0.5, 1.0, pz * 0.5], [-px * 0.5, 1.0, -pz * 0.5], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  return B.build();
}
// a dark inner volume so the crown never reads as hollow
function coniferCore(seg, base = 0.16, span = 0.82, width = 1) {
  const g = new THREE.ConeGeometry(0.42 * width, span, seg, 1, true);
  g.translate(0, base + span / 2, 0);
  const p = g.attributes.position, n = g.attributes.normal;
  for (let k = 0; k < p.count; k++) { const v = nrm(p.getX(k), 0.5, p.getZ(k)); n.setXYZ(k, v[0], v[1], v[2]); }
  g.deleteAttribute("uv");
  return withT(g.index ? g.toNonIndexed() : g);
}
// coast live oak / bay / madrone: leafy clusters facing out from a few masses; crown from ~35% of the height
function makeBlobs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? 0.55 + rnd() * 0.12 : 0.36 + rnd() * 0.24, a = rnd() * Math.PI * 2, d = i === 0 ? rnd() * 0.12 : 0.3 + rnd() * 0.3;
    out.push({ s, c: [Math.cos(a) * d, 0.64 + (i === 0 ? 0.08 : rnd() * 0.2 - 0.08), Math.sin(a) * d] });
  }
  return out;
}
let BLOBS = makeBlobs(4);
function broadleafCards(blobs, per) {
  const B = cardBuilder();
  for (const { s, c } of BLOBS.slice(0, blobs)) {
    for (let k = 0; k < per; k++) {
      // directions biased upward and outward (light-seeking)
      let dx = rnd() * 2 - 1, dy = rnd() * 1.4 - 0.4, dz = rnd() * 2 - 1;
      [dx, dy, dz] = nrm(dx, dy, dz);
      const p = [c[0] + dx * s * 0.9, c[1] + dy * s * 0.62 * 0.9, c[2] + dz * s * 0.9];
      const q = s * (0.5 + rnd() * 0.2);
      let ux = -dz, uz = dx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const vx = dy * uz, vy = dz * ux - dx * uz, vz = -dy * ux;
      const n = nrm(dx, dy + 0.35, dz);
      B.quad([p[0] - ux * q - vx * q, p[1] - vy * q, p[2] - uz * q - vz * q], [p[0] + ux * q - vx * q, p[1] - vy * q, p[2] + uz * q - vz * q],
             [p[0] + ux * q + vx * q, p[1] + vy * q, p[2] + uz * q + vz * q], [p[0] - ux * q + vx * q, p[1] + vy * q, p[2] - uz * q + vz * q],
             n, [0, 0, 1, 0, 1, 1, 0, 1]);
    }
  }
  return B.build();
}
function broadleafCore(blobs, detail) {
  const parts = [];
  for (const { s, c } of BLOBS.slice(0, blobs)) {
    const g = new THREE.IcosahedronGeometry(s * 0.78, detail);
    g.scale(1, 0.62, 1);
    g.translate(c[0], c[1], c[2]);
    g.deleteAttribute("uv");
    const gp = g.index ? g.toNonIndexed() : g, pp = gp.attributes.position, nn = gp.attributes.normal;
    for (let k = 0; k < pp.count; k++) { const v = nrm(pp.getX(k) - c[0], (pp.getY(k) - c[1]) * 1.6 + 0.2, pp.getZ(k) - c[2]); nn.setXYZ(k, v[0], v[1], v[2]); }
    parts.push(gp);
  }
  return withT(mergeGeometries(parts));
}
function withT(g) {
  const p = g.attributes.position, t = new Float32Array(p.count);
  for (let k = 0; k < p.count; k++) t[k] = p.getY(k);
  g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
  return g;
}
const trunkGeo = (() => {
  const g = new THREE.CylinderGeometry(0.42, 0.6, 1, 7, 1, true);
  g.translate(0, 0.5, 0);
  g.deleteAttribute("uv");
  return withT(g.index ? g.toNonIndexed() : g);
})();
// close up, every tree is one of several individuals (no two neighbours share a silhouette); far off, one shape each
const NV = PHONE ? 2 : 4;
const variants = (n, make) => Array.from({ length: n }, (_, v) => { seed = 101 + v * 977; return make(v); });
const TREE_GEO = {
  con: [null, [{ cards: coniferCards(PHONE ? 5 : 6, 3), core: coniferCore(5) }],
        variants(NV, (v) => ({ cards: coniferCards(PHONE ? 9 : 13, PHONE ? 5 : 7, 0.15, 0.8, 1, 0.35 + v * 0.18), core: coniferCore(7) }))],
  // old-growth redwoods: a long bare trunk, crown from about a third of the way up, narrow, clumpy, some with broken tops
  tall: [null, [{ cards: coniferCards(PHONE ? 5 : 6, 3, 0.34, 0.62, 0.8), core: coniferCore(5, 0.34, 0.64, 0.8) }],
         variants(NV, (v) => ({ cards: coniferCards(PHONE ? 9 : 14, PHONE ? 5 : 7, 0.34, v % 2 ? 0.56 : 0.62, 0.8, 0.5 + v * 0.15, v % 2 === 0), core: coniferCore(7, 0.34, 0.64, 0.8) }))],
  brd: [null, [{ cards: broadleafCards(2, 7), core: broadleafCore(2, 0) }],
        variants(NV, (v) => { BLOBS = makeBlobs(3 + (v % 2)); const nb = PHONE ? 3 : 3 + (v % 2); return { cards: broadleafCards(nb, PHONE ? 10 : 15), core: broadleafCore(nb, 1) }; })],
};
function treeShader(mat, key) {
  landShader(mat, key, 1, 1);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    base(sh);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aT;\nvarying float vT;\nuniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vT = aT;
        // wind: crowns sway, tops most, with slow gusts rolling across the stand
        #ifdef USE_INSTANCING
          vec2 ip = instanceMatrix[3].xz;
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sway = sin(uTime * 1.1 + ip.x * 0.05 + ip.y * 0.03) * 0.6 + sin(uTime * 2.3 + ip.x * 0.11) * 0.25;
        float gust = 0.5 + 0.5 * sin(uTime * 0.21 + ip.x * 0.004 + ip.y * 0.003);
        transformed.xz += vec2(0.8, 0.45) * sway * aT * aT * (0.01 + 0.022 * gust);`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vT;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        // each tree a little different; inner and lower foliage sits in its own shade; older foliage a touch warmer
        diffuseColor.rgb *= mix(0.86, 1.1, vnoise(vWPos * 0.35)) * mix(0.6, 1.0, smoothstep(0.1, 0.95, vT));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 0.97, 0.84), (1.0 - vT) * 0.3);`);
  };
  return mat;
}
// when a patch of forest changes detail, the old trees dissolve into the new ones pixel by pixel instead of popping.
// fade.value = (mode, p): mode 0 = arriving (draw where noise < p), mode 1 = leaving (draw where noise >= p)
function withFade(mat, fade) {
  const b = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh) => {
    b(sh);
    sh.uniforms.uFade = fade;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uFade;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        {
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (uFade.x < 0.5 ? ign >= uFade.y : ign < uFade.y) discard;
        }`);
  };
  mat.customProgramCacheKey = () => key + "|fade";
  return mat;
}
// thin foliage is lit the same from either side; otherwise a card seen from behind takes its light from below and goes black
function twoSided(mat) {
  const b = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh) => { b(sh); sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize(vNormal);"); };
  mat.customProgramCacheKey = () => key + "|2s";
  return mat;
}
const cardMat = (map, key) => twoSided(treeShader(lam({ map, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), key));
function makeCoreMat() {
  const coreMat = treeShader(lam({ color: 0x6a6a6a }), "foliageCore");
  // the inner crown volume: break it into dark gaps and lit clumps so it never reads as a smooth cone
  const b = coreMat.onBeforeCompile;
  coreMat.onBeforeCompile = (sh) => { b(sh); sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float cc = vnoise(vWPos * 0.9) * 0.6 + vnoise(vWPos * 2.6) * 0.4;
        diffuseColor.rgb *= mix(0.42, 1.05, smoothstep(0.25, 0.75, cc));`); };
  coreMat.customProgramCacheKey = () => "foliageCoreClumps";
  return coreMat;
}
// bark: deep vertical fibres and furrows (redwood is reddish and stringy; oak darker and blockier, via the instance colour)
function barkShader(mat) {
  const b0 = mat.onBeforeCompile, key = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh) => { b0(sh); sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      {
        float fib = vnoise(vec3(vWPos.x * 4.5, vWPos.y * 0.22, vWPos.z * 4.5)) * 0.65 + vnoise(vec3(vWPos.x * 13.0, vWPos.y * 0.6, vWPos.z * 13.0)) * 0.35;
        float furrow = smoothstep(0.35, 0.62, fib);
        diffuseColor.rgb *= mix(0.45, 1.18, furrow) * mix(0.9, 1.05, vnoise(vWPos * 2.2));
      }`); };
  mat.customProgramCacheKey = () => key + "|bark";
  return mat;
}
// each patch of trees gets its own copies of the materials (same shader programs) so it can fade on its own
function forestMats() {
  const fade = { value: new THREE.Vector2(0, 1) };
  return {
    fade,
    con: withFade(cardMat(SPRAY_TEX, "spray"), fade), brd: withFade(cardMat(LEAF_TEX, "leaves"), fade),
    core: withFade(makeCoreMat(), fade), bark: withFade(barkShader(landShader(lam({}), "bark", 1)), fade),
  };
}
const TCOLOR = new THREE.Color(), TQ = new THREE.Quaternion(), TS = new THREE.Vector3(), TP = new THREE.Vector3(), TM = new THREE.Matrix4(), UPY = new THREE.Vector3(0, 1, 0);
const HSL = {};
// a crown's colour from the photo, lifted to make up for the darker foliage artwork. Crowns that sat in shadow in the
// photo are nearly black: give them a floor, in a redwood or oak green, so a tree beside the camera is never a black shape
function liftCrown(kind) {
  TCOLOR.getHSL(HSL);
  const dark = 1 - THREE.MathUtils.smoothstep(HSL.l, 0.06, 0.16);
  const h = THREE.MathUtils.lerp(HSL.h, kind === "brd" ? 0.22 : 0.27, dark);
  const sat = Math.max(Math.min(1, HSL.s * 1.12), 0.3 * dark);
  const l = Math.max(Math.min(1, HSL.l * (kind === "brd" ? 1.25 : 1.3)), kind === "brd" ? 0.17 : 0.14);
  TCOLOR.setHSL(h, sat, l);
}
const REDWOOD_BARK = new THREE.Color(0x5b3424), OAK_BARK = new THREE.Color(0x4a4238);
function buildTrees(t, lvl) {
  const ti = t.r * TL.cols + t.c, a = TR.offsets[ti], b = TR.offsets[ti + 1];
  const recs = { con: [], tall: [], brd: [] };
  for (let i = a; i < b; i++) {
    const o = i * 12, B = treeBytes;
    const x = ((B[o] << 8) | B[o + 1]) * 0.05 + E.xmin, y = ((B[o + 2] << 8) | B[o + 3]) * 0.05 + E.ymin;
    const h = ((B[o + 4] << 8) | B[o + 5]) / 100, r = B[o + 6] / 10;
    (B[o + 7] === 0 ? (h >= 24 ? recs.tall : recs.con) : recs.brd).push([x, y, h, r, B[o + 8], B[o + 9], B[o + 10], i]);
  }
  const group = new THREE.Group();
  const FOL = forestMats();
  group.userData.fade = FOL.fade;
  const trunks = [], orchard = [];
  for (const kind of ["con", "tall", "brd"]) {
    const list = recs[kind];
    if (!list.length) continue;
    const geos = TREE_GEO[kind][lvl];
    const byV = geos.map(() => []);
    for (const rec of list) byV[(rec[7] * 2246822519 >>> 7) % geos.length].push(rec);
    byV.forEach((sub, v) => { if (!sub.length) return;
    const geo = geos[v];
    const cards = new THREE.InstancedMesh(geo.cards, FOL[kind === "tall" ? "con" : kind], sub.length);
    const core = new THREE.InstancedMesh(geo.core, FOL.core, sub.length);
    sub.forEach(([x, y, h, r, cr, cg, cb, i], k) => {
      const spin = ((i * 2654435761) % 1000) / 1000 * Math.PI * 2;
      // a slight lean, as trees on a slope or in the wind have
      const la = ((i * 2246822519) % 1000) / 1000 * Math.PI * 2, lk = (((i * 3266489917) % 1000) / 1000) * 0.045;
      TQ.setFromEuler(new THREE.Euler(Math.cos(la) * lk, spin, Math.sin(la) * lk, "YXZ"));
      const g0 = groundAt(x, y);
      TP.set(x, g0 - 0.4, -y);
      const jw = 0.88 + (((i * 40503) % 1000) / 1000) * 0.24;
      TS.set(r * jw, h, r * jw);
      TM.compose(TP, TQ, TS);
      cards.setMatrixAt(k, TM);
      core.setMatrixAt(k, TM);
      // the crown's own colour from the photo, lifted to make up for the darker needle artwork
      TCOLOR.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
      TCOLOR.getHSL(HSL);
      liftCrown(kind);
      cards.setColorAt(k, TCOLOR);
      core.setColorAt(k, TCOLOR);
      // small trees inside the gardens are the orchards: apples, and persimmons like the one in my 10/21 photos
      if (lvl === 2 && kind === "brd" && h < 8 && inGarden(x, y)) orchard.push([x, y, g0, h, r * jw, i]);
      trunks.push([x, y, g0, h, kind === "tall" ? Math.max(0.35, h * 0.032) : kind === "con" ? Math.max(0.18, h * 0.024) : Math.max(0.14, h * 0.02), kind]);
    });
    for (const m of [cards, core]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
      m.castShadow = m.receiveShadow = !PHONE;
      m.computeBoundingSphere();
      group.add(m);
    }
    });
  }
  if (orchard.length) {
    const fr = [];
    for (const [x, y, g0, h, r, i] of orchard) {
      const persimmon = hash01(i * 0.37, 1.3) < 0.3, nf = PHONE ? 10 : persimmon ? 34 : 22;
      for (let k = 0; k < nf; k++) {
        const a = hash01(i + k * 1.7, k) * Math.PI * 2, u = hash01(k * 3.1, i) * 2 - 1, rr = r * (0.62 + 0.3 * hash01(i, k * 2.3));
        const cy = g0 + h * (0.66 + u * 0.22), w = Math.sqrt(1 - u * u * 0.6);
        fr.push([x + Math.cos(a) * rr * w, cy, y + Math.sin(a) * rr * w, persimmon ? 0.038 : 0.036,
          persimmon ? [0.86, 0.38, 0.06] : hash01(i, 9) < 0.6 ? [0.6, 0.1, 0.07] : [0.72, 0.66, 0.22]]);
      }
    }
    const fm = new THREE.InstancedMesh(fruitGeo, withFade(landShader(lam({}), "orchardFruit", 1), FOL.fade), fr.length);
    const fc = new THREE.Color();
    fr.forEach(([x, yy, y, rad, c], k) => { TM.compose(TP.set(x, yy, -y), TQ.identity(), TS.set(rad, rad, rad)); fm.setMatrixAt(k, TM); fm.setColorAt(k, fc.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)); });
    fm.castShadow = !PHONE;
    fm.computeBoundingSphere();
    group.add(fm);
  }
  if (lvl === 2 && trunks.length) {
    const tm = new THREE.InstancedMesh(trunkGeo, FOL.bark, trunks.length);
    trunks.forEach(([x, y, g0, h, rt, kind], k) => {
      TM.compose(TP.set(x, g0 - 0.5, -y), TQ.identity(), TS.set(rt, h * (kind === "tall" ? 0.62 : kind === "con" ? 0.42 : 0.4), rt));
      tm.setMatrixAt(k, TM);
      tm.setColorAt(k, kind === "brd" ? OAK_BARK : REDWOOD_BARK);
    });
    tm.instanceMatrix.needsUpdate = true;
    tm.instanceColor.needsUpdate = true;
    tm.castShadow = !PHONE;
    tm.computeBoundingSphere();
    group.add(tm);
  }
  return group;
}
// ---------------------------------------------------------------- far forest: the surrounding hills, as light crossed-card trees in 1 km chunks
function silhouette(kind) {
  const W = kind === "con" ? 256 : 512, H = kind === "con" ? 1024 : 512;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.lineCap = "round";
  const grey = (v) => `rgb(${v},${v},${v})`;
  if (kind === "con") {
    g.fillStyle = grey(70); g.fillRect(W / 2 - 6, H * 0.72, 12, H * 0.28);
    for (let y = H * 0.76; y > 8; y -= 9) {
      const f = 1 - y / H, half = (W / 2 - 6) * Math.pow(Math.min(1, (1 - f) / 0.78), 1.05) * (0.85 + arnd() * 0.3);
      for (let k = 0; k < 9; k++) {
        const side = arnd() < 0.5 ? -1 : 1, len = half * (0.5 + arnd() * 0.5);
        g.strokeStyle = grey(120 + Math.floor(arnd() * 130)); g.lineWidth = 3 + arnd() * 3;
        g.beginPath(); g.moveTo(W / 2, y); g.lineTo(W / 2 + side * len, y + len * 0.35 + arnd() * 6); g.stroke();
      }
    }
  } else {
    g.fillStyle = grey(70); g.fillRect(W / 2 - 9, H * 0.55, 18, H * 0.45);
    for (let i = 0; i < 900; i++) {
      const a = arnd() * Math.PI * 2, r = Math.sqrt(arnd()) * W * 0.44;
      const x = W / 2 + Math.cos(a) * r, y = H * 0.42 + Math.sin(a) * r * 0.78;
      const v = 110 + Math.floor(arnd() * 140);
      g.fillStyle = grey(v);
      g.beginPath(); g.ellipse(x, y, 9 + arnd() * 7, 5 + arnd() * 4, arnd() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  }
  return foliageTex(c);
}
function crossedCards(n) {
  const B = cardBuilder();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI, cx = Math.cos(a), cz = Math.sin(a);
    const nl = nrm(cx * 0.5, 0.75, cz * 0.5), nr = nrm(-cx * 0.5, 0.75, -cz * 0.5);
    B.quad([-cx, 0, -cz], [cx, 0, cz], [cx, 1, cz], [-cx, 1, -cz], nrm(0, 1, 0), [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  const g = B.build(), nn = g.attributes.normal, pp = g.attributes.position;
  for (let k = 0; k < pp.count; k++) { const v = nrm(pp.getX(k) * 0.55, 0.8, pp.getZ(k) * 0.55); nn.setXYZ(k, v[0], v[1], v[2]); }
  return g;
}
const FAR = {
  geo: { con: crossedCards(2), brd: crossedCards(3) },
  mat: {
    con: twoSided(treeShader(lam({ map: silhouette("con"), side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), "farCon")),
    brd: twoSided(treeShader(lam({ map: silhouette("brd"), side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), "farBrd")),
  },
  chunks: [], size: 1000, radius: PHONE ? 2600 : 5200, perUpdate: 2,
};
const ctxCanopyAt = sampler(Float32Array.from(ctxH.blue, (v) => v / 4), C.cols, C.rows, C.xmin, C.xmax, C.ymin, C.ymax);
for (let y0 = C.ymin; y0 < C.ymax; y0 += FAR.size) {
  for (let x0 = C.xmin; x0 < C.xmax; x0 += FAR.size) {
    const inside = x0 >= E.xmin && x0 + FAR.size <= E.xmax && y0 >= E.ymin && y0 + FAR.size <= E.ymax;
    if (inside) continue;
    const cx = x0 + FAR.size / 2, cy = y0 + FAR.size / 2;
    FAR.chunks.push({ x0, y0, center: new THREE.Vector3(cx, ctxAt(cx, cy) + 15, -cy), group: null, built: false });
  }
}
const hash01 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
// the far forest takes its colour from the campus trees themselves (their crowns, measured in the photo, with the same lift),
// so there is no seam where the 3D campus forest meets the hills around it
let NEAR_TONE = null;
function nearTone() {
  if (NEAR_TONE) return NEAR_TONE;
  const acc = { con: [0, 0, 0, 0], brd: [0, 0, 0, 0] }, n = treeBytes.length / 12, stride = Math.max(1, Math.floor(n / 60000));
  for (let i = 0; i < n; i += stride) {
    const o = i * 12, kind = treeBytes[o + 7] === 0 ? "con" : "brd";
    TCOLOR.setRGB(treeBytes[o + 8] / 255, treeBytes[o + 9] / 255, treeBytes[o + 10] / 255, THREE.SRGBColorSpace);
    TCOLOR.getHSL(HSL);
    liftCrown(kind);
    const a = acc[kind]; a[0] += TCOLOR.r; a[1] += TCOLOR.g; a[2] += TCOLOR.b; a[3]++;
  }
  NEAR_TONE = {};
  for (const k of ["con", "brd"]) { const a = acc[k], m = Math.max(1, a[3]); NEAR_TONE[k] = new THREE.Color(a[0] / m, a[1] / m, a[2] / m); }
  return NEAR_TONE;
}
const FAR_DIM = 0.78; // simple cards catch more sun than a full crown with a shaded core; this brings them back into line
function buildFarChunk(ch) {
  const lists = { con: [], brd: [] }, step = 16;
  for (let y = ch.y0 + step / 2; y < ch.y0 + FAR.size; y += step) {
    for (let x = ch.x0 + step / 2; x < ch.x0 + FAR.size; x += step) {
      const c = ctxCanopyAt(x, y);
      if (c < 5) continue;
      const n = c > 14 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const jx = x + (hash01(x + k, y) - 0.5) * step, jy = y + (hash01(y, x + k * 3) - 0.5) * step;
        if (jx > E.xmin && jx < E.xmax && jy > E.ymin && jy < E.ymax) continue;
        const g0 = ctxAt(jx, jy);
        if (g0 < 1.2) continue;
        const r0 = hash01(jx * 0.7, jy * 1.3), h = c * (1.15 + 0.3 * r0);
        const con = h > 22 ? r0 < 0.85 : r0 < 0.35;
        (con ? lists.con : lists.brd).push([jx, jy, g0, h, r0]);
      }
    }
  }
  const group = new THREE.Group();
  for (const kind of ["con", "brd"]) {
    const L = lists[kind];
    if (!L.length) continue;
    const im = new THREE.InstancedMesh(FAR.geo[kind], FAR.mat[kind], L.length);
    L.forEach(([x, y, g0, h, r0], k) => {
      TQ.setFromAxisAngle(UPY, r0 * Math.PI * 2);
      const w = kind === "con" ? h * 0.2 : h * 0.42;
      TM.compose(TP.set(x, g0 - 0.5, -y), TQ, TS.set(w, h, w));
      im.setMatrixAt(k, TM);
      TCOLOR.copy(nearTone()[kind]).multiplyScalar(FAR_DIM * (0.82 + 0.36 * r0));
      im.setColorAt(k, TCOLOR);
    });
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  scene.add(group);
  ch.group = group;
  ch.built = true;
}
function updateFar() {
  let built = 0;
  const near = [];
  for (const ch of FAR.chunks) {
    const d = camera.position.distanceTo(ch.center);
    sph.set(ch.center, FAR.size * 0.75);
    const want = d < FAR.radius && frustum.intersectsSphere(sph);
    if (want && !ch.built) near.push([d, ch]);
    if (ch.group) ch.group.visible = want;
  }
  near.sort((a, b) => a[0] - b[0]);
  for (const [, ch] of near) { if (built++ >= FAR.perUpdate) break; buildFarChunk(ch); ch.group.visible = true; }
}

const FADING = new Set(), FADE_S = 0.9;
function setTreeLevel(t, lvl) {
  if (t.treeLvl === lvl) return;
  const now = performance.now() / 1000;
  // finish any dissolve already running on this tile before starting the next one
  if (t.fade) endFade(t);
  const from = t.treeLvl;
  if (lvl) {
    if (!t.trees[lvl]) { t.trees[lvl] = buildTrees(t, lvl); scene.add(t.trees[lvl]); }
    t.trees[lvl].visible = true;
  }
  t.mesh.geometry = t.groundGeo;
  t.treeLvl = lvl;
  if (REDUCED || !t.px) {
    if (from) t.trees[from].visible = false;
    if (lvl) t.trees[lvl].userData.fade.value.set(0, 1);
    t.mat.userData.uGround.value = lvl ? 1 : 0;
    return;
  }
  t.fade = { from, to: lvl, t0: now, g0: t.mat.userData.uGround.value };
  if (lvl) t.trees[lvl].userData.fade.value.set(0, 0);
  if (from) t.trees[from].userData.fade.value.set(1, 0);
  FADING.add(t);
}
function endFade(t) {
  const f = t.fade;
  if (f.from && f.from !== t.treeLvl) { t.trees[f.from].visible = false; t.trees[f.from].userData.fade.value.set(0, 1); }
  if (f.to) t.trees[f.to].userData.fade.value.set(0, 1);
  t.mat.userData.uGround.value = t.treeLvl ? 1 : 0;
  t.fade = null;
  FADING.delete(t);
}
function stepFades() {
  const now = performance.now() / 1000;
  for (const t of FADING) {
    const f = t.fade, p = THREE.MathUtils.smoothstep(now - f.t0, 0, FADE_S);
    if (f.to) t.trees[f.to].userData.fade.value.set(0, p);
    if (f.from) t.trees[f.from].userData.fade.value.set(1, p);
    t.mat.userData.uGround.value = THREE.MathUtils.lerp(f.g0, f.to ? 1 : 0, p);
    if (p >= 1) endFade(t);
  }
}
const TREES = { full: PHONE ? 4 : 9, simple: PHONE ? 14 : 46 };

// sharper imagery streams in as the camera gets close; far tiles fall back to lighter versions
const LOD = { hi: PHONE ? 5 : 18, md: PHONE ? 22 : 56, busy: 0, max: 4, queue: [] };
function tileURL(t, lvl) { return "data/" + (lvl === 2 ? TL.hi : TL.md).replace("{r}", t.r).replace("{c}", t.c); }
function requestTile(t, lvl) {
  if (t.tex[lvl] || t.loading[lvl]) return;
  t.loading[lvl] = true;
  LOD.queue.push({ t, lvl });
}
function pump() {
  LOD.queue.sort((a, b) => b.t.px * (b.lvl === 1 ? 1.3 : 1) - a.t.px * (a.lvl === 1 ? 1.3 : 1));
  while (LOD.busy < LOD.max && LOD.queue.length) {
    const { t, lvl } = LOD.queue.shift();
    if (t.target < lvl) { t.loading[lvl] = false; continue; }
    LOD.busy++;
    bmLoader.load(tileURL(t, lvl), (bmp) => {
      LOD.busy--;
      t.loading[lvl] = false;
      if (t.target < lvl) { bmp.close?.(); pump(); return; }
      const tx = new THREE.Texture(bmp);
      tx.flipY = false;
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = MAX_ANISO;
      tx.needsUpdate = true;
      t.tex[lvl] = tx;
      applyTile(t);
      pump();
    }, undefined, () => { LOD.busy--; t.loading[lvl] = false; pump(); });
  }
}
function applyTile(t) {
  const lvl = t.tex[2] && t.target >= 2 ? 2 : t.tex[1] && t.target >= 1 ? 1 : t.tex[2] ? 2 : 0;
  const map = lvl ? t.tex[lvl] : t.baseMap;
  if (t.mat.map !== map) t.mat.map = map;
  for (const l of [1, 2]) {
    if (t.tex[l] && l > t.target && l !== lvl) {
      t.tex[l].image?.close?.();
      t.tex[l].dispose();
      delete t.tex[l];
    }
  }
}
const frustum = new THREE.Frustum(), pmat = new THREE.Matrix4(), sph = new THREE.Sphere();
function updateLOD() {
  camera.updateMatrixWorld();
  pmat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pmat);
  const k = (stage.clientHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const t of tiles) {
    sph.set(t.center, t.radius);
    const vis = frustum.intersectsSphere(sph);
    const d = Math.max(20, camera.position.distanceTo(t.center) - t.radius * 0.6);
    t.px = vis ? (TW * k) / d : 0;
  }
  const order = [...tiles].sort((a, b) => b.px - a.px);
  let hi = 0, md = 0;
  for (const t of order) {
    let want = t.px > 1100 ? 2 : t.px > 260 ? 1 : 0;
    if (want === 2 && hi >= LOD.hi) want = 1;
    if (want >= 1 && md >= LOD.md) want = 0;
    if (want === 2) hi++;
    if (want >= 1) md++;
    t.target = want;
    if (want >= 1) requestTile(t, 1);
    if (want === 2) requestTile(t, 2);
    applyTile(t);
  }
  pump();
  updateFar();
  // 3D trees for the nearest tiles; farther tiles keep the canopy surface
  let full = 0, simple = 0;
  // tiles that already have trees keep their place in the queue unless another tile is clearly closer
  const torder = [...tiles].sort((a, b) => b.px * (1 + 0.35 * (b.treeLvl || 0)) - a.px * (1 + 0.35 * (a.treeLvl || 0)));
  for (const t of torder) {
    // a margin around each threshold so a tile near the line doesn't flip back and forth as the camera drifts
    const cur = t.treeLvl || 0, up = (th) => t.px > th * (cur >= 1 && th === 140 ? 0.7 : cur === 2 && th === 800 ? 0.7 : 1);
    let lvl = up(800) ? 2 : up(140) ? 1 : 0;
    if (lvl === 2 && full >= TREES.full) lvl = 1;
    if (lvl === 1 && simple >= TREES.simple) lvl = 0;
    if (lvl === 2) full++;
    if (lvl >= 1) simple++;
    if (!t.px && t.treeLvl) lvl = t.treeLvl; // keep what's built just off screen; avoids pop when turning
    setTreeLevel(t, lvl);
  }
}

// ---------------------------------------------------------------- the crops: every plant found in the Farm and Chadwick beds
// Each green plant in the 3-inch photo becomes a 3D plant of its row's crop (see tools/crops.py). They grow in as you come
// down close to the beds. Crop types follow what my photos show growing there: carrots, kale, dry-farmed tomatoes, plus
// salad greens, squash and cover crop. Which row holds which crop is read from colour and form, not from a planting map.
setLoading("Planting the beds");
const CROP = { ready: false, group: null, fade: { value: new THREE.Vector2(0, 0) }, p: 0, spot: null };
const cropBytes = S.crops ? await (async () => {
  const CR = S.crops;
  const blob = await fetch("data/" + CR.file, { cache: "no-cache" }).then((r) => r.blob());
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const [c, g] = makeCanvas(CR.width, CR.rows);
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, CR.width, CR.rows).data;
  const out = new Uint8Array(CR.width * CR.rows * 3);
  for (let i = 0, j = 0; i < d.length; i += 4) { out[j++] = d[i]; out[j++] = d[i + 1]; out[j++] = d[i + 2]; }
  bmp.close?.();
  return out;
})().catch(() => null) : null;

// leaf artwork (grey, tinted per plant): one sheet per crop, leaf base at the bottom centre
function cropLeafTex(kind) {
  const W = 256, H = 512, [c, g] = makeCanvas(W, H);
  const grey = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
  const leaf = (wf, x0, y0, len, ang, wmax, ruffle = 0, shade = 205) => {
    g.save(); g.translate(x0, y0); g.rotate(ang);
    g.beginPath(); g.moveTo(0, 0);
    for (let i = 0; i <= 48; i++) { const t = i / 48; g.lineTo(wf(t) * wmax * (1 + ruffle * Math.sin(t * 60)), -t * len); }
    for (let i = 48; i >= 0; i--) { const t = i / 48; g.lineTo(-wf(t) * wmax * (1 + ruffle * Math.sin(t * 60 + 1.3)), -t * len); }
    g.closePath(); g.fillStyle = grey(shade); g.fill();
    g.strokeStyle = grey(shade + 35); g.lineWidth = Math.max(1.5, wmax * 0.06);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.96); g.stroke();
    g.lineWidth = Math.max(1, wmax * 0.025); g.strokeStyle = grey(shade - 30);
    for (let k = 1; k < 9; k++) { const t = k / 9, w = wf(t) * wmax * 0.9; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, -t * len); g.lineTo(s * w, -t * len - w * 0.6); g.stroke(); } }
    g.restore();
  };
  aseed = { lettuce: 7, kale: 13, carrot: 17, tomato: 23, squash: 29, grain: 31 }[kind];
  if (kind === "lettuce") leaf((t) => Math.sin(Math.PI * Math.pow(t, 0.75)) * (0.55 + 0.45 * t), W / 2, H - 4, H - 16, 0, W * 0.46, 0.06, 215);
  if (kind === "kale") {
    // lacinato: a long dark strap leaf, its surface blistered all over
    leaf((t) => Math.sin(Math.PI * Math.pow(t, 0.6)) * 0.95, W / 2, H - 4, H - 12, 0, W * 0.2, 0.05, 165);
    for (let i = 0; i < 520; i++) {
      const t = arnd(), w = Math.sin(Math.PI * Math.pow(t, 0.6)) * 0.9 * W * 0.2, x = W / 2 + (arnd() * 2 - 1) * w, y = H - 4 - t * (H - 12);
      g.fillStyle = grey(arnd() < 0.5 ? 120 : 200); g.beginPath(); g.arc(x, y, 2 + arnd() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  if (kind === "carrot") {
    // feathery fronds: a stalk with finely divided leaflets
    g.lineCap = "round";
    for (let f = 0; f < 3; f++) {
      const ang = (f - 1) * 0.28, len = H * (0.82 + arnd() * 0.15);
      g.save(); g.translate(W / 2, H - 4); g.rotate(ang);
      g.strokeStyle = grey(190); g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len); g.stroke();
      for (let k = 4; k < 30; k++) {
        const y = -len * k / 30, span = (1 - k / 30) * W * 0.32 + 8;
        for (const s of [-1, 1]) {
          g.strokeStyle = grey(150 + arnd() * 90); g.lineWidth = 2;
          const x1 = s * span, y1 = y - span * 0.5;
          g.beginPath(); g.moveTo(0, y); g.lineTo(x1, y1); g.stroke();
          for (let m = 1; m < 5; m++) { const xm = x1 * m / 5, ym = y + (y1 - y) * m / 5; g.beginPath(); g.moveTo(xm, ym); g.lineTo(xm + s * 7, ym - 9); g.moveTo(xm, ym); g.lineTo(xm - s * 2, ym - 10); g.stroke(); }
        }
      }
      g.restore();
    }
  }
  if (kind === "tomato") {
    // compound leaf: a stem with paired, toothed leaflets
    g.strokeStyle = grey(150); g.lineWidth = 5; g.beginPath(); g.moveTo(W / 2, H - 4); g.lineTo(W / 2, 20); g.stroke();
    for (let k = 0; k < 7; k++) {
      const y = H - 60 - k * 62;
      for (const s of [-1, 1]) leaf((t) => Math.sin(Math.PI * Math.pow(t, 0.8)), W / 2, y, 95 - k * 6, s * (1.05 - k * 0.06), 30, 0.12, 180 + arnd() * 40);
    }
    leaf((t) => Math.sin(Math.PI * Math.pow(t, 0.8)), W / 2, 70, 60, 0, 26, 0.12, 200);
  }
  if (kind === "squash") {
    // a broad lobed leaf, pale mottling along the veins, on a long stalk
    g.strokeStyle = grey(170); g.lineWidth = 9; g.beginPath(); g.moveTo(W / 2, H - 4); g.lineTo(W / 2, H * 0.52); g.stroke();
    g.save(); g.translate(W / 2, H * 0.5);
    g.beginPath();
    for (let i = 0; i <= 120; i++) { const a = -Math.PI * 0.95 + (i / 120) * Math.PI * 0.9 * 2.1, r = W * 0.46 * (0.82 + 0.18 * Math.abs(Math.cos(a * 2.5))); g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.95 - W * 0.1); }
    g.closePath(); g.fillStyle = grey(185); g.fill();
    g.strokeStyle = grey(235); g.lineWidth = 4;
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * W * 0.4, Math.sin(a) * W * 0.4 - W * 0.05); g.stroke(); }
    for (let i = 0; i < 300; i++) { const a = arnd() * Math.PI * 2, r = arnd() * W * 0.38; g.fillStyle = grey(arnd() < 0.5 ? 160 : 215); g.fillRect(Math.cos(a) * r, Math.sin(a) * r - W * 0.1, 3, 3); }
    g.restore();
  }
  if (kind === "grain") {
    g.lineCap = "round";
    for (let k = 0; k < 9; k++) {
      const x = W / 2 + (arnd() - 0.5) * 60, bend = (arnd() - 0.5) * 140, top = 10 + arnd() * 90;
      g.strokeStyle = grey(170 + arnd() * 70); g.lineWidth = 8 + arnd() * 6;
      g.beginPath(); g.moveTo(x, H - 4); g.quadraticCurveTo(x + bend * 0.3, H / 2, x + bend, top); g.stroke();
    }
  }
  return foliageTex(c);
}
// plant forms, unit size (about 1 m across), leaf bases near the middle of the plant
function rosette(n, tilt0, tilt1, len, wid, base = 0.02, rise = 0) {
  const B = cardBuilder();
  for (let k = 0; k < n; k++) {
    const inner = k / n;
    const ang = k * 2.39996 + rnd() * 0.4, tilt = THREE.MathUtils.lerp(tilt1, tilt0, inner) + (rnd() - 0.5) * 0.2;
    const L = len * (0.75 + rnd() * 0.35) * (1 - inner * 0.35), w = wid * (0.85 + rnd() * 0.3);
    const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz * w / 2, pz = dx * w / 2;
    const y0 = base + rise * rnd(), tx = dx * Math.sin(tilt) * L, ty = y0 + Math.cos(tilt) * L, tz = dz * Math.sin(tilt) * L;
    B.quad([px, y0, pz], [-px, y0, -pz], [tx - px, ty, tz - pz], [tx + px, ty, tz + pz], nrm(dx * 0.5, 1, dz * 0.5), [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  const g = B.build(), at = g.attributes.aT, p = g.attributes.position;
  let top = 0; for (let k = 0; k < p.count; k++) top = Math.max(top, p.getY(k));
  for (let k = 0; k < p.count; k++) at.setX(k, p.getY(k) / top);
  return g;
}
function bush(n, h, r, len, wid) {
  const B = cardBuilder();
  for (let k = 0; k < n; k++) {
    const y = 0.06 + Math.pow(rnd(), 0.8) * (h - 0.3), ang = rnd() * Math.PI * 2, rr = rnd() * r * 0.35;
    const ox = Math.cos(ang) * rr, oz = Math.sin(ang) * rr;
    const tilt = 0.75 + rnd() * 0.85, L = len * (0.7 + rnd() * 0.5), w = wid * (0.8 + rnd() * 0.4);
    const dx = Math.cos(ang), dz = Math.sin(ang), px = -dz * w / 2, pz = dx * w / 2;
    const tx = ox + dx * Math.sin(tilt) * L, ty = y + Math.cos(tilt) * L, tz = oz + dz * Math.sin(tilt) * L;
    B.quad([ox + px, y, oz + pz], [ox - px, y, oz - pz], [tx - px, ty, tz - pz], [tx + px, ty, tz + pz], nrm(dx * 0.6, 1, dz * 0.6), [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  const g = B.build(), at = g.attributes.aT, p = g.attributes.position;
  for (let k = 0; k < p.count; k++) at.setX(k, Math.min(1, p.getY(k) / h));
  return g;
}
seed = 4242;
// type: 0 lettuce, 1 kale, 2 squash, 3 tomato, 4 carrot, 5 cover crop
const CROP_KIND = [
  { tex: "lettuce", geo: rosette(PHONE ? 8 : 11, 0.35, 1.25, 0.5, 0.42), h: 0.42, s: [0.24, 0.42], base: [0.64, 0.84, 0.38], cluster: 1 },
  { tex: "kale", geo: rosette(PHONE ? 8 : 11, 0.12, 0.55, 0.95, 0.2, 0.18, 0.15), h: 1.0, s: [0.42, 0.7], base: [0.38, 0.52, 0.48], cluster: 1 },
  { tex: "squash", geo: rosette(PHONE ? 6 : 8, 1.05, 1.35, 0.62, 0.62, 0.03, 0.08), h: 0.55, s: [0.9, 1.5], base: [0.44, 0.62, 0.3], cluster: 1 },
  { tex: "tomato", geo: bush(PHONE ? 18 : 30, 0.85, 0.9, 0.5, 0.5), h: 0.85, s: [0.6, 1.0], base: [0.36, 0.56, 0.24], cluster: 1 },
  { tex: "carrot", geo: rosette(PHONE ? 7 : 10, 0.15, 0.6, 0.5, 0.3, 0.02), h: 0.85, s: [0.3, 0.45], base: [0.44, 0.68, 0.27], cluster: PHONE ? 3 : 5 },
  { tex: "grain", geo: rosette(6, 0.05, 0.35, 1.0, 0.16, 0.0), h: 1.0, s: [0.4, 0.75], base: [0.64, 0.7, 0.36], cluster: PHONE ? 3 : 6 },
  // assumed from what the UCSC Farm is known for growing (not from a planting map): strawberries, cut flowers, cabbage/broccoli
  { tex: "lettuce", geo: rosette(PHONE ? 6 : 9, 0.7, 1.25, 0.32, 0.3, 0.01), h: 0.3, s: [0.24, 0.34], base: [0.34, 0.52, 0.22], cluster: 2 },
  { tex: "carrot", geo: rosette(PHONE ? 6 : 8, 0.05, 0.3, 0.85, 0.22, 0.0), h: 1.0, s: [0.5, 0.8], base: [0.36, 0.56, 0.24], cluster: 2 },
  { tex: "kale", geo: rosette(PHONE ? 8 : 10, 0.7, 1.2, 0.55, 0.42, 0.04), h: 0.5, s: [0.5, 0.75], base: [0.44, 0.58, 0.52], cluster: 1 },
];
function cropMats() {
  const f = CROP.fade;
  return CROP_KIND.map((k, i) => {
    const m = withFade(treeShader(lam({ map: cropLeafTex(k.tex), side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), "crop" + i), f);
    // a leaf is lit the same from either side (thin, translucent); without this its underside takes light from below and goes black
    const b = m.onBeforeCompile, key = m.customProgramCacheKey();
    m.onBeforeCompile = (sh) => { b(sh); sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal = normalize(vNormal);"); };
    m.customProgramCacheKey = () => key + "|twoSidedLeaf";
    return m;
  });
}
const fruitGeo = new THREE.IcosahedronGeometry(1, PHONE ? 0 : 1);
const pumpkinGeo = (() => { const g = new THREE.SphereGeometry(1, PHONE ? 8 : 14, PHONE ? 6 : 10); const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) { const x = p.getX(k), z = p.getZ(k), a = Math.atan2(z, x), rib = 1 - 0.07 * Math.pow(Math.abs(Math.cos(a * 5)), 0.5); p.setXYZ(k, x * rib, p.getY(k), z * rib); }
  g.computeVertexNormals(); return g; })();
const stakeGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const shoulderGeo = new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
function buildCrops() {
  const B = cropBytes, n = S.crops.count, mats = cropMats();
  const lists = CROP_KIND.map(() => []);
  const fruit = [], pumpkins = [], stakes = [], shoulders = [], blooms = [], heads = [];
  const C = new THREE.Color(), P = new THREE.Color();
  let sx = 0, sy = 0, cnt = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 12;
    const x = ((B[o] << 8) | B[o + 1]) * 0.05 + E.xmin, y = ((B[o + 2] << 8) | B[o + 3]) * 0.05 + E.ymin;
    let t = B[o + 4];
    // my assumptions about what's in each row, decided once per row so a row stays one crop
    const bed = ((B[o + 10] * 37 + 11) % 100) / 100;
    if (t === 0 && bed < 0.3) t = 6;            // strawberries
    else if (t === 0 && bed < 0.5) t = 7;       // cut flowers (zinnias, dahlias, sunflowers)
    else if (t === 4 && bed > 0.8) t = 7;
    else if (t === 1 && bed < 0.45) t = 8;      // cabbage and broccoli among the brassicas
    const K = CROP_KIND[t]; if (!K) continue;
    const s0 = (B[o + 5] / 255) * 1.5, rot = (B[o + 6] / 255) * Math.PI * 2;
    P.setRGB(B[o + 7] / 255, B[o + 8] / 255, B[o + 9] / 255, THREE.SRGBColorSpace);
    const lum = THREE.MathUtils.clamp((P.r + P.g + P.b) / 3 / 0.3, 0.7, 1.3);
    // the landing spot for "Into the rows": the 16 m patch with the most different crops in view
    const cellKey = Math.floor(x / 16) + "," + Math.floor(y / 16);
    if (inRing(x, y, GARDENS[0])) { const e = cnt.get(cellKey) || { n: 0, kinds: new Set() }; e.n++; e.kinds.add(t); cnt.set(cellKey, e); }
    for (let c = 0; c < K.cluster; c++) {
      const h = hash01(x * 3.1 + c, y * 1.7 - c);
      const jx = c ? x + (hash01(y + c, x) - 0.5) * 0.55 : x, jy = c ? y + (hash01(x - c, y + 2) - 0.5) * 0.55 : y;
      const s = THREE.MathUtils.clamp(s0 * (0.8 + 0.4 * h), K.s[0], K.s[1]);
      C.setRGB(K.base[0], K.base[1], K.base[2], THREE.SRGBColorSpace).multiplyScalar(lum * (0.85 + 0.3 * h));
      if (t === 0 && h > 0.82) C.setRGB(0.42, 0.2, 0.2, THREE.SRGBColorSpace).multiplyScalar(lum); // a red-leaf lettuce now and then
      lists[t].push([jx, jy, s, rot + c * 2.1, C.clone()]);
      if (t === 4 && h > 0.35) shoulders.push([jx, jy, 0.016 + h * 0.012]);
      if (t === 6) for (let k = 0; k < (PHONE ? 2 : 4); k++) {
        const a = hash01(jx + k, jy) * Math.PI * 2, r = s * (0.25 + 0.25 * hash01(jy, jx + k)), ripe = hash01(k * 1.3 + jx, jy);
        fruit.push([jx + Math.cos(a) * r, groundAt(jx, jy) + 0.03, jy + Math.sin(a) * r, 0.016, ripe > 0.25 ? [0.7, 0.06, 0.06] : [0.85, 0.85, 0.6]]);
      }
      if (t === 7) {
        const palette = [[0.95, 0.42, 0.1], [0.85, 0.12, 0.35], [0.98, 0.8, 0.15], [0.95, 0.9, 0.85], [0.6, 0.2, 0.55]];
        const c0 = palette[Math.floor(hash01(B[o + 10], 3.3) * palette.length)];
        for (let k = 0; k < (PHONE ? 2 : 4); k++) {
          const a = hash01(jx - k, jy) * Math.PI * 2, r = s * 0.25 * hash01(jy + k, jx), hh = s * (0.75 + 0.25 * hash01(k, jx));
          const c = hash01(k + jy, 7) < 0.8 ? c0 : palette[k % palette.length];
          blooms.push([jx + Math.cos(a) * r, groundAt(jx, jy) + hh, jy + Math.sin(a) * r, 0.035 + 0.02 * hash01(jx, k), c]);
        }
      }
      if (t === 8) heads.push([jx, jy, s * (0.17 + 0.05 * h), hash01(jy, jx) < 0.6]);
    }
    const g0 = groundAt(x, y);
    if (t === 3) {
      // dry-farmed tomatoes: a stake, and fruit hanging low in the bush, mostly ripe
      if (hash01(y * 1.3, x) < 0.5) stakes.push([x + 0.12, y + 0.05, s0, hash01(x, y) < 0.6]);
      const nf = PHONE ? 4 : 9;
      for (let k = 0; k < nf; k++) {
        const a = hash01(x + k, y - k) * Math.PI * 2, r = (0.12 + 0.3 * hash01(y + k, x)) * Math.max(0.6, s0 * 0.8), hy = 0.15 + 0.5 * hash01(x * 2 + k, y);
        const ripe = hash01(k + x, k - y);
        fruit.push([x + Math.cos(a) * r, g0 + hy * Math.max(0.6, s0), y + Math.sin(a) * r, 0.03 + 0.015 * ripe,
          ripe > 0.3 ? [0.62, 0.08, 0.04] : ripe > 0.15 ? [0.85, 0.42, 0.1] : [0.38, 0.5, 0.18]]);
      }
    }
    if (t === 2 && hash01(y, x) > 0.35) {
      const a = rot, r = 0.25 + 0.3 * hash01(x, y + 1), big = hash01(x + 9, y);
      pumpkins.push([x + Math.cos(a) * r, y + Math.sin(a) * r, 0.11 + big * 0.1, big > 0.5 ? [0.86, 0.45, 0.08] : [0.78, 0.62, 0.38]]);
    }
  }
  // the most planted spot on the Farm, for "Into the rows"
  let best = null, bn = 0;
  for (const [k, v] of cnt) { const score = v.kinds.size * 60 + Math.min(v.n, 120); if (score > bn) { bn = score; best = k; } }
  if (best) { const [cx, cy] = best.split(",").map(Number); CROP.spot = [cx * 16 + 8, cy * 16 + 8]; }
  const group = new THREE.Group();
  const geoOf = (t) => CROP_KIND[t].geo;
  lists.forEach((L, t) => {
    if (!L.length) return;
    const im = new THREE.InstancedMesh(geoOf(t), mats[t], L.length);
    L.forEach(([x, y, s, r, col], k) => {
      TQ.setFromAxisAngle(UPY, r);
      TM.compose(TP.set(x, groundAt(x, y) - 0.02, -y), TQ, TS.set(s, s * CROP_KIND[t].h, s));
      im.setMatrixAt(k, TM); im.setColorAt(k, col);
    });
    // plants cast shadows on the soil, but thin leaves don't take shadows on themselves (it turns them black)
    im.castShadow = !PHONE; im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  });
  const solid = (geo, list, place, key) => {
    if (!list.length) return;
    const m = withFade(landShader(lam({}), key, 1), CROP.fade);
    const im = new THREE.InstancedMesh(geo, m, list.length);
    list.forEach((it, k) => { place(it); im.setMatrixAt(k, TM); im.setColorAt(k, C); });
    im.castShadow = !PHONE; im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  };
  TQ.identity();
  solid(fruitGeo, fruit, ([x, yy, y, r, c]) => { TM.compose(TP.set(x, yy, -y), TQ, TS.set(r, r * 0.9, r)); C.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }, "tomatoFruit");
  solid(pumpkinGeo, pumpkins, ([x, y, r, c]) => { TM.compose(TP.set(x, groundAt(x, y) + r * 0.55, -y), TQ, TS.set(r, r * 0.78, r)); C.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }, "squashFruit");
  solid(stakeGeo, stakes, ([x, y, s, metal]) => { TM.compose(TP.set(x, groundAt(x, y) - 0.1, -y), TQ, TS.set(metal ? 0.025 : 0.03, 0.95, metal ? 0.025 : 0.03)); C.setRGB(...(metal ? [0.18, 0.4, 0.24] : [0.45, 0.33, 0.2]), THREE.SRGBColorSpace); }, "stakes");
  solid(shoulderGeo, shoulders, ([x, y, r]) => { TM.compose(TP.set(x, groundAt(x, y) - 0.005, -y), TQ, TS.set(r, r * 0.8, r)); C.setRGB(0.9, 0.42, 0.08, THREE.SRGBColorSpace); }, "carrotTops");
  solid(fruitGeo, blooms, ([x, yy, y, r, c]) => { TM.compose(TP.set(x, yy, -y), TQ, TS.set(r, r * 0.45, r)); C.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); }, "blooms");
  solid(fruitGeo, heads, ([x, y, r, cab]) => { TM.compose(TP.set(x, groundAt(x, y) + r * 0.7, -y), TQ, TS.set(r, r * (cab ? 0.85 : 0.7), r)); C.setRGB(...(cab ? [0.62, 0.74, 0.6] : [0.24, 0.36, 0.22]), THREE.SRGBColorSpace); }, "heads");
  scene.add(group);
  CROP.group = group;
  CROP.ready = true;
}
const CROP_C = (() => { const r = GARDENS[0]; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return new THREE.Vector3(x / r.length, 0, -y / r.length); })();
const CROP_C2 = (() => { const r = GARDENS[1]; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return new THREE.Vector3(x / r.length, 0, -y / r.length); })();
function updateCrops(dt) {
  if (!cropBytes) return;
  // only worth drawing when you're down close to a garden: from the stops a plant is smaller than a pixel
  const flat = (v) => Math.hypot(camera.position.x - v.x, camera.position.z - v.z);
  const h = camera.position.y - groundAt(camera.position.x, -camera.position.z);
  const near = Math.min(flat(CROP_C) - 260, flat(CROP_C2) - 120) < 120 && h < (PHONE ? 220 : 340) && !state.layers.beyond;
  if (near && !CROP.ready) buildCrops();
  CROP.p += ((near ? 1 : 0) - CROP.p) * (1 - Math.exp(-dt * 2.2));
  if (CROP.group) { CROP.group.visible = CROP.p > 0.01; CROP.fade.value.set(0, CROP.p > 0.99 ? 1 : CROP.p); }
  U.uCropShow.value = CROP.ready ? CROP.p : 0;
}

// ---------------------------------------------------------------- surrounding land, ocean
setLoading("Adding the coast");
{
  let ctxTex = null; // fallback single image, only fetched if a tile is missing
  // the 16 km ring in 2 x 2 pieces, each with its own County 2025 photo (~2 m per pixel)
  const n = C.tgrid || 1, cw = (C.xmax - C.xmin) / n, chh = (C.ymax - C.ymin) / n, seg = PHONE ? 110 : 220;
  const inset = 60;
  const ctxMaps = await Promise.all([...Array(n * n)].map((_, k) => C.tiles
    ? loadBitmapTex("data/" + C.tiles.replace("{r}", Math.floor(k / n)).replace("{c}", k % n)).catch(() => null)
    : Promise.resolve(null)));
  if (ctxMaps.some((m) => !m)) {
    ctxTex = await new THREE.TextureLoader().loadAsync("data/" + C.image);
    ctxTex.colorSpace = THREE.SRGBColorSpace;
    ctxTex.anisotropy = MAX_ANISO;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = C.xmin + i * cw, y1 = C.ymax - j * chh;
    const g = new THREE.PlaneGeometry(cw, chh, seg, seg);
    g.rotateX(-Math.PI / 2);
    g.translate(x0 + cw / 2, 0, -(y1 - chh / 2));
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = -p.getZ(k);
      const deep = x > E.xmin + inset && x < E.xmax - inset && y > E.ymin + inset && y < E.ymax - inset;
      p.setY(k, deep ? ctxAt(x, y) - 120 : ctxAt(x, y) - 1.2);
    }
    g.computeVertexNormals();
    let map = ctxMaps[j * n + i];
    if (!map) {
      map = ctxTex.clone();
      map.repeat.set(1 / n, 1 / n);
      map.offset.set(i / n, 1 - (j + 1) / n);
    }
    scene.add(new THREE.Mesh(g, landShader(lam({ map }), "land")));
  }

  // skirt where the detailed model meets the wider land, so tree edges don't float
  const edge = [];
  const step = 4;
  for (let x = E.xmin; x <= E.xmax; x += step) edge.push([x, E.ymax]);
  for (let y = E.ymax; y >= E.ymin; y -= step) edge.push([E.xmax, y]);
  for (let x = E.xmax; x >= E.xmin; x -= step) edge.push([x, E.ymin]);
  for (let y = E.ymin; y <= E.ymax; y += step) edge.push([E.xmin, y]);
  const v = [];
  for (let k = 0; k < edge.length - 1; k++) {
    const [x1, y1] = edge[k], [x2, y2] = edge[k + 1];
    const a1 = surfAt(x1, y1), a2 = surfAt(x2, y2), b1 = groundAt(x1, y1) - 2, b2 = groundAt(x2, y2) - 2;
    v.push(x1, a1, -y1, x1, b1, -y1, x2, a2, -y2, x2, a2, -y2, x1, b1, -y1, x2, b2, -y2);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  sg.computeVertexNormals();
  scene.add(new THREE.Mesh(sg, landShader(lam({ color: 0x2a3022, side: THREE.DoubleSide }), "skirt")));

  // outer ring: the Santa Cruz Mountains and Monterey Bay out to the horizon
  const O = S.outer;
  const [outerH, outerTex] = await Promise.all([
    heightsFrom("data/" + O.file, O.cols, O.rows),
    loadBitmapTex("data/" + O.image),
  ]);
  outerTex.colorSpace = THREE.SRGBColorSpace;
  outerTex.anisotropy = MAX_ANISO;
  const outerAt = sampler(outerH, O.cols, O.rows, O.xmin, O.xmax, O.ymin, O.ymax);
  const og = new THREE.PlaneGeometry(O.xmax - O.xmin, O.ymax - O.ymin, PHONE ? 160 : 260, PHONE ? 180 : 300);
  og.rotateX(-Math.PI / 2);
  og.translate((O.xmin + O.xmax) / 2, 0, -(O.ymin + O.ymax) / 2);
  const op = og.attributes.position;
  for (let k = 0; k < op.count; k++) {
    const x = op.getX(k), y = -op.getZ(k);
    const deep = x > C.xmin + 400 && x < C.xmax - 400 && y > C.ymin + 400 && y < C.ymax - 400;
    op.setY(k, deep ? outerAt(x, y) - 200 : outerAt(x, y) - 3);
  }
  og.computeVertexNormals();
  scene.add(new THREE.Mesh(og, landShader(lam({ map: outerTex }), "land")));

  // the ocean: one surface at sea level everywhere; the land covers it
  const shoreTex = await new THREE.TextureLoader().loadAsync("data/" + C.shore).catch(() => null);
  const seaMat = landShader(new THREE.MeshStandardMaterial({ color: 0x0b3550, roughness: 0.09, metalness: 0, envMapIntensity: 0.72 }), "sea", 1);
  {
    const base = seaMat.onBeforeCompile;
    seaMat.onBeforeCompile = (sh) => {
      base(sh);
      sh.uniforms.uShore = { value: shoreTex };
      sh.uniforms.uShoreBox = { value: new THREE.Vector4(C.xmin, C.xmax, C.ymin, C.ymax) };
      sh.fragmentShader = sh.fragmentShader
        .replace("uniform float uGreen;", `uniform float uGreen;
          uniform sampler2D uShore; uniform vec4 uShoreBox;
          // irregular sea: animated value-noise heights at three scales; gradient by finite differences
          float seaH(vec2 p, float t) {
            return vnoise(vec3(p * 0.012, t * 0.10)) * 1.0 + vnoise(vec3(p * 0.045 + 7.0, t * 0.22)) * 0.45 + vnoise(vec3(p * 0.16 + 13.0, t * 0.45)) * 0.16;
          }
          vec2 waveGrad(vec2 p, float t, float detail) {
            float e = 1.5;
            float h0 = seaH(p, t);
            vec2 g = vec2(seaH(p + vec2(e, 0.0), t) - h0, seaH(p + vec2(0.0, e), t) - h0) / e;
            return g * 6.0 * detail;
          }`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          {
            float dist = length(vWPos - cameraPosition);
            float fade = 1.0 - smoothstep(400.0, 9000.0, dist);
            // far swell keeps some slope, so the bay reflects the bluer sky above the horizon instead of a pale mirror
            vec2 g = waveGrad(vWPos.xz, uTime, mix(0.55, 1.0, fade));
            vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          // distance to the shore: shallow water goes turquoise, and surf rolls in toward the beach
          vec2 suv = vec2((vWPos.x - uShoreBox.x) / (uShoreBox.y - uShoreBox.x), (-vWPos.z - uShoreBox.z) / (uShoreBox.w - uShoreBox.z));
          float inBox = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
          float sd = mix(600.0, texture2D(uShore, clamp(suv, 0.0, 1.0)).r * 600.0, inBox);
          float wn = vnoise(vec3(vWPos.xz * 0.06, uTime * 0.25));
          float shallow = 1.0 - smoothstep(8.0, 260.0, sd);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.2, 0.2), shallow * 0.6);
          float rows = 0.5 + 0.5 * sin(sd * 0.21 - uTime * 1.05 + wn * 5.0);
          float surf = (1.0 - smoothstep(6.0, 48.0 + wn * 25.0, sd)) * smoothstep(0.6, 0.95, rows);
          float wash = 1.0 - smoothstep(0.0, 9.0 + wn * 6.0, sd);
          float foam = clamp(surf * 0.75 + wash * 0.85, 0.0, 1.0) * (0.75 + 0.25 * vnoise(vec3(vWPos.xz * 0.9, uTime)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.93), foam);`);
    };
    seaMat.customProgramCacheKey = () => "sea-waves";
  }
  const sea = new THREE.Mesh(new THREE.CircleGeometry(300000, 128), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0.6;
  scene.add(sea);
}

// ---------------------------------------------------------------- buildings: photo roofs, shaded walls
setLoading("Placing buildings");
const roofPages = await Promise.all((S.roofAtlas || []).map((f) => new THREE.TextureLoader().loadAsync("data/" + f).then((t) => {
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAX_ANISO; return t;
})));
function sliceGroup(geo, gi) {
  const grp = geo.groups[gi], out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    out.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(grp.start * attr.itemSize, (grp.start + grp.count) * attr.itemSize), attr.itemSize));
  }
  return out;
}
const roofGeos = (S.roofAtlas || []).map(() => []), wallGeos = [], plainRoofs = [], farmWalls = [];
// the Farm's own structures, drawn as what they are (OpenStreetMap types, see tools/building_kinds.py)
const hoopSkins = [], hoopRibs = [], posts = [];
function axisOf(r) {
  let cx = 0, cy = 0; for (const [x, y] of r) { cx += x; cy += y; } cx /= r.length; cy /= r.length;
  let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of r) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = Math.cos(th), ay = Math.sin(th);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of r) { const u = (x - cx) * ax + (y - cy) * ay, v = -(x - cx) * ay + (y - cy) * ax; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  return { cx: cx + ax * uc - ay * vc, cy: cy + ay * uc + ax * vc, ax, ay, L: u1 - u0, W: v1 - v0 };
}
function hoopHouse(b, minG) {
  // a hoop house: white plastic stretched over steel hoops, running the long way of the footprint
  const o = axisOf(b.r);
  const W = Math.min(o.W, 12), L = o.L, H = THREE.MathUtils.clamp(W * 0.48, 2.4, 4.3), seg = 16;
  const P = (u, v, y) => [o.cx + o.ax * u - o.ay * v, minG - 0.2 + y, -(o.cy + o.ay * u + o.ax * v)];
  const arc = (t) => [Math.cos(Math.PI * t) * W / 2, Math.sin(Math.PI * t) * H];
  const pos = [];
  for (let i = 0; i < seg; i++) {
    const [v0, y0] = arc(i / seg), [v1, y1] = arc((i + 1) / seg);
    const a = P(-L / 2, v0, y0), b2 = P(L / 2, v0, y0), c = P(L / 2, v1, y1), d = P(-L / 2, v1, y1);
    pos.push(...a, ...b2, ...c, ...a, ...c, ...d);
    for (const e of [-L / 2, L / 2]) pos.push(...P(e, 0, 0), ...P(e, v0, y0), ...P(e, v1, y1)); // end walls
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  hoopSkins.push(g);
  const n = Math.max(2, Math.round(L / 1.8));
  for (let k = 0; k <= n; k++) {
    const u = -L / 2 + (L * k) / n, pts = [];
    for (let i = 0; i <= 12; i++) { const [v, y] = arc(i / 12); pts.push(new THREE.Vector3(...P(u, v * 1.01, y * 1.01))); }
    hoopRibs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.04, 4, false));
  }
}
for (const b of S.buildings) {
  if (b.r.length < 3) continue;
  let minG = Infinity;
  for (const [x, y] of b.r) minG = Math.min(minG, groundAt(x, y));
  if (b.k === "gh") { hoopHouse(b, minG); continue; }
  const h = b.h + 1.5;
  const bb = b.bb, a = b.a;
  const uvGen = {
    generateTopUV(geometry, verts, iA, iB, iC) {
      return [iA, iB, iC].map((i) => {
        const x = verts[i * 3], y = verts[i * 3 + 1];
        if (!a || !bb) return new THREE.Vector2(0, 0);
        const u = a[1] + ((x - bb[0]) / (bb[2] - bb[0])) * (a[3] - a[1]);
        const vv = a[2] + ((y - bb[1]) / (bb[3] - bb[1])) * (a[4] - a[2]);
        return new THREE.Vector2(u, vv);
      });
    },
    generateSideWallUV() { return [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()]; },
  };
  const shape = new THREE.Shape(b.r.map(([x, y]) => new THREE.Vector2(x, y)));
  const open = b.k === "roof";
  let g = new THREE.ExtrudeGeometry(shape, { depth: open ? 0.3 : h, bevelEnabled: false, UVGenerator: uvGen });
  g.rotateX(-Math.PI / 2);
  g.translate(0, open ? minG - 1 + h - 0.3 : minG - 1, 0);
  if (open) {
    // an open shade structure: the roof stands on posts, and you can see under it
    const ring = b.r;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length], len = Math.hypot(x1 - x0, y1 - y0), m = Math.max(1, Math.round(len / 4.5));
      for (let k = 0; k < m; k++) { const t = k / m, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; posts.push([x, y, groundAt(x, y), minG - 1 + h - 0.3]); }
    }
  }
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const roof = sliceGroup(g, 0), wall = sliceGroup(g, 1);
  // walls: a light concrete tone, darker toward the ground (soft contact shadow)
  const tone = b.k === "farm" ? new THREE.Color(0x8a7660).lerp(new THREE.Color(b.c ? `rgb(${b.c[0]},${b.c[1]},${b.c[2]})` : 0x8a7660), 0.25)
    : b.c ? new THREE.Color(b.c[0] / 255, b.c[1] / 255, b.c[2] / 255).lerp(new THREE.Color(0xc9c2b5), 0.55) : new THREE.Color(0xc9c2b5);
  const wp = wall.attributes.position, col = new Float32Array(wp.count * 3);
  for (let k = 0; k < wp.count; k++) {
    const f = THREE.MathUtils.clamp((wp.getY(k) - (minG - 1)) / Math.max(4, h), 0, 1);
    const s = 0.5 + 0.5 * Math.sqrt(f);
    col[k * 3] = tone.r * s; col[k * 3 + 1] = tone.g * s; col[k * 3 + 2] = tone.b * s;
  }
  wall.setAttribute("color", new THREE.BufferAttribute(col, 3));
  wall.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(wp.count).fill(0.05 + 0.95 * hash01(b.r[0][0] * 0.37, b.r[0][1] * 0.53)), 1));
  if (b.k === "farm") farmWalls.push(wall); else wallGeos.push(wall);
  if (a && roofGeos[a[0]]) roofGeos[a[0]].push(roof); else plainRoofs.push(roof);
  g.dispose();
}
function addWindows(mat, key) {
  // every building its own facade: window rhythm (grid, ribbon or tall slits), sky-reflecting glass with frames,
  // some blinds drawn, concrete panel joints, rain streaks and a darker base
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    base(sh);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aSeed;\nvarying float vSeed;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSeed = aSeed;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSeed;")
      .replace("#include <color_fragment>", `#include <color_fragment>
      {
        vec3 wn = normalize(vWNrm);
        float sd = vSeed > 0.0 ? vSeed : hash3(floor(vec3(vWPos.x, 0.0, vWPos.z) / 30.0));
        float along = abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x;
        float floorH = mix(3.4, 4.1, fract(sd * 7.3));
        float bay = mix(2.1, 3.6, fract(sd * 13.7));
        float kind = fract(sd * 3.1);                       // < .45 grid, < .75 ribbon, else tall slits
        float wx = kind < 0.45 ? mix(0.5, 0.72, fract(sd * 5.9)) : kind < 0.75 ? 0.92 : 0.26;
        float wy0 = kind < 0.75 ? 0.32 : 0.16, wy1 = kind < 0.75 ? 0.8 : 0.88;
        float fy = fract(vWPos.y / floorH), fx = fract(along / bay);
        vec2 cell = vec2(floor(along / bay), floor(vWPos.y / floorH));
        float hx = abs(fx - 0.5) * 2.0, inX = 1.0 - step(wx, hx);
        float inY = step(wy0, fy) * step(fy, wy1);
        float aboveGround = smoothstep(0.0, 1.0, vColor.r * 3.0 - 0.6);
        float win = inX * inY;
        // frame: a thin pale border just inside each opening
        float fwX = wx - 0.06 * (1.0 / bay) * 2.0, edgeX = step(fwX, hx) * inX;
        float edgeY = (step(wy0, fy) - step(wy0 + 0.035, fy) + step(wy1 - 0.035, fy) - step(wy1, fy)) * inX;
        float frame = clamp(edgeX * inY + edgeY, 0.0, 1.0);
        // glass: dark, picking up more sky at grazing angles; a few windows have blinds drawn
        vec3 v = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(wn, v), 0.0), 3.0);
        float blinds = step(0.78, hash3(vec3(cell, sd * 91.0)));
        vec3 sky = mix(vec3(0.42, 0.52, 0.62), vec3(0.75, 0.8, 0.86), smoothstep(0.3, 0.9, fy));
        vec3 glass = mix(vec3(0.05, 0.065, 0.08), sky, 0.18 + 0.7 * fres);
        glass = mix(glass, vec3(0.62, 0.6, 0.55), blinds * 0.75 * smoothstep(0.45, 0.95, fy));
        // the wall: panel joints at each floor and bay, rain streaks below the sills, a darker base
        float joint = (1.0 - smoothstep(0.0, 0.012, abs(fy - 0.02))) + (1.0 - smoothstep(0.0, 0.008, abs(fx - 0.5)) ) * step(0.75, kind);
        float streak = vnoise(vec3(along * 1.7, vWPos.y * 0.12, sd * 9.0));
        diffuseColor.rgb *= 1.0 - 0.1 * joint;
        diffuseColor.rgb *= mix(0.9, 1.04, streak) * mix(1.0, 0.92, (1.0 - inY) * step(fy, wy0) * smoothstep(wy0 - 0.25, wy0, fy));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.84) * diffuseColor.rgb * 1.6, frame * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * (1.0 - frame) * 0.92 * aboveGround);
        diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 0.9, vColor.r * 3.0 - 0.3));
      }`);
  };
  mat.customProgramCacheKey = () => key + "-facades";
  return mat;
}
const wallMat = addWindows(landShader(lam({ vertexColors: true }), "walls", 1), "walls-windows");
const roofMats = roofPages.map((t) => landShader(lam({ map: t }), "roofs", 1));
const plainRoofMat = landShader(lam({ color: 0x9a948a }), "roofsPlain", 1);
const buildingMats = [wallMat, ...roofMats, plainRoofMat];
const buildingGroup = new THREE.Group();
const addMerged = (list, mat) => {
  if (!list.length) return;
  const m = new THREE.Mesh(mergeGeometries(list), mat);
  m.castShadow = m.receiveShadow = !PHONE;
  buildingGroup.add(m);
  list.forEach((g) => g.dispose());
};
addMerged(wallGeos, wallMat);
{
  // farm buildings and sheds: weathered board-and-batten siding, a door, no office windows
  const farmMat = landShader(lam({ vertexColors: true }), "farmWalls", 1);
  const b0 = farmMat.onBeforeCompile;
  farmMat.onBeforeCompile = (sh) => { b0(sh); sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec3 wn = normalize(vWNrm);
      float along = abs(wn.x) > abs(wn.z) ? vWPos.z : vWPos.x;
      float batten = 1.0 - smoothstep(0.0, 0.035, abs(fract(along / 0.32) - 0.5) - 0.44);
      float grain = vnoise(vec3(along * 3.0, vWPos.y * 0.4, 0.0)) * 0.5 + vnoise(vec3(along * 0.7, vWPos.y * 2.0, 1.0)) * 0.5;
      diffuseColor.rgb *= mix(0.86, 1.08, grain) * mix(1.0, 0.72, batten);`); };
  farmMat.customProgramCacheKey = () => "farmWalls-boards";
  addMerged(farmWalls, farmMat);
  if (hoopSkins.length) {
    const skin = landShader(lam({ color: 0xf4f4ee, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), "hoopSkin", 1);
    const m = new THREE.Mesh(mergeGeometries(hoopSkins), skin);
    m.renderOrder = 3; m.castShadow = !PHONE; m.receiveShadow = !PHONE;
    buildingGroup.add(m);
    addMerged(hoopRibs, landShader(lam({ color: 0x8d9094 }), "hoopRibs", 1));
  }
  if (posts.length) {
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), landShader(lam({ color: 0x5f554a }), "posts", 1), posts.length);
    posts.forEach(([x, y, g0, top], k) => { TM.compose(TP.set(x, g0 - 0.2, -y), TQ.identity(), TS.set(0.16, top - g0 + 0.2, 0.16)); pm.setMatrixAt(k, TM); });
    pm.castShadow = !PHONE; pm.receiveShadow = !PHONE; pm.computeBoundingSphere();
    buildingGroup.add(pm);
  }
}
roofGeos.forEach((list, k) => addMerged(list, roofMats[k]));
addMerged(plainRoofs, plainRoofMat);
scene.add(buildingGroup);

// ---------------------------------------------------------------- roads and paths (OpenStreetMap), crisp up close
// Below its pixels the aerial photo smears roads into grey; up close these ribbons take over: asphalt with aggregate and a
// dashed centre line, pale concrete walkways, compacted-dirt farm tracks. They fade out with distance, so the stop views
// keep the photo, and they take the 3D trees' shadows.
{
  const KINDS = {
    road: { w: 6.4, step: 3, lift: 0.18, col: 0x5b5a57 },
    foot: { w: 1.9, step: 2, lift: 0.14, col: 0xb3aa9a },
    track: { w: 3.2, step: 3, lift: 0.14, col: 0x8f7a5f },
  };
  for (const [kind, K] of Object.entries(KINDS)) {
    const pos = [], rib = [], idx = [];
    for (const path of S.paths) {
      if (path.c !== kind || path.p.length < 2) continue;
      // resample the line every few metres so the ribbon follows the ground
      const pts = [];
      for (let i = 0; i < path.p.length - 1; i++) {
        const [x0, y0] = path.p[i], [x1, y1] = path.p[i + 1], len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(len / K.step));
        for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
      }
      pts.push(path.p[path.p.length - 1]);
      let along = 0, base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i], [xa, ya] = pts[Math.max(0, i - 1)], [xb, yb] = pts[Math.min(pts.length - 1, i + 1)];
        let tx = xb - xa, ty = yb - ya; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        if (i) along += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
        for (const s of [-1, 1]) {
          const px = x - ty * s * K.w / 2, py = y + tx * s * K.w / 2;
          pos.push(px, groundY(px, py) + K.lift, -py);
          rib.push(s < 0 ? 0 : 1, along);
        }
        if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aRib", new THREE.Float32BufferAttribute(rib, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = landShader(lam({ color: K.col, transparent: true, depthWrite: false, side: THREE.DoubleSide }), "rib-" + kind, 0, 0);
    const b0 = m.onBeforeCompile;
    m.onBeforeCompile = (sh) => {
      b0(sh);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aRib;\nvarying vec2 vRib;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRib = aRib;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vRib;")
        .replace("#include <color_fragment>\n", `#include <color_fragment>
        {
          float a = vRib.x, d = vRib.y;
          float agg = vnoise(vWPos * 9.0) * 0.5 + vnoise(vWPos * 31.0) * 0.3 + vnoise(vWPos * 1.3) * 0.2;
          diffuseColor.rgb *= mix(0.84, 1.1, agg);
          ${kind === "road" ? `
          // patches, wheel-worn lanes and a dashed centre line
          diffuseColor.rgb *= mix(1.0, 0.86, smoothstep(0.55, 0.75, vnoise(vec3(vWPos.xz * 0.12, 3.0))));
          diffuseColor.rgb *= 1.0 - 0.05 * (1.0 - smoothstep(0.0, 0.1, abs(abs(a - 0.5) - 0.24)));
          float cl = (1.0 - smoothstep(0.006, 0.014, abs(a - 0.5))) * step(fract(d / 9.0), 0.45);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.62, 0.2), cl * 0.9);` : kind === "foot" ? `
          // expansion joints across the walk
          diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.03, abs(fract(d / 1.6) - 0.5) - 0.47));` : `
          // two wheel ruts with grass between
          float rut = 1.0 - smoothstep(0.06, 0.16, abs(abs(a - 0.5) - 0.24));
          diffuseColor.rgb = mix(diffuseColor.rgb * 0.88, vec3(0.32, 0.38, 0.2), (1.0 - rut) * smoothstep(0.08, 0.0, abs(a - 0.5)) * 0.6);`}
          float edge = smoothstep(0.0, 0.07, a) * smoothstep(1.0, 0.93, a);
          float near = 1.0 - smoothstep(220.0, 520.0, distance(cameraPosition, vWPos));
          diffuseColor.a = edge * near;
        }
`);
    };
    const key = m.customProgramCacheKey();
    m.customProgramCacheKey = () => key + "|rib";
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = !PHONE;
    mesh.renderOrder = 1;
    scene.add(mesh);
  }
}

// ---------------------------------------------------------------- grass: 3D tufts near the camera, where the photo shows grass
// Built in 40 m cells only around where you're looking up close, and released behind you. Not under trees or roofs
// (canopy surface), not in the crop beds, not on roads and paths. Colour from the photo under each tuft.
const GRASS = { cells: new Map(), size: 40, pix: null, pw: 0, ph: 0, road: null, mat: null, geo: null, building: false };
(async () => {
  try {
    const bmp = await createImageBitmap(await (await fetch("data/" + S.tiles.base)).blob(), { resizeWidth: 1050, resizeHeight: 1300 });
    const [c, g] = makeCanvas(1050, 1300); g.drawImage(bmp, 0, 0); bmp.close?.();
    GRASS.pix = g.getImageData(0, 0, 1050, 1300).data; GRASS.pw = 1050; GRASS.ph = 1300;
  } catch { GRASS.pix = null; } // grass is a close-up extra; without the photo sample it simply doesn't grow
  // where roads and paths run (1 m grid), so tufts stay off them
  const W = Math.ceil(E.xmax - E.xmin), H = Math.ceil(E.ymax - E.ymin), road = new Uint8Array(W * H);
  const half = { road: 3.6, foot: 1.2, track: 2 };
  for (const path of S.paths) {
    const r = half[path.c] || 1.2;
    for (let i = 0; i < path.p.length - 1; i++) {
      const [x0, y0] = path.p[i], [x1, y1] = path.p[i + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / Math.max(1, n), y = y0 + ((y1 - y0) * k) / Math.max(1, n);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const cx = Math.floor(x + dx - E.xmin), cy = Math.floor(y + dy - E.ymin);
          if (cx >= 0 && cy >= 0 && cx < W && cy < H) road[cy * W + cx] = 1;
        }
      }
    }
  }
  // and none where a crop plant stands (1 m around each)
  if (cropBytes) for (let i = 0; i < S.crops.count; i++) {
    const o = i * 12, x = ((cropBytes[o] << 8) | cropBytes[o + 1]) * 0.05, y = ((cropBytes[o + 2] << 8) | cropBytes[o + 3]) * 0.05;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = Math.floor(x + dx), cy = Math.floor(y + dy);
      if (cx >= 0 && cy >= 0 && cx < W && cy < H) road[cy * W + cx] = 1;
    }
  }
  GRASS.road = road; GRASS.rw = W;
  const B = cardBuilder();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    B.quad([-cx, 0, -cz], [cx, 0, cz], [cx, 1, cz], [-cx, 1, -cz], [0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  GRASS.geo = B.build();
  GRASS.mat = twoSided(treeShader(lam({ map: cropLeafTex("grain"), side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true }), "grassTufts"));
})();
function buildGrassCell(ci, cj) {
  const S0 = GRASS.size, step = PHONE ? 0.9 : 0.55, recs = [];
  for (let y = cj * S0; y < (cj + 1) * S0; y += step) for (let x = ci * S0; x < (ci + 1) * S0; x += step) {
    const jx = x + (hash01(x, y) - 0.5) * step, jy = y + (hash01(y + 3, x) - 0.5) * step;
    if (!inMain(jx, jy)) continue;
    const g0 = groundAt(jx, jy);
    if (surfAt(jx, jy) - g0 > 1.2) continue; // under a crown or a roof
    const rx = Math.floor(jx - E.xmin), ry = Math.floor(jy - E.ymin);
    if (GRASS.road[ry * GRASS.rw + rx]) continue;
    const px = Math.floor(((jx - E.xmin) / (E.xmax - E.xmin)) * GRASS.pw), py = Math.floor(((E.ymax - jy) / (E.ymax - E.ymin)) * GRASS.ph);
    const o = (py * GRASS.pw + px) * 4, r = GRASS.pix[o], gg = GRASS.pix[o + 1], b = GRASS.pix[o + 2];
    // grassy ground in the photo: not grey pavement, not bare dark soil, not white roofs
    const lum = (r + gg + b) / 3, sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    // dry summer grass is brighter than tilled soil, green grass is greener than it
    const gr = gg / Math.max(1, r);
    if (sat < 18 || lum > 215 || b > gg || !(gr > 0.95 || (lum > 125 && gr > 0.86))) continue;
    recs.push([jx, jy, g0, r, gg, b]);
  }
  if (!recs.length) return new THREE.Group();
  const im = new THREE.InstancedMesh(GRASS.geo, GRASS.mat, recs.length);
  const C = new THREE.Color();
  recs.forEach(([x, y, g0, r, gg, b], k) => {
    const h = hash01(x * 1.7, y * 2.3), s = 0.5 + 0.45 * h;
    TQ.setFromAxisAngle(UPY, h * 6.283);
    TM.compose(TP.set(x, g0 - 0.03, -y), TQ, TS.set(s, 0.2 + 0.32 * hash01(y, x) * hash01(x + 1, y), s));
    im.setMatrixAt(k, TM);
    C.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace).multiplyScalar(0.95 + 0.4 * hash01(y * 3.1, x));
    im.setColorAt(k, C);
  });
  im.castShadow = false; im.receiveShadow = !PHONE;
  im.computeBoundingSphere();
  const grp = new THREE.Group(); grp.add(im);
  return grp;
}
function updateGrass() {
  if (!GRASS.pix || !GRASS.geo) return;
  const t = controls.target, h = camera.position.y - groundAt(camera.position.x, -camera.position.z);
  const want = new Set();
  if (h < 110 && camera.position.distanceTo(t) < 160) {
    const R = PHONE ? 1 : 2, ci0 = Math.floor(t.x / GRASS.size), cj0 = Math.floor(-t.z / GRASS.size);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) want.add((ci0 + di) + "," + (cj0 + dj));
  }
  for (const [k, g] of GRASS.cells) if (!want.has(k)) { scene.remove(g); g.children.forEach((m) => m.dispose?.()); GRASS.cells.delete(k); }
  for (const k of want) if (!GRASS.cells.has(k)) {
    const [ci, cj] = k.split(",").map(Number), g = buildGrassCell(ci, cj);
    scene.add(g); GRASS.cells.set(k, g);
    break; // one new cell per update keeps the frame rate steady
  }
}

// ---------------------------------------------------------------- the Produce Pop-Up on Quarry Plaza (Wednesdays), as in my November 4 clips:
// white canopy tents in a row on the plaza, tables with red cloths, crates of produce, and the sign
const POPUP = (() => {
  const [sx, sy] = S.sites.quarry;
  const x0 = sx - 6, y0 = sy - 9; // the open paving just south of the site marker, beside the curved building
  const g = new THREE.Group();
  const M = (c) => landShader(lam({ color: c }), "popup" + c.toString(16), 1);
  const white = M(0xf3f3f0), frame = M(0x9a9da2), cloth = M(0xa8282a), wood = M(0x8a6b4a), board = M(0x2f3a2c);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (geo, mat, x, y, z, sx_, sy_, sz, ry = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx_, sy_, sz); m.rotation.y = ry;
    m.castShadow = m.receiveShadow = !PHONE; g.add(m); return m;
  };
  const roof = new THREE.ConeGeometry(Math.SQRT2 * 1.55, 0.75, 4, 1, true); roof.rotateY(Math.PI / 4);
  const produce = [[0.2, 0.33, 0.24], [0.86, 0.45, 0.08], [0.62, 0.09, 0.07], [0.55, 0.75, 0.3], [0.48, 0.2, 0.42], [0.9, 0.78, 0.25]];
  const fruitG = new THREE.IcosahedronGeometry(1, 1);
  const pieces = [];
  for (let k = 0; k < 3; k++) {
    const cx = x0, cy = y0 - k * 3.1, gy = groundAt(cx, cy);
    const X = cx, Z = -cy;
    // canopy: peaked white top, a skirt around the edge, four legs
    add(roof, white, X, gy + 2.45 + 0.375, Z, 1, 1, 1);
    for (const [dx, dz, w, d] of [[0, -1.5, 3.05, 0.03], [0, 1.5, 3.05, 0.03], [-1.5, 0, 0.03, 3.05], [1.5, 0, 0.03, 3.05]]) add(box, white, X + dx, gy + 2.32, Z + dz, w, 0.26, d);
    for (const [dx, dz] of [[-1.48, -1.48], [1.48, -1.48], [-1.48, 1.48], [1.48, 1.48]]) add(box, frame, X + dx, gy + 1.2, Z + dz, 0.035, 2.4, 0.035);
    // table with a red cloth, crates on top
    add(box, cloth, X - 0.55, gy + 0.38, Z, 0.78, 0.76, 2.4); // tables along the west edge, facing the walkway
    for (let c = 0; c < 4; c++) {
      const cz = Z - 0.9 + c * 0.6, col = produce[(k * 4 + c) % produce.length];
      add(box, wood, X - 0.55, gy + 0.84, cz, 0.5, 0.14, 0.42);
      for (let p = 0; p < 9; p++) pieces.push([X - 0.7 + (p % 3) * 0.15, gy + 0.93 + (p > 5 ? 0.05 : 0), cz - 0.14 + Math.floor(p / 3) * 0.14, col]);
    }
  }
  // the produce itself, heaped in the crates
  const im = new THREE.InstancedMesh(fruitG, landShader(lam({}), "popupProduce", 1), pieces.length);
  const c3 = new THREE.Color();
  pieces.forEach(([x, y, z, col], k) => {
    TM.compose(TP.set(x + (hash01(x, k) - 0.5) * 0.04, y, z), TQ.identity(), TS.setScalar(0.065 + hash01(k, z) * 0.02));
    im.setMatrixAt(k, TM); im.setColorAt(k, c3.setRGB(col[0], col[1], col[2], THREE.SRGBColorSpace));
  });
  im.castShadow = !PHONE; g.add(im);
  // the sign out front: "Affordable organic produce from the UCSC Student Farm"
  {
    const [c, ctx] = makeCanvas(256, 384);
    ctx.fillStyle = "#f4f1e8"; ctx.fillRect(0, 0, 256, 384);
    ctx.fillStyle = "#3d6b35"; ctx.fillRect(0, 0, 256, 92);
    ctx.fillStyle = "#fff"; ctx.font = "bold 34px Georgia, serif"; ctx.textAlign = "center"; ctx.fillText("Produce", 128, 44); ctx.fillText("Pop-Up", 128, 82);
    ctx.fillStyle = "#2b2b2b"; ctx.font = "26px Georgia, serif";
    ["Affordable", "organic produce", "from the UCSC", "Student Farm"].forEach((t, i) => ctx.fillText(t, 128, 150 + i * 44));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = MAX_ANISO;
    const face = landShader(lam({ map: tex }), "popupSign", 1);
    const sx2 = x0 - 2.2, sy2 = y0 + 1.4, gy = groundAt(sx2, sy2);
    for (const s of [-1, 1]) {
      const m = add(new THREE.PlaneGeometry(1, 1), face, sx2 + s * 0.14, gy + 0.5, -sy2, 0.6, 0.9, 1, s > 0 ? Math.PI / 2 : -Math.PI / 2);
      m.rotation.z = s * 0.16;
    }
    add(box, board, sx2, gy + 0.03, -sy2, 0.36, 0.06, 0.62);
  }
  scene.add(g);
  return { group: g, spot: [x0 - 0.5, y0 - 3.1] };
})();

// ---------------------------------------------------------------- Santa Cruz around campus: OpenStreetMap buildings in 3D
const cityMats = [];
async function loadCity() {
  if (PHONE) return;
  const CJ = await fetch("data/city.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (CJ && CJ.b && CJ.b.length) {
    const wp = [], wc = [], rp = [], rc = [];
    const col = new THREE.Color(), wallTone = new THREE.Color(0xd9d1c4), wcol = new THREE.Color();
    for (const b of CJ.b) {
      const h = b[0] / 10, rgb = b[1], n = (b.length - 2) / 2;
      let pts = [];
      for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(b[2 + 2 * k] / 2, b[3 + 2 * k] / 2));
      if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
      let minG = Infinity;
      for (const q of pts) minG = Math.min(minG, ctxAt(q.x, q.y));
      const lo = minG - 2, hi = minG + h;
      col.setRGB(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, THREE.SRGBColorSpace);
      wcol.copy(col).lerp(wallTone, 0.6);
      for (let k = 0; k < n; k++) {
        const a = pts[k], c = pts[(k + 1) % n];
        wp.push(a.x, lo, -a.y, c.x, lo, -c.y, c.x, hi, -c.y, a.x, lo, -a.y, c.x, hi, -c.y, a.x, hi, -a.y);
        const d = 0.55;
        wc.push(wcol.r * d, wcol.g * d, wcol.b * d, wcol.r * d, wcol.g * d, wcol.b * d, wcol.r, wcol.g, wcol.b,
                wcol.r * d, wcol.g * d, wcol.b * d, wcol.r, wcol.g, wcol.b, wcol.r, wcol.g, wcol.b);
      }
      for (const [i0, i1, i2] of THREE.ShapeUtils.triangulateShape(pts, [])) {
        for (const i of [i0, i2, i1]) { rp.push(pts[i].x, hi, -pts[i].y); rc.push(col.r, col.g, col.b); }
      }
    }
    const mk = (pos, colr, mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(colr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      scene.add(m);
      cityMats.push(mat);
    };
    mk(wp, wc, addWindows(landShader(lam({ vertexColors: true, side: THREE.DoubleSide }), "cityWalls", 1), "cityWalls-windows"));
    mk(rp, rc, landShader(lam({ vertexColors: true, side: THREE.DoubleSide }), "cityRoofs", 1));
  }
}

// ---------------------------------------------------------------- a few fair-weather clouds
const cloudMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  uniforms: { uTime: U.uTime, uBeyond: U.uBeyond, uSun: { value: sunDir } },
  vertexShader: `#include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vW;
    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `#include <common>
    #include <logdepthbuf_pars_fragment>
    uniform float uTime; uniform float uBeyond; uniform vec3 uSun; varying vec3 vW;
    ${NOISE_GLSL}
    float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vW.xz * 0.00022 + vec2(uTime * 0.0015, uTime * 0.0006);
      float n = fbm(vec3(p, 0.0));
      float cover = smoothstep(0.55, 0.66, n);
      float d = length(vW.xz - cameraPosition.xz);
      float fade = (1.0 - smoothstep(25000.0, 70000.0, d)) * smoothstep(0.0, 1500.0, d);
      float shade = mix(0.86, 1.08, smoothstep(0.5, 0.85, fbm(vec3(p * 2.1 + 3.0, 1.0))));
      vec3 col = mix(vec3(0.80, 0.84, 0.90), vec3(1.0, 0.995, 0.98), smoothstep(0.55, 0.8, n)) * shade;
      col = mix(col, vec3(0.93, 0.82, 0.62), uBeyond * 0.6);
      // seen from above, a flat cloud deck reads as a smear across the land, so it clears as you climb toward it
      fade *= 1.0 - smoothstep(900.0, 1550.0, cameraPosition.y);
      gl_FragColor = vec4(col, cover * fade);
    }`,
});
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000, 1, 1), cloudMat);
clouds.rotation.x = -Math.PI / 2;
clouds.position.y = 1700;
clouds.renderOrder = 1;
scene.add(clouds);

// ---------------------------------------------------------------- the CfA frame as a gold border floating just above the treetops
const FR = { lines: [], key: "" };
function frameLineObj(width, color, opacity, depthTest) {
  const g = new LineGeometry();
  g.setPositions([0, 0, 0, 1, 0, 0]);
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0, depthWrite: false, depthTest, toneMapped: false });
  m.userData.base = opacity;
  const l = new Line2(g, m);
  l.renderOrder = depthTest ? 6 : 5;
  l.frustumCulled = false;
  scene.add(l);
  FR.lines.push({ l, m });
  return l;
}
const frameCase = frameLineObj(13, 0x1b1209, 0.55, true);
const frameGold = frameLineObj(6, 0xffc164, 1.0, true);
const frameXray = frameLineObj(3.5, 0xffc164, 0.45, false);
const cornerGold = [0, 1, 2, 3].map(() => frameLineObj(11, 0xfff0d2, 1.0, true));
// draw order: dark casing under the gold, brackets over everything
frameCase.renderOrder = 5; frameGold.renderOrder = 6; frameXray.renderOrder = 4;
cornerGold.forEach((l) => (l.renderOrder = 8));
function squarePath(fx, fz, half, th, a0, a1) {
  // walk the square's perimeter from fraction a0 to a1 (0..1), draped over the treetops
  const cr = Math.cos(th), sr = Math.sin(th), per = 8 * half, step = Math.max(3, half / 120), out = [];
  const qAt = (u) => {
    const d = ((u % 1) + 1) % 1 * per, side = Math.floor(d / (2 * half)), t = d - side * 2 * half - half;
    return side === 0 ? [t, -half] : side === 1 ? [half, t] : side === 2 ? [-t, half] : [-half, -t];
  };
  const n = Math.max(2, Math.ceil(((a1 - a0) * per) / step));
  for (let i = 0; i <= n; i++) {
    const [qx, qy] = qAt(a0 + ((a1 - a0) * i) / n);
    const x = fx + cr * qx + sr * qy, z = fz - sr * qx + cr * qy;
    out.push(x, topAt(x, -z) + 3, z);
  }
  return out;
}
function updateFrameLines(alpha) {
  const f = U.uFocus.value, th = U.uFrameRot.value;
  const key = [f.x, f.y, f.z, th].map((v) => v.toFixed(1)).join(",");
  if (alpha > 0.01 && key !== FR.key && f.z < 5000) {
    FR.key = key;
    const ring = squarePath(f.x, f.y, f.z, th, 0, 1);
    for (const l of [frameCase, frameGold, frameXray]) {
      const g = new LineGeometry();
      g.setPositions(ring);
      l.geometry.dispose();
      l.geometry = g;
      l.computeLineDistances();
    }
    // corner brackets: a bright L at each corner, 18% of the side each way
    cornerGold.forEach((l, c) => {
      const g = new LineGeometry();
      g.setPositions(squarePath(f.x, f.y, f.z, th, c / 4 - 0.06, c / 4 + 0.06));
      l.geometry.dispose();
      l.geometry = g;
      l.computeLineDistances();
    });
  }
  for (const { m } of FR.lines) m.opacity = alpha * m.userData.base;
}

// checkpoint beacons: a thin pillar of light with energy rising through it, standing on a ground reticle
// (tick ring, rotating arc segments, a pulse that ripples outward). The reticle tightens as you arrive.
const BEACON = [];
{
  const LOGV = `#include <common>
    #include <logdepthbuf_pars_vertex>`;
  const shaftGeo = new THREE.CylinderGeometry(6, 6, 1, 24, 1, true);
  shaftGeo.translate(0, 0.5, 0);
  const irisGeo = new THREE.PlaneGeometry(2, 2);
  irisGeo.rotateX(-Math.PI / 2);
  for (const [key, xy] of Object.entries(S.sites)) {
    const col = new THREE.Color(CSSC[key]);
    const shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uColor: { value: col }, uAlpha: { value: 0 }, uTime: U.uTime },
      vertexShader: `${LOGV}
        varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
        void main() {
          #include <logdepthbuf_fragment>
          float view = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
          float core = pow(view, 10.0), halo = pow(view, 2.5) * 0.22;
          float fall = pow(1.0 - vUv.y, 1.4);
          float pulse = smoothstep(0.9, 1.0, fract(vUv.y * 3.0 - uTime * 0.35)) * 0.8;
          vec3 light = mix(vec3(0.86, 0.95, 1.0), uColor, 0.4);
          float a = fall * (core * (0.75 + pulse) + halo) * uAlpha;
          gl_FragColor = vec4(light * 1.2, a);
        }`,
    });
    const irisMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uColor: { value: col }, uAlpha: { value: 0 }, uOpen: { value: 0.4 }, uTime: U.uTime },
      vertexShader: `${LOGV}
        varying vec2 vUv;
        void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor; uniform float uAlpha; uniform float uOpen; uniform float uTime; varying vec2 vUv;
        float ring(float r, float at, float w) { return 1.0 - smoothstep(0.0, w, abs(r - at)); }
        void main() {
          #include <logdepthbuf_fragment>
          float r = length(vUv), a = atan(vUv.y, vUv.x);
          float A = (a + 3.14159265) / 6.2831853;                       // 0..1 around
          // outer ring with tick marks every 10 degrees, longer every 30
          float outer = ring(r, 0.96, 0.008);
          float tk = fract(A * 36.0), major = step(fract(A * 12.0 + 0.0001), 0.03) ;
          float ticks = (1.0 - smoothstep(0.0, 0.06, min(tk, 1.0 - tk))) * step(0.86 - major * 0.06, r) * step(r, 0.95);
          // three arc segments turning slowly, at a radius that tightens as you arrive
          float ar = mix(0.82, 0.5, uOpen);
          float seg = step(0.62, fract(A * 3.0 + uTime * 0.04));
          float arcs = ring(r, ar, 0.014) * seg;
          // a pulse rippling outward
          float pr = fract(uTime * 0.35);
          float pulse = ring(r, pr, 0.02) * (1.0 - pr) * 0.8;
          float dot0 = 1.0 - smoothstep(0.02, 0.05, r);
          vec3 light = mix(vec3(0.86, 0.95, 1.0), uColor, 0.4);
          float alpha = (outer * 0.7 + ticks * 0.55 + arcs * 0.9 + pulse + dot0) * uAlpha * (1.0 - smoothstep(0.98, 1.0, r));
          gl_FragColor = vec4(light * 1.15, alpha);
        }`,
    });
    const [x, y] = xy;
    const gy = groundY(x, y);
    const beam = new THREE.Mesh(shaftGeo, shaftMat);
    beam.position.set(x, gy, -y);
    beam.scale.set(1, 260, 1);
    beam.renderOrder = 7;
    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.set(x, topAt(x, y) + 1.5, -y);
    iris.scale.setScalar(55);
    iris.renderOrder = 7;
    scene.add(beam, iris);
    BEACON.push({ key, beam, iris, shaftMat, irisMat, on: 0 });
  }
}

// ---------------------------------------------------------------- outlines + route (fat lines on the ground; a faint copy shows through trees)
function drape(points, lift, step = 6) {
  const out = [];
  const push = (x, y) => out.push(x, groundY(x, y) + lift, -y);
  for (let k = 0; k < points.length - 1; k++) {
    const [x1, y1] = points[k], [x2, y2] = points[k + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let j = 0; j < n; j++) push(x1 + ((x2 - x1) * j) / n, y1 + ((y2 - y1) * j) / n);
  }
  push(...points[points.length - 1]);
  return out;
}
const fatMats = [];
const xrayLines = [];
function fatLine(points, color, width, lift, extra = {}, xray = 0.3) {
  const pos = drape(points, lift, 3);
  const mk = (depthTest, opacityScale) => {
    const g = new LineGeometry();
    g.setPositions(pos);
    const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0, depthWrite: false, depthTest, toneMapped: false, ...extra });
    m.userData.scale = opacityScale;
    fatMats.push(m);
    const l = new Line2(g, m);
    l.computeLineDistances();
    l.renderOrder = depthTest ? 3 : 2;
    scene.add(l);
    return l;
  };
  const main = mk(true, 1);
  if (xray) { const x = mk(false, xray); main.userData.xray = x; xrayLines.push(x); }
  return main;
}
function setLineOpacity(l, o) {
  l.material.opacity = o;
  if (l.userData.xray) l.userData.xray.material.opacity = o * l.userData.xray.material.userData.scale;
}
const outlines = {};
const caseLines = [];
for (const [key, p] of Object.entries(S.places)) {
  const ring = p.ring[0][0] === p.ring.at(-1)[0] && p.ring[0][1] === p.ring.at(-1)[1] ? p.ring : [...p.ring, p.ring[0]];
  caseLines.push(fatLine(ring, 0x1a120b, 6, 1.2, {}, 0));
  outlines[key] = fatLine(ring, COLORS[key], 3, 1.4);
}
// the produce's route as a line of light: a soft dark bed, a thin gold core, and pulses of light carrying the food uphill
const routeCase = fatLine(S.routes.farm_quarry.p, 0x0d0f10, 10, 1.5, {}, 0);
const routeBase = fatLine(S.routes.farm_quarry.p, 0xf3b46a, 3, 1.7, {}, 0.45);
const routeDash = fatLine(S.routes.farm_quarry.p, 0xfff4dc, 7, 1.9, { dashed: true, dashSize: 5, gapSize: 46 }, 0);
const routeFriCase = fatLine(S.routes.farm_selib.p, 0x0d0f10, 6, 1.5, {}, 0);
const routeFri = fatLine(S.routes.farm_selib.p, 0xf3b46a, 2.5, 1.7, { dashed: true, dashSize: 6, gapSize: 8 }, 0.4);

// route stats for the story text
const rq = S.routes.farm_quarry.p;
const climb = Math.round((groundAt(...rq.at(-1)) - groundAt(...rq[0])) / 10) * 10;
const TOKENS = { farm_quarry_km: (S.routes.farm_quarry.m / 1000).toFixed(1), farm_quarry_climb: String(climb) };

// a small light that walks the route during stop 5
const crate = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd9b0, transparent: true, opacity: 0, depthTest: false }));
crate.renderOrder = 5;
scene.add(crate);
const routeCurve = new THREE.CatmullRomCurve3(
  (() => {
    const d = drape(rq, 8, 20), pts = [];
    for (let k = 0; k < d.length; k += 3) pts.push(new THREE.Vector3(d[k], d[k + 1], d[k + 2]));
    return pts;
  })(),
  false,
  "centripetal"
);

// ---------------------------------------------------------------- pins
const pinEls = {};
for (const [key, meta] of Object.entries(SITES)) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pin";
  el.style.setProperty("--c", CSSC[key]);
  el.innerHTML = `<i></i><span>${esc(meta.label)}</span>`;
  el.addEventListener("click", () => {
    const idx = STOPS.findIndex((s) => s.view && s.view.at === key);
    pause();
    scrollToStop(idx >= 0 ? idx : STOPS.findIndex((s) => s.id === "popup"));
  });
  $("#pins").append(el);
  const [x, y] = S.sites[key];
  pinEls[key] = { el, pos: new THREE.Vector3(x, topAt(x, y) + 24, -y) };
}

// ---------------------------------------------------------------- layers UI
const layersEl = $("#layers");
layersEl.innerHTML = `<p class="lt"><span class="lt-label">Layers</span><button class="lt-toggle" type="button" aria-expanded="false">Layers <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button></p>` + LAYERS.map((l) =>
  `<button class="layer" type="button" role="switch" aria-checked="false" data-l="${l.id}" style="--c:${LAYER_SW[l.id]}">
     <span class="sw"></span><span><b>${l.name}</b><small>${l.hint}</small></span><span class="tg"></span></button>`).join("");
const phone = matchMedia("(max-width: 899px)");
const setCollapsed = (c) => { layersEl.classList.toggle("collapsed", c); layersEl.querySelector(".lt-toggle").setAttribute("aria-expanded", String(!c)); };
setCollapsed(true);
layersEl.addEventListener("click", (e) => {
  if (e.target.closest(".lt-toggle")) { setCollapsed(!layersEl.classList.contains("collapsed")); return; }
  const b = e.target.closest(".layer");
  if (!b) return;
  state.layers[b.dataset.l] = !state.layers[b.dataset.l];
  syncLayers();
});
function syncLayers() {
  for (const b of layersEl.querySelectorAll(".layer")) b.setAttribute("aria-checked", String(!!state.layers[b.dataset.l]));
}

// ---------------------------------------------------------------- camera views
const tmpV = new THREE.Vector3();
function viewOf(v) {
  const [x, y] = siteXY(v.at);
  return { target: toWorld(x, y, 0), dist: v.dist, pitch: v.pitch, heading: v.heading };
}
function currentView() {
  tmpV.subVectors(camera.position, controls.target);
  const dist = tmpV.length();
  return {
    target: controls.target.clone(),
    dist,
    pitch: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(tmpV.y / dist, -1, 1))),
    heading: THREE.MathUtils.radToDeg(Math.atan2(-tmpV.x, tmpV.z)),
  };
}
function place(v) {
  const p = THREE.MathUtils.degToRad(v.pitch), h = THREE.MathUtils.degToRad(v.heading);
  controls.target.copy(v.target);
  camera.position.set(
    v.target.x - Math.sin(h) * Math.cos(p) * v.dist,
    v.target.y + Math.sin(p) * v.dist,
    v.target.z + Math.cos(h) * Math.cos(p) * v.dist
  );
  camera.lookAt(v.target);
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function flyTo(v, dur = 2600) {
  state.routeAnim = null;
  if (REDUCED) { place(v); state.anim = null; return; }
  const a = currentView();
  const travel = a.target.distanceTo(v.target);
  const hop = Math.min(0.9, travel / (2.2 * Math.max(a.dist, v.dist)));
  state.anim = { a, b: v, t0: performance.now(), dur: dur * (0.75 + Math.min(0.6, travel / 3000)), hop };
}
function stepAnim(now) {
  const A = state.anim;
  if (!A) return;
  const t = Math.min(1, (now - A.t0) / A.dur), e = ease(t);
  const dh = ((A.b.heading - A.a.heading + 540) % 360) - 180;
  const d = Math.exp(THREE.MathUtils.lerp(Math.log(A.a.dist), Math.log(A.b.dist), e)) * (1 + A.hop * Math.sin(Math.PI * e));
  place({
    target: A.a.target.clone().lerp(A.b.target, e),
    dist: d,
    pitch: THREE.MathUtils.lerp(A.a.pitch, A.b.pitch, e),
    heading: A.a.heading + dh * e,
  });
  if (t >= 1) {
    state.anim = null;
    if (A.then) A.then();
  }
}
function runRoute(after) {
  if (REDUCED) { after(); return; }
  const start = routeCurve.getPointAt(0);
  const tan = routeCurve.getTangentAt(0.02);
  const v0 = { target: start, dist: 420, pitch: 34, heading: THREE.MathUtils.radToDeg(Math.atan2(tan.x, -tan.z)) };
  flyTo(v0, 2200);
  state.anim.then = () => {
    state.routeAnim = { t0: performance.now(), dur: 11000, heading: v0.heading, after };
  };
}
function stepRoute(now) {
  const R = state.routeAnim;
  if (!R) return;
  const t = Math.min(1, (now - R.t0) / R.dur);
  const u = 0.5 - 0.5 * Math.cos(Math.PI * t);
  const p = routeCurve.getPointAt(u);
  const tan = routeCurve.getTangentAt(Math.min(0.999, u + 0.03));
  const want = THREE.MathUtils.radToDeg(Math.atan2(tan.x, -tan.z));
  const dh = ((want - R.heading + 540) % 360) - 180;
  R.heading += dh * 0.035;
  place({ target: p.clone().setY(p.y - 12), dist: 420 + 260 * Math.sin(Math.PI * u), pitch: 34 + 8 * Math.sin(Math.PI * u), heading: R.heading });
  crate.position.copy(p);
  if (t >= 1) {
    state.routeAnim = null;
    R.after && R.after();
  }
}

// ---------------------------------------------------------------- story panel: one continuous scroll; the stop in the middle drives the map
const PRINTS = {};
const stopsEl = $("#stops");
const scroller = $("#storyScroll");
const dotsEl = $("#dots");
dotsEl.innerHTML = STOPS.map((s, k) => `<li><button type="button" data-k="${k}" aria-label="${esc(s.title)}"></button></li>`).join("");
dotsEl.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { pause(); scrollToStop(+b.dataset.k); } });
$("#prev").addEventListener("click", () => { pause(); scrollToStop(state.i - 1); });
$("#next").addEventListener("click", () => { pause(); scrollToStop(state.i >= STOPS.length - 1 ? 0 : state.i + 1); });
$("#brand").addEventListener("click", () => { pause(); scrollToStop(0); });
$("#resetView").addEventListener("click", () => flyTo(viewOf(STOPS[state.i].view), 1800));
// down into the rows: the most planted spot on the Farm, low enough to see each plant and its fruit
const closerBtn = $("#closer");
closerBtn.addEventListener("click", () => {
  pause();
  if (!CROP.ready && cropBytes) buildCrops();
  if (STOPS[state.i].view.at === "quarry") {
    const [x, y] = POPUP.spot;
    flyTo({ target: toWorld(x, y, 1.0), dist: 15, pitch: 22, heading: 22 }, 3600); // up the walkway from the south // from the open west side of the plaza, looking at the tents
    return;
  }
  const [x, y] = CROP.spot || S.sites.farm;
  flyTo({ target: toWorld(x, y, 0.4), dist: 22, pitch: 21, heading: STOPS[state.i].view.heading }, 3600);
});

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => TOKENS[k] ?? _);

function mediaHTML(media) {
  const items = media.map((m, k) => {
    if (m.type === "video")
      return `<figure class="m-item" data-k="${k}"><video src="${m.src}" poster="${m.poster}" muted loop playsinline preload="metadata" width="${m.w}" height="${m.h}" aria-label="${esc(m.caption)}"></video></figure>`;
    // the story column shows photos about 400 px wide: load the 640 px copy there, the full one only where it's needed
    const set = m.thumb ? ` srcset="${m.thumb} 640w, ${m.src} ${Math.max(m.w, m.h)}w" sizes="(max-width: 899px) 92vw, 400px"` : "";
    return `<figure class="m-item" data-k="${k}"><img src="${m.thumb || m.src}" data-full="${m.src}"${set} width="${m.w}" height="${m.h}" alt="${esc(m.caption)}" loading="lazy" decoding="async"></figure>`;
  }).join("");
  const hasVideo = media.some((m) => m.type === "video");
  const many = media.length > 1;
  return `<div class="media"><div class="track">${items}</div>
    <div class="m-bar"><p class="m-cap">${esc(media[0].caption)}</p>
      <div class="m-ctrl">
        ${many ? `<button type="button" data-a="prev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><span class="count">1 / ${media.length}</span><button type="button" data-a="next" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>` : ""}
        ${hasVideo ? `<button type="button" data-a="sound" aria-pressed="false">Sound</button>` : ""}
      </div></div></div>`;
}

// each carousel: plays only while its stop is active, and moves on by itself unless you take over
function wireMedia(root, media, stopIndex) {
  const track = root.querySelector(".track");
  if (!track) return null;
  const cap = root.querySelector(".m-cap"), count = root.querySelector(".count");
  const items = [...track.children];
  let active = 0, sound = false, on = false, touched = false, since = performance.now();
  const sizeItems = () => {
    const tw = track.clientWidth;
    const maxH = Math.min(innerHeight * (innerWidth < 900 ? 0.4 : 0.5), 480);
    items.forEach((it, j) => (it.style.height = Math.round(Math.min(maxH, (tw * media[j].h) / media[j].w)) + "px"));
    track.style.height = items[active].style.height;
  };
  new ResizeObserver(sizeItems).observe(track);
  sizeItems();
  const syncVideos = () => items.forEach((it, j) => {
    const v = it.querySelector("video");
    if (!v) return;
    if (on && j === active) { v.muted = !sound; v.play().catch(() => {}); } else v.pause();
  });
  const setActive = (k) => {
    active = k; since = performance.now();
    track.style.height = items[k].style.height;
    cap.textContent = media[k].caption;
    if (count) count.textContent = `${k + 1} / ${media.length}`;
    syncVideos();
    highlightPrint(stopIndex, k);
  };
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting && en.intersectionRatio > 0.6) setActive(+en.target.dataset.k);
  }, { root: track, threshold: [0.6] });
  items.forEach((it) => io.observe(it));
  const scrollTo = (k) => track.scrollTo({ left: items[k].offsetLeft - track.offsetLeft, behavior: REDUCED ? "auto" : "smooth" });
  root.querySelector(".m-ctrl")?.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    touched = true;
    if (b.dataset.a === "prev") scrollTo((active - 1 + items.length) % items.length);
    if (b.dataset.a === "next") scrollTo((active + 1) % items.length);
    if (b.dataset.a === "sound") {
      sound = !sound;
      b.setAttribute("aria-pressed", String(sound));
      b.textContent = sound ? "Sound on" : "Sound";
      syncVideos();
    }
  });
  track.addEventListener("pointerdown", () => (touched = true));
  track.addEventListener("click", (e) => {
    const img = e.target.closest(".m-item")?.querySelector("img");
    if (img) openPhoto(img.dataset.full || img.src, img.alt);
  });
  setActive(0);
  return {
    setOn(v) { on = v; touched = false; since = performance.now(); syncVideos(); if (v) highlightPrint(stopIndex, active); },
    tick(now) {
      if (!on || touched || items.length < 2) return;
      const hold = media[active].type === "video" ? 9000 : 5500;
      if (now - since > hold) scrollTo((active + 1) % items.length);
    },
    show(k) { touched = true; scrollTo(k); },
    get count() { return items.length; },
  };
}
// overlays hand focus back to whatever opened them when they close
let overlayOpener = null;
function closeOverlay(id) {
  if ($(id).hidden) return;
  $(id).hidden = true;
  if (overlayOpener && document.contains(overlayOpener)) overlayOpener.focus();
  overlayOpener = null;
}
function openPhoto(src, alt) {
  overlayOpener = document.activeElement;
  $("#lbImg").src = src;
  $("#lbImg").alt = alt;
  $("#lbCaption").textContent = alt;
  $("#lightbox").hidden = false;
  $("#lbClose").focus();
}

// two captions for the same picture: how I'd have captioned it for CfA in September, and how I'd caption it now.
// September pulls the map's gold frame in to what the photo shows; Now lets it back out.
function lensHTML(c) {
  return `<div class="lens" data-mode="then">
    <div class="lens-tabs" role="group" aria-label="Two captions for this stop">
      <button type="button" data-m="then" aria-pressed="true">September</button>
      <button type="button" data-m="now" aria-pressed="false">Now</button>
    </div>
    <div class="lens-cap" data-m="then"><span class="lens-k">${esc(c.thenLabel || "How I'd have captioned it for CfA in September")}</span><p>${esc(fill(c.then))}</p></div>
    <div class="lens-cap" data-m="now" hidden><span class="lens-k">${esc(c.nowLabel || "How I'd caption it now")}</span><p>${esc(fill(c.now))}</p></div>
  </div>`;
}
const LENS = { touched: false };
function setLens(k, mode, byUser) {
  const sec = sections[k], s = STOPS[k];
  if (!sec || !s.captions) return;
  const box = sec.querySelector(".lens");
  box.dataset.mode = mode;
  box.querySelectorAll(".lens-tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === mode)));
  box.querySelectorAll(".lens-cap").forEach((c) => (c.hidden = c.dataset.m !== mode));
  if (byUser) LENS.touched = true;
  if (k === state.i && s.frame) goals.focus.z = mode === "then" ? s.frame * 0.45 : s.frame;
}
const sections = [], carousels = [];
STOPS.forEach((s, k) => {
  const sec = document.createElement("section");
  sec.className = "stop" + (s.intro ? " is-intro" : "");
  sec.dataset.k = k;
  const head = s.intro ? `<h1>${esc(s.title)}</h1>` : `<h2>${esc(s.title)}</h2>`;
  const eyebrow = s.intro ? s.eyebrow : `Stop ${k} of ${STOPS.length - 1} · ${s.place}`;
  let html = `<p class="eyebrow">${esc(eyebrow)}</p>${head}`;
  if (s.media) html += mediaHTML(s.media);
  if (s.captions) html += lensHTML(s.captions);
  if (s.placeholder) html += `<div class="placeholder"><div>${esc(s.placeholder)}<small>Coming in the final version</small></div></div>`;
  html += `<div class="body">${s.body.map((p) => `<p>${esc(fill(p))}</p>`).join("")}</div>`;
  if (s.readings) html += `<ul class="readings">${s.readings.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  if (s.note) html += `<p class="stop-note">${esc(s.note)}</p>`;
  if (s.intro) {
    html += `<div class="cta-row"><button class="begin" type="button" data-a="play">Play the walk <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/></svg></button>
        <span class="or">or scroll to walk at your own pace</span></div>
      <ul class="key" aria-label="How to read the map">
        <li><i class="k-frame"></i><span>The gold frame is what my photos usually show. It widens at every stop.</span></li>
        <li><i class="k-beam"></i><span>Pillars of light mark the stops. The ring on the ground tightens as you arrive.</span></li>
        <li><i class="k-print"></i><span>Glass panels are my photos and video, floating over where I took them. Click one to open it.</span></li>
        <li><i class="k-route"></i><span>The gold line of light is the produce's route from the Farm up to the Pop-Up.</span></li>
      </ul>
      <dl class="intro-meta"><div><dt>Places</dt><dd>3</dd></div><div><dt>Stops</dt><dd>${STOPS.length - 1}</dd></div><div><dt>Route</dt><dd>${TOKENS.farm_quarry_km} km</dd></div></dl>`;
  }
  sec.innerHTML = html;
  stopsEl.append(sec);
  sections.push(sec);
  carousels.push(s.media ? wireMedia(sec, s.media, k) : null);
});
stopsEl.querySelector('[data-a="play"]')?.addEventListener("click", () => play(true));
stopsEl.addEventListener("click", (e) => {
  const b = e.target.closest(".lens-tabs button");
  if (!b) return;
  const k = +b.closest(".stop").dataset.k;
  if (k !== state.i) return;
  setLens(k, b.dataset.m, true);
});

function scrollToStop(k) {
  k = THREE.MathUtils.clamp(k, 0, STOPS.length - 1);
  const top = sections[k].offsetTop - 8;
  scroller.scrollTo({ top, behavior: REDUCED ? "auto" : "smooth" });
  // the observer will call go(); call it now too so the map never waits on the scroll
  go(k);
}
// whichever section crosses the middle of the story column is the current stop
const stopObserver = new IntersectionObserver((ents) => {
  for (const en of ents) if (en.isIntersecting) go(+en.target.dataset.k);
}, { root: scroller, rootMargin: "-46% 0px -46% 0px", threshold: 0 });
sections.forEach((s) => stopObserver.observe(s));

// ---------------------------------------------------------------- play the walk: hands-free, like a film
const PLAY = { on: false, t0: 0 };
const LENS_FLIP_MS = 5200;
// ?present: for the EcoGroup presentation (3½ min each, hard stop at 4). Bigger type, arrow keys or a clicker step
// through stops like slides, Play is paced to finish in PRESENT_MS, and a small clock keeps time.
const PRESENT = new URLSearchParams(location.search).has("present");
const PRESENT_MS = 200000;
if (PRESENT) document.body.classList.add("present");
function baseDwell(k) {
  const s = STOPS[k];
  if (s.intro) return 5000;
  if (s.route) return 22000;
  const words = s.body.join(" ").length + (s.captions ? s.captions.then.length + s.captions.now.length : 0);
  return Math.min(30000, 9000 + (s.media ? s.media.length * 4200 : 0) + words * 16);
}
let presentScale = 0;
function dwell(k) {
  if (!PRESENT) return baseDwell(k);
  if (!presentScale) {
    let sum = 0;
    for (let j = 1; j < STOPS.length; j++) sum += STOPS[j].talk ? STOPS[j].talk * 1000 : baseDwell(j);
    presentScale = PRESENT_MS / sum;
  }
  if (k === 0) return 4000;
  return (STOPS[k].talk ? STOPS[k].talk * 1000 : baseDwell(k)) * presentScale;
}
function play(on) {
  PLAY.on = on;
  $("#play").setAttribute("aria-pressed", String(on));
  $("#play").setAttribute("aria-label", on ? "Pause the walk" : "Play the walk");
  PLAY.t0 = performance.now();
  if (on && state.i === STOPS.length - 1) scrollToStop(0);
  if (on && state.i === 0) { PLAY.t0 = performance.now() - dwell(0) + 600; }
}
function pause() { if (PLAY.on) play(false); }
$("#play").addEventListener("click", () => play(!PLAY.on));
for (const ev of ["wheel", "touchstart", "keydown"]) scroller.addEventListener(ev, pause, { passive: true });
const progEl = $("#prog");
function stepProgress(now) {
  // whole-walk progress: finished stops plus how far through this one's hold time we are
  const part = PLAY.on ? Math.min(1, (now - PLAY.t0) / dwell(state.i)) : 0;
  progEl.style.transform = `scaleX(${((state.i + part) / (STOPS.length - 1)).toFixed(4)})`;
}
function stepPlay(now) {
  stepProgress(now);
  if (!PLAY.on || state.anim || state.routeAnim) { if (state.anim || state.routeAnim) PLAY.t0 = Math.max(PLAY.t0, now - 4000); return; }
  if (now - PLAY.t0 > dwell(state.i)) {
    if (state.i < STOPS.length - 1) scrollToStop(state.i + 1);
    else play(false);
  }
}

// ---------------------------------------------------------------- where you are: a chip and a small overview map
const MS = 0.068, mw = (E.xmax - E.xmin) * MS, mh = (E.ymax - E.ymin) * MS;
const mx = (x) => ((x - E.xmin) * MS).toFixed(1), my = (y) => ((E.ymax - y) * MS).toFixed(1);
const miniEl = $("#mini");
{
  const ringPath = (pts) => "M" + pts.map(([x, y]) => `${mx(x)},${my(y)}`).join("L") + "Z";
  const linePath = (pts) => "M" + pts.map(([x, y]) => `${mx(x)},${my(y)}`).join("L");
  const siteStop = { farm: 1, chadwick: 4, quarry: 6, selib: 6 };
  const label = { farm: "Farm", chadwick: "Chadwick", quarry: "Pop-Up", selib: "" };
  let svg = `<svg viewBox="0 0 ${mw.toFixed(0)} ${mh.toFixed(0)}" role="img" aria-label="Overview of the walk">
    <rect width="100%" height="100%" rx="6" fill="#1f2a1c"/>`;
  for (const [key, p] of Object.entries(S.places)) svg += `<path d="${ringPath(p.ring)}" fill="${CSSC[key]}" fill-opacity="0.22" stroke="${CSSC[key]}" stroke-width="1"/>`;
  svg += `<path d="${linePath(S.routes.farm_quarry.p)}" fill="none" stroke="#f08a3c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += `<path d="${linePath(S.routes.farm_selib.p)}" fill="none" stroke="#f08a3c" stroke-width="1.2" stroke-dasharray="3 3"/>`;
  for (const [key, [x, y]] of Object.entries(S.sites)) {
    svg += `<g class="m-site" data-k="${siteStop[key]}"><circle cx="${mx(x)}" cy="${my(y)}" r="5.5" fill="#14110d" stroke="${CSSC[key]}" stroke-width="2"/>`;
    if (label[key]) svg += `<text x="${(+mx(x) + 8).toFixed(1)}" y="${(+my(y) + 3).toFixed(1)}">${label[key]}</text>`;
    svg += `</g>`;
  }
  svg += `<g id="miniYou"><path d="M0,0 L-11,-26 A28,28 0 0 1 11,-26 Z" fill="#fff" fill-opacity="0.22"/><circle r="4" fill="#fff" stroke="#14110d" stroke-width="1.5"/></g></svg>`;
  miniEl.innerHTML = svg;
  miniEl.addEventListener("click", (e) => { const g = e.target.closest(".m-site"); if (g) { pause(); scrollToStop(+g.dataset.k); } });
}
const miniYou = $("#miniYou");
function updateMini() {
  const t = controls.target;
  const h = Math.atan2(t.x - camera.position.x, -(t.z - camera.position.z)) * 180 / Math.PI; // 0 = looking north
  miniYou.setAttribute("transform", `translate(${mx(t.x)},${my(-t.z)}) rotate(${h.toFixed(0)})`);
}
function updateNow(s, k) {
  $("#nowK").textContent = s.intro ? "Overview · UC Santa Cruz" : `Stop ${k} of ${STOPS.length - 1} · ${s.place}`;
  $("#nowNote").textContent = s.mapNote || "";
}

// ---------------------------------------------------------------- my photos as framed prints, standing where they were taken
const printTex = (src, isVideo, border = 16) => new Promise((res) => {
  const img = new Image();
  img.onload = () => {
    const s = 768 / Math.max(img.width, img.height), w = Math.round(img.width * s), h = Math.round(img.height * s), b = border;
    const c = document.createElement("canvas");
    c.width = w + b * 2; c.height = h + b * 2;
    const g = c.getContext("2d");
    g.fillStyle = "#fbfaf6"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, b, b, w, h);
    if (isVideo) {
      g.fillStyle = "rgba(0,0,0,0.45)"; g.beginPath(); g.arc(c.width / 2, c.height / 2, 46, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.moveTo(c.width / 2 - 14, c.height / 2 - 22); g.lineTo(c.width / 2 + 24, c.height / 2); g.lineTo(c.width / 2 - 14, c.height / 2 + 22); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = MAX_ANISO;
    res({ t, aspect: c.width / c.height });
  };
  img.onerror = () => res(null);
  img.src = src;
});
// my photos float above each stop as glass panels: full-bleed photo, rounded corners, a thin rim of light,
// a scan line that draws them in, and a light tether down to the spot on the ground
const LOGV_H = `#include <common>
  #include <logdepthbuf_pars_vertex>`;
const HOLO_FRAG = `#include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map; uniform float uAlpha, uHi, uReveal, uTime; uniform vec2 uSize; uniform float uPad; uniform vec3 uTint;
  varying vec2 vUv;
  float rbox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    #include <logdepthbuf_fragment>
    vec2 full = uSize + 2.0 * uPad;
    vec2 p = (vUv - 0.5) * full;                       // metres from the panel centre
    float rad = uSize.y * 0.045;
    float d = rbox(p, uSize * 0.5, rad);
    vec2 puv = p / uSize + 0.5;
    vec3 photo = texture2D(map, clamp(puv, 0.0, 1.0)).rgb;
    float inside = 1.0 - smoothstep(-0.02 * rad, 0.02 * rad + 0.05, d);
    // the scan line draws the panel in from the bottom
    float y01 = puv.y, rv = uReveal * 1.08 - 0.04;
    float shown = 1.0 - smoothstep(rv - 0.01, rv, y01);
    float scan = (1.0 - smoothstep(0.0, 0.025, abs(y01 - rv))) * step(uReveal, 0.999);
    // glass: a soft sheen that slides across now and then, and the faintest lines
    float sheen = smoothstep(0.08, 0.0, abs(fract(uTime * 0.05 + 0.3) * 3.0 - 1.0 - (puv.x * 0.7 + puv.y * 0.3))) * 0.10;
    float lines = 0.985 + 0.015 * sin(puv.y * uSize.y * 9.0);
    float dim = mix(0.82, 1.0, uHi);
    vec3 col = photo * lines * dim + sheen;
    float rimW = uSize.y * mix(0.006, 0.011, uHi);
    float rim = 1.0 - smoothstep(0.0, rimW, abs(d));
    float halo = (1.0 - smoothstep(0.0, uPad, max(d, 0.0))) * step(0.0, d);
    vec3 light = mix(vec3(0.86, 0.95, 1.0), uTint, 0.25);
    col = mix(col, light * 1.15, rim * 0.9);
    float a = inside * shown * mix(0.88, 0.97, uHi) + rim * shown * 0.95 + halo * halo * 0.22 * mix(0.5, 1.0, uHi) * shown + scan * (inside + halo);
    col = mix(col, light * 1.3, scan);
    col = mix(col, light, (1.0 - inside) * (1.0 - rim));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
  }`;
const TETHER_FRAG = `#include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uAlpha, uTime; uniform vec3 uTint; varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5));
    float pulse = smoothstep(0.85, 1.0, fract(vUv.y * 1.5 - uTime * 0.45));
    vec3 light = mix(vec3(0.86, 0.95, 1.0), uTint, 0.25);
    gl_FragColor = vec4(light * 1.2, core * (0.35 + 0.65 * pulse) * (0.4 + 0.6 * vUv.y) * uAlpha);
  }`;
const HOLO_VERT = `${LOGV_H}
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
async function buildPrints(k) {
  const s = STOPS[k];
  if (!s.media || PRINTS[k]) return;
  const P = (PRINTS[k] = { group: new THREE.Group(), cards: [], alpha: 0, t0: 0 });
  scene.add(P.group);
  const v = viewOf(s.view), h = THREE.MathUtils.degToRad(s.view.heading);
  const right = new THREE.Vector3(Math.cos(h), 0, Math.sin(h)), fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
  const cardH = s.view.dist * 0.11, gap = cardH * 0.2, pad = cardH * 0.12;
  const texes = await Promise.all(s.media.map((m) => printTex(m.type === "video" ? m.poster : m.thumb || m.src, m.type === "video", 0)));
  const widths = texes.map((t) => (t ? cardH * t.aspect : 0));
  const live = widths.filter((w) => w > 0).length;
  const total = widths.reduce((a, b) => a + b, 0) + (live - 1) * gap;
  const mid = v.target.clone().addScaledVector(fwd, s.view.dist * 0.15);
  const tint = new THREE.Color(CSSC[s.view.at] || "#e8c690");
  let off = -total / 2, n = 0;
  s.media.forEach((m, j) => {
    const tx = texes[j];
    if (!tx) return;
    const w = widths[j];
    const along = off + w / 2;
    off += w + gap;
    // the panels stand on a gentle arc that curves toward you at the ends
    const c = mid.clone().addScaledVector(right, along).addScaledVector(fwd, -Math.pow(along / Math.max(total, 1), 2) * total * 0.35);
    const ground = topAt(c.x, -c.z);
    const lift = cardH * 0.62;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { map: { value: tx.t }, uAlpha: { value: 0 }, uHi: { value: 0 }, uReveal: { value: 0 }, uTime: U.uTime,
        uSize: { value: new THREE.Vector2(w, cardH) }, uPad: { value: pad }, uTint: { value: tint } },
      vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG,
    });
    const pivot = new THREE.Group();
    pivot.position.set(c.x, ground + lift + cardH / 2, c.z);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w + pad * 2, cardH + pad * 2), mat);
    card.userData = { k, j, media: m };
    card.renderOrder = 9;
    pivot.add(card);
    const tMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      uniforms: { uAlpha: { value: 0 }, uTime: U.uTime, uTint: { value: tint } }, vertexShader: HOLO_VERT, fragmentShader: TETHER_FRAG });
    const tether = new THREE.Mesh(new THREE.PlaneGeometry(cardH * 0.03, lift).translate(0, lift / 2, 0), tMat);
    tether.position.set(c.x, ground, c.z);
    tether.renderOrder = 8;
    P.group.add(pivot, tether);
    P.cards.push({ pivot, card, mat, tether, tMat, j, n: n++, phase: j * 1.9 + k, hi: 0, baseY: pivot.position.y, cardH });
  });
}
function highlightPrint(k, j) {
  const P = PRINTS[k];
  if (!P) return;
  for (const c of P.cards) c.target = c.j === j ? 1 : 0;
}
function stepPrints(dt) {
  const t = performance.now() / 1000;
  for (const [k, P] of Object.entries(PRINTS)) {
    // down among the plants the panels step away (they're sized for the stop's view, and would tower over the rows)
    const want = +k === state.i && !state.layers.beyond && camera.position.distanceTo(controls.target) > 140 ? 1 : 0;
    if (want && P.alpha < 0.02) P.t0 = t;
    P.alpha += (want - P.alpha) * (1 - Math.exp(-dt * 3));
    P.group.visible = P.alpha > 0.01;
    if (!P.group.visible) continue;
    for (const c of P.cards) {
      c.hi += ((c.target || 0) - c.hi) * (1 - Math.exp(-dt * 4));
      const rv = REDUCED ? 1 : THREE.MathUtils.clamp((t - P.t0 - 0.35 - c.n * 0.22) / 0.9, 0, 1);
      c.mat.uniforms.uReveal.value = 1 - Math.pow(1 - rv, 3);
      c.mat.uniforms.uAlpha.value = P.alpha;
      c.mat.uniforms.uHi.value = c.hi;
      c.tMat.uniforms.uAlpha.value = P.alpha * Math.min(1, rv * 2);
      // each panel turns to face you as you move, hovers a little, and the one you're reading steps forward
      const dx = camera.position.x - c.pivot.position.x, dz = camera.position.z - c.pivot.position.z;
      c.pivot.rotation.y = Math.atan2(dx, dz);
      c.pivot.position.y = c.baseY + (REDUCED ? 0 : Math.sin(t * 0.8 + c.phase) * c.cardH * 0.025) + c.hi * c.cardH * 0.08;
      c.pivot.scale.setScalar(1 + 0.1 * c.hi);
    }
  }
}
// click a print to open it
{
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  canvas.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const P = PRINTS[state.i];
    if (!P || !P.group.visible) return;
    const hit = ray.intersectObjects(P.cards.map((c) => c.card), false)[0];
    if (!hit) return;
    const { media, j } = hit.object.userData;
    if (media.type === "video") carousels[state.i]?.show(j);
    else openPhoto(media.src, media.caption);
  });
}

function go(k) {
  k = THREE.MathUtils.clamp(k, 0, STOPS.length - 1);
  if (k === state.i) return;
  state.i = k;
  state.seen.add(k);
  state.user = false;
  state.drift = null;
  PLAY.t0 = performance.now();
  const s = STOPS[k];
  state.layers = { frame: false, campus: false, route: false, beyond: false, ...s.layers };
  syncLayers();
  sections.forEach((sec, j) => sec.classList.toggle("is-active", j === k));
  carousels.forEach((c, j) => c && c.setOn(j === k));
  buildPrints(k).then(() => carousels[k] && carousels[k].setOn(true));
  updateNow(s, k);
  $("#prev").disabled = k === 0;
  closerBtn.hidden = !(s.view && ((cropBytes && s.view.at === "farm") || s.view.at === "quarry"));
  closerBtn.querySelector("span").textContent = s.view && s.view.at === "quarry" ? "Down to the tents" : "Into the rows";
  $("#nextLabel").textContent = k === 0 ? "Begin" : k === STOPS.length - 1 ? "Start over" : "Next";
  dotsEl.querySelectorAll("button").forEach((b, j) => {
    b.toggleAttribute("aria-current", false);
    if (j === k) b.setAttribute("aria-current", "step");
    b.classList.toggle("seen", state.seen.has(j) && j !== k);
  });
  history.replaceState(null, "", "#" + s.id);
  if (s.frame) {
    const [x, y] = siteXY(s.view.at);
    goals.focus.set(x, -y, s.frame);
    goals.rot = -THREE.MathUtils.degToRad(s.view.heading);
    goals.focusAmt = 1;
  } else goals.focusAmt = 0;
  LENS.touched = false;
  setLens(k, "then", false);
  for (const [key, p] of Object.entries(pinEls)) {
    p.el.classList.toggle("on", s.view.at === key || (s.id === "popup" && key === "selib"));
  }
  if (s.route) runRoute(() => flyTo(viewOf(s.view), 2400));
  else flyTo(viewOf(s.view), k === 0 ? 3200 : 2600);
}

// ---------------------------------------------------------------- about
$("#aboutBtn").addEventListener("click", () => {
  $("#aboutBody").innerHTML = `
    <p>A 3D walk through three places at UC Santa Cruz: the UCSC Farm, the Alan Chadwick Garden and the Produce Pop-Up. It's my final project for ENVS 143, Futures of Sustainable Development, with Juli Hazlewood, Fall 2026: a record of how my readings changed the way I frame the Farm in my own photos and video.</p>
    <h3>How to use it</h3>
    <ul><li>Scroll the story, or press Play the walk, and the map flies from place to place. Next and the dots work too.</li>
    <li>Glass panels in the map are my photos and video, floating over where I took them. Click one to open it.</li>
    <li>On the Farm stops, Into the rows flies down to the beds. Each plant stands where its green shows in the 2025 aerial photo. Which crop grows in which row is my assumption, read from colour and form and from what the Farm is known to grow (kale, carrots, dry-farmed tomatoes, lettuce, squash, strawberries, cut flowers, cabbage, cover crop), not the Farm's planting plan.</li>
    <li>Drag to look around, scroll or pinch to zoom, right-drag or two-finger drag to move.</li>
    <li>Turn layers on and off at the top right of the map. The Return button brings back the stop's view.</li></ul>
    <h3>Draft 1 · November 24, 2026 · EcoGroup 6, Santa Cruz as Living Classroom</h3>
    <p>Done: the 3D site with real terrain, tree heights and 2025 aerial imagery, the Farm’s crops and buildings, seven stops, the food route, and my photos and video for the Farm, the dry farm, the Chadwick Garden and the Pop-Up.</p>
    <p>Still to come: my two interviews (one on the topic, one on the medium) with my questions, results and analysis in the written companion, and a final pass on every word in my own voice.</p>
    <h3>Map data</h3>
    <ul>${S.credits.map((c) => `<li>${esc(c)}</li>`).join("")}<li>Each 3D tree stands where a crown shows in the 2025 photo, at the height the canopy map gives it. Its shape is a model, not a scan of that tree.</li><li>Grass and leaves are shown in their green season. The 2025 aerial photo was flown in dry summer, when the meadows are gold.</li><li>Heights are true to scale. Tree heights come from a satellite and lidar model, so single trees can be off by a few metres.</li></ul>
    <h3>References</h3>
    <ul class="refs">${REFERENCES.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <h3>AI use</h3>
    <p>I used Claude, an AI assistant made by Anthropic (2026), to help build this site's code and map data and to draft first versions of the stop text from my proposal and midterm. The photos and video are mine. I chose the places, the readings and the structure, and I'm reviewing and rewriting the text in my own words.</p>`;
  overlayOpener = $("#aboutBtn");
  $("#about").hidden = false;
  $("#aboutClose").focus();
});
$("#aboutClose").addEventListener("click", () => closeOverlay("#about"));
$("#about").addEventListener("click", (e) => { if (e.target.id === "about") closeOverlay("#about"); });
$("#lbClose").addEventListener("click", () => closeOverlay("#lightbox"));
$("#lightbox").addEventListener("click", (e) => { if (e.target.closest(".lb-img") && e.target.tagName !== "IMG") closeOverlay("#lightbox"); });
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeOverlay("#lightbox"); closeOverlay("#about"); return; }
  if (!$("#lightbox").hidden || !$("#about").hidden) return;
  if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); pause(); scrollToStop(state.i + 1); startClock(); }
  if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); pause(); scrollToStop(state.i - 1); }
  if ((e.key === "s" || e.key === "S") && STOPS[state.i].captions) {
    const m = sections[state.i].querySelector(".lens").dataset.mode;
    setLens(state.i, m === "then" ? "now" : "then", true);
  }
  if (e.key === "p" || e.key === "P") { play(!PLAY.on); startClock(); }
  if ((e.key === "t" || e.key === "T") && PRESENT) $("#clock").hidden = !$("#clock").hidden;
  if (e.key === " " && e.target === document.body) { e.preventDefault(); play(!PLAY.on); }
});

// user takes the camera: stop any flight
controls.addEventListener("start", () => {
  pause();
  state.anim = null;
  state.routeAnim = null;
  state.user = true;
  $("#hint").classList.add("gone");
});

// ---------------------------------------------------------------- frame loop
const goals = { focus: new THREE.Vector3(0, 0, 4000), focusAmt: 0, rot: 0 };
const cur = { buildingTint: 0, frame: 0, route: 0, beyond: 0, crate: 0 };
const bHot = new THREE.Color(0xf0a060);
let frameNo = 0, shadowHalf = 0;
const fogBase = FOG.clone(), fogWarm = new THREE.Color(0xc9b49a);
function approach(key, goal, dt, rate = 3) { cur[key] += (goal - cur[key]) * (1 - Math.exp(-dt * rate)); return cur[key]; }

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const m of fatMats) m.resolution.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  for (const { m } of FR.lines) m.resolution.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
}
new ResizeObserver(resize).observe(stage);
resize();

let last = performance.now();
const proj = new THREE.Vector3();
let lastInput = 0;
for (const ev of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"]) addEventListener(ev, (e) => { if (ev !== "pointermove" || e.buttons) lastInput = performance.now(); }, { passive: true });
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  U.uTime.value = now / 1000;
  stepAnim(now);
  stepRoute(now);
  stepPlay(now);
  stepPrints(dt);
  stepFades();
  updateCrops(dt);
  for (const c of carousels) c && c.tick(now);
  { const ls = STOPS[state.i]; if (ls && ls.captions && !LENS.touched && now - PLAY.t0 > LENS_FLIP_MS && sections[state.i].querySelector(".lens").dataset.mode === "then") setLens(state.i, "now", false); }
  if (!state.anim && !state.routeAnim) {
    // a slow, filmed drift while you read: a few degrees around the place and a gentle push in
    if (!state.user && !REDUCED) {
      if (!state.drift) state.drift = { base: currentView(), t0: now };
      const D = state.drift, t = (now - D.t0) / 1000, ease = Math.min(1, t / 3);
      if (state.i === 0) place({ ...D.base, heading: D.base.heading + t * 2.2 });
      else place({ ...D.base, heading: D.base.heading + ease * 7 * Math.sin(t * 0.09), dist: D.base.dist * (1 - ease * 0.035 * (1 - Math.cos(t * 0.11))) });
    }
    controls.update();
  } else state.drift = null;
  // clamp the camera target to the model
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, C.xmin + 300, C.xmax - 300);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -(C.ymax - 300), -(C.ymin + 300));

  const L = state.layers;
  // frame
  U.uFocus.value.x += (goals.focus.x - U.uFocus.value.x) * (1 - Math.exp(-dt * 2.5));
  U.uFocus.value.y += (goals.focus.y - U.uFocus.value.y) * (1 - Math.exp(-dt * 2.5));
  U.uFocus.value.z += (goals.focus.z - U.uFocus.value.z) * (1 - Math.exp(-dt * 1.6));
  { const dr = Math.atan2(Math.sin(goals.rot - U.uFrameRot.value), Math.cos(goals.rot - U.uFrameRot.value)); U.uFrameRot.value += dr * (1 - Math.exp(-dt * 2)); }
  // down among the plants the frame lets go: up close it's just the Farm, in its own light
  const closeK = THREE.MathUtils.smoothstep(camera.position.distanceTo(controls.target), 90, 240);
  U.uFocusAmt.value += (goals.focusAmt * (L.beyond ? 0 : 1) * closeK - U.uFocusAmt.value) * (1 - Math.exp(-dt * 2));
  U.uBeyond.value = approach("beyond", L.beyond ? 1 : 0, dt, 1.4);
  const fr = approach("frame", L.frame ? 1 : 0, dt);
  updateFrameLines(0); // the frame is now light cast on the land, trees and roofs (see FRAME_GLSL)
  {
    const s = STOPS[state.i] || {};
    const t = now / 1000;
    for (const b of BEACON) {
      const active = s.view && (s.view.at === b.key || (s.id === "popup" && b.key === "selib"));
      b.on += ((active ? 1 : 0.5) - b.on) * (1 - Math.exp(-dt * 2.5));
      const vis = fr * (1 - cur.beyond);
      // shafts are for finding places from afar; they thin out as you arrive, while the iris opens
      const near = THREE.MathUtils.smoothstep(camera.position.distanceTo(b.beam.position), 200, 900);
      // once you're at a stop and the prints are up, the iris marks the spot and the shaft steps back
      const pr = active && PRINTS[state.i] ? PRINTS[state.i].alpha : 0;
      b.shaftMat.uniforms.uAlpha.value = vis * b.on * (0.25 + 0.75 * near) * (1 - 0.85 * pr);
      // the ground ring is for finding the stop from above; down among the beds it gets out of the way
      b.irisMat.uniforms.uAlpha.value = vis * b.on * THREE.MathUtils.smoothstep(camera.position.distanceTo(b.iris.position), 90, 260);
      b.irisMat.uniforms.uOpen.value += ((active ? 0.82 : 0.32) - b.irisMat.uniforms.uOpen.value) * (1 - Math.exp(-dt * 0.8));
      b.iris.scale.setScalar(THREE.MathUtils.clamp(camera.position.distanceTo(b.iris.position) * 0.05, 35, 140));
    }
  }
  // outlines and the route are map devices: down at ground level they would cut through the scene
  const groundK = THREE.MathUtils.smoothstep(camera.position.distanceTo(controls.target), 60, 200);
  for (const o of Object.values(outlines)) setLineOpacity(o, fr * 0.95 * groundK);
  for (const c of caseLines) setLineOpacity(c, fr * 0.45 * groundK);
  let rt = approach("route", L.route ? 1 : 0, dt);
  // the route is a map device: down at street level it would cut through the scene
  rt *= groundK;
  setLineOpacity(routeCase, rt * 0.55);
  setLineOpacity(routeBase, rt);
  setLineOpacity(routeDash, rt * 0.9);
  setLineOpacity(routeFriCase, rt * 0.35);
  setLineOpacity(routeFri, rt * 0.8);
  if (!REDUCED) { routeDash.material.dashOffset -= dt * 70; routeFri.material.dashOffset -= dt * 18; }
  crate.material.opacity = approach("crate", state.routeAnim ? 1 : 0, dt, 5);
  const bt = approach("buildingTint", L.campus ? 1 : 0, dt);
  for (const m of buildingMats) m.emissive.copy(bHot).multiplyScalar(bt * 0.16);
  scene.fog.color.copy(fogBase).lerp(fogWarm, cur.beyond);

  // keep the camera above the trees and roofs
  const floorY = topAt(camera.position.x, -camera.position.z) + 6;
  if (camera.position.y < floorY) camera.position.y = floorY;
  // sun shadows follow the view
  if (!PHONE) {
    const dist = camera.position.distanceTo(controls.target);
    const half = THREE.MathUtils.clamp(dist * 0.75, 140, 1700);
    if (Math.abs(half - shadowHalf) > shadowHalf * 0.08) {
      shadowHalf = half;
      const sc = sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
      sun.shadow.normalBias = (half / 4096) * 3;
    }
    sun.target.position.copy(controls.target);
    sun.position.copy(controls.target).addScaledVector(sunDir, 5000);
  }
  if (frameNo++ % 6 === 0) { updateLOD(); updateMini(); updateGrass(); }

  // when nothing is moving (you're reading), draw every other frame: half the work, and the wind still moves
  // (the slow drift at each stop counts as still; flights, Play and your own dragging count as moving)
  const moving = state.anim || state.routeAnim || PLAY.on || now - lastInput < 2500;
  // shadows follow the view's centre: recompute when that moves a few metres or the zoom changes, and now and then for the wind
  const shKey = Math.round(controls.target.x / 3) + "," + Math.round(controls.target.z / 3) + "," + Math.round(Math.log2(camera.position.distanceTo(controls.target)) * 4);
  if (shKey !== frame.shKey || frameNo % 45 === 0) renderer.shadowMap.needsUpdate = !PHONE;
  frame.shKey = shKey;
  if (!moving && frameNo % 2) { requestAnimationFrame(frame); return; }
  // adaptive resolution: average frame time over ~1.5 s, then nudge the pixel ratio
  QUALITY.acc += dt; QUALITY.n++;
  if (now - QUALITY.t > 1500 && QUALITY.n > 20) {
    const ms = (QUALITY.acc / QUALITY.n) * 1000;
    let pr = QUALITY.pr;
    if (moving && ms > 26 && pr > 0.75) pr = Math.max(0.75, pr - 0.15);
    else if (ms < 15 && pr < QUALITY.max) pr = Math.min(QUALITY.max, pr + 0.1);
    if (pr !== QUALITY.pr) { QUALITY.pr = pr; renderer.setPixelRatio(pr); }
    QUALITY.acc = 0; QUALITY.n = 0; QUALITY.t = now;
  }

  renderer.render(scene, camera);

  // pins
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const [key, p] of Object.entries(pinEls)) {
    proj.copy(p.pos).project(camera);
    const behind = proj.z > 1 || proj.x < -1.1 || proj.x > 1.1 || proj.y < -1.1 || proj.y > 1.1;
    // map labels step aside while my photo prints are up: text never sits on a photo
    const printsUp = PRINTS[state.i] && PRINTS[state.i].alpha > 0.15;
    const show = !behind && L.frame && !L.beyond && !printsUp;
    p.el.classList.toggle("hidden", !show);
    const px = ((proj.x + 1) / 2) * w - 9, py = ((1 - proj.y) / 2) * h - 9;
    if (!behind) p.el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    p.box = show ? [px, py, px + (p.lw ||= p.el.offsetWidth || 120), py + 22] : null;
  }
  // labels never pile up or run off the map: a label that would overlap another, or the edge, shows only its dot
  {
    const shown = [];
    for (const p of Object.values(pinEls)) {
      if (!p.box) { p.el.classList.remove("dot"); continue; }
      const [a, b, c, d] = p.box;
      const clash = c > w - 8 || shown.some(([e, f, g, hh]) => a < g + 6 && c + 6 > e && b < hh && d > f);
      p.el.classList.toggle("dot", clash && !p.el.classList.contains("on"));
      if (!clash || p.el.classList.contains("on")) shown.push(p.box);
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- presenter clock (starts on the first step past the title)
const CLOCK = { t0: 0, el: null };
function startClock() {
  if (!PRESENT || CLOCK.t0) return;
  CLOCK.t0 = performance.now();
  const tick = () => {
    const sec = Math.floor((performance.now() - CLOCK.t0) / 1000);
    CLOCK.el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    CLOCK.el.dataset.warn = sec >= 225 ? "stop" : sec >= 195 ? "wrap" : "";
    setTimeout(tick, 250);
  };
  tick();
}
if (PRESENT) {
  CLOCK.el = document.createElement("p");
  CLOCK.el.id = "clock";
  CLOCK.el.className = "clock";
  CLOCK.el.textContent = "0:00";
  CLOCK.el.title = "Presenter clock: T hides it";
  $("#aboutBtn").after(CLOCK.el); // in the story header, never over the map or a photo
  $("#next").addEventListener("click", startClock);
  $("#play").addEventListener("click", startClock);
  stopsEl.querySelector('[data-a="play"]')?.addEventListener("click", startClock);
  let idleT = 0;
  addEventListener("pointermove", () => { document.body.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.add("idle"), 2500); });
  // warm the cache so no photo or clip has to load in front of the class
  addEventListener("load", () => setTimeout(() => {
    for (const s of STOPS) for (const m of s.media || []) [m.thumb, m.poster, m.type === "video" ? m.src : null].filter(Boolean).forEach((u) => fetch(u).catch(() => {}));
  }, 4000));
}

// ---------------------------------------------------------------- start
const startId = location.hash.slice(1);
const startIdx = Math.max(0, STOPS.findIndex((s) => s.id === startId));
place(viewOf({ ...STOPS[0].view, dist: STOPS[0].view.dist * 1.25, pitch: 62 }));
go(startIdx);
if (startIdx > 0) requestAnimationFrame(() => (scroller.scrollTop = sections[startIdx].offsetTop - 8));
U.uFocus.value.set(goals.focus.x, goals.focus.y, goals.focus.z);
U.uFrameRot.value = goals.rot;
requestAnimationFrame((t) => { last = t; frame(t); });
setTimeout(() => $("#loading").classList.add("done"), 250);
// the city around campus fills in once the walk is already on screen
setTimeout(() => loadCity().catch((e) => console.warn("city", e)), 1200);
window.__wtf = { state, camera, controls, go, STOPS, routeBase, routeDash, outlines, cur, U, tiles, LOD, renderer, scene, sun, sunDir, topAt, place, currentView };

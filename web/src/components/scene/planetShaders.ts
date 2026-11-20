export const MAX_STARS = 4;

const NOISE = /* glsl */ `
float pHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float pNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(pHash(i), pHash(i + vec3(1, 0, 0)), f.x),
                 mix(pHash(i + vec3(0, 1, 0)), pHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(pHash(i + vec3(0, 0, 1)), pHash(i + vec3(1, 0, 1)), f.x),
                 mix(pHash(i + vec3(0, 1, 1)), pHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float pFbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * pNoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

/** blackbody-ish ramp: dark red -> orange -> yellow -> white; values above 1 feed the bloom */
const FIRE = /* glsl */ `
vec3 fire(float t) {
  t = clamp(t, 0.0, 1.2);
  return vec3(2.6, 0.45, 0.08) * smoothstep(0.0, 0.35, t)
       + vec3(0.6, 1.1, 0.2) * smoothstep(0.3, 0.7, t)
       + vec3(0.4, 0.9, 1.6) * smoothstep(0.65, 1.1, t);
}
`;

export const PLANET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vObjN = normal;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPosW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/**
 * uKind 0 = Earth (NASA textures), 1 = rocky (procedural), 2 = gas giant (bands).
 * uTemp is the COMPUTED equilibrium temperature in kelvin; the surface response to it is illustrated.
 */
export const PLANET_FRAG = /* glsl */ `
#define MAX_STARS ${MAX_STARS}
uniform int uKind;
uniform vec3 uColor;
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uData; // r = height, g = land mask, b = clouds
uniform vec3 uStarDir[MAX_STARS];
uniform vec3 uStarCol[MAX_STARS];
uniform float uStarFlux[MAX_STARS];
uniform int uStarCount;
uniform float uTemp;
uniform float uTime;
uniform vec3 uCam;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vPosW;
${NOISE}
${FIRE}

void main() {
  vec3 N = normalize(vN);
  vec3 o = normalize(vObjN);
  vec3 V = normalize(uCam - vPosW);
  float T = uTemp;
  float water = 1.0 - smoothstep(373.0, 650.0, T);  // oceans boil away above 373 K
  float frost = smoothstep(250.0, 180.0, T);        // freezes over when cold
  float molten = smoothstep(798.0, 2500.0, T);      // 798 K Draper point: rock glows visibly

  vec3 albedo;
  float land = 1.0;
  float cloud = 0.0;
  vec3 night = vec3(0.0);
  if (uKind == 0) {
    albedo = texture2D(uDay, vUv).rgb;
    land = texture2D(uData, vUv).g;
    cloud = smoothstep(0.2, 0.85, texture2D(uData, vec2(vUv.x + uTime * 0.002, vUv.y)).b);
    night = texture2D(uNight, vUv).rgb;
    albedo = mix(mix(vec3(0.35, 0.3, 0.26), albedo, water), albedo, land); // dry seabed once boiled
    albedo = mix(albedo, vec3(0.85, 0.9, 0.95), frost * (1.0 - 0.6 * land));
  } else if (uKind == 1) {
    float f = pFbm(o * 3.0 + 1.7);
    float c = pFbm(o * 12.0);
    albedo = uColor * (0.55 + 0.7 * f) * (0.85 + 0.3 * c);
    albedo = mix(albedo, vec3(0.85, 0.9, 0.95), frost * 0.5);
  } else if (uKind == 3) {
    albedo = texture2D(uDay, vUv).rgb; // real imagery (NASA-based maps)
    albedo = mix(albedo, vec3(0.85, 0.9, 0.95), frost * 0.3);
    water = 0.0;
  } else {
    float warp = pFbm(o * vec3(2.0, 6.0, 2.0) + uTime * 0.01);
    float bands = 0.5 + 0.5 * sin(o.y * 14.0 + warp * 4.0);
    albedo = mix(uColor * 0.55, mix(uColor, vec3(1.0), 0.35), bands);
    water = 0.0;
  }
  cloud *= water;
  albedo = mix(albedo, vec3(0.05, 0.04, 0.035), molten * 0.85);

  vec3 light = vec3(0.0);
  float spec = 0.0;
  float lit = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uStarCount) break;
    float b = uStarFlux[i] / (uStarFlux[i] + 0.3); // display compression of real flux
    float nl = dot(N, uStarDir[i]);
    light += uStarCol[i] * max(nl, 0.0) * b * 1.3;
    lit = max(lit, smoothstep(-0.05, 0.2, nl) * b);
    vec3 H = normalize(uStarDir[i] + V);
    spec += pow(max(dot(N, H), 0.0), 70.0) * b * step(0.0, nl);
  }

  vec3 col = albedo * (light + 0.01);
  col = mix(col, vec3(0.92) * (light + 0.01), cloud * 0.85);
  if (uKind == 0) {
    col += vec3(1.0, 0.95, 0.85) * spec * (1.0 - land) * water * (1.0 - cloud) * 0.6;
    col += night * vec3(1.0, 0.85, 0.6) * (1.0 - smoothstep(0.0, 0.25, lit)) * 1.3 * water * (1.0 - cloud * 0.8);
  }

  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float rimLight = clamp(dot(light, vec3(0.333)), 0.0, 1.0) + 0.03;
  vec3 atmo = uKind == 0 ? mix(vec3(1.0, 0.45, 0.15), vec3(0.3, 0.55, 1.0), water)
            : (uKind == 2 ? uColor * 0.7 : vec3(0.0));
  col += atmo * rim * rimLight * 0.9;

  if (molten > 0.001) {
    float veins = pow(1.0 - abs(2.0 * pFbm(o * 6.0 + 3.1) - 1.0), 5.0);
    float mottle = pFbm(o * 9.0 + uTime * 0.05);
    col += fire(molten * (0.5 + 0.5 * mottle) + veins * 0.35 * molten) * molten * (0.4 + 1.2 * veins);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

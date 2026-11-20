const NOISE = /* glsl */ `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int k = 0; k < 5; k++) { s += a * noise(p); p *= 2.02; a *= 0.5; }
  return s;
}
`;

export const STAR_VERT = /* glsl */ `
varying vec3 vPosO;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vPosO = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec3 vPosO;
varying vec3 vNormalV;
varying vec3 vViewDir;
${NOISE}
void main() {
  float mu = clamp(dot(normalize(vNormalV), normalize(vViewDir)), 0.0, 1.0);
  float limb = 0.3 + 0.7 * pow(mu, 0.5);                       // limb darkening
  float gran = fbm(vPosO * 7.0 + vec3(0.0, uTime * 0.12, uTime * 0.07));   // granulation
  float spots = smoothstep(0.66, 0.78, fbm(vPosO * 2.2 + vec3(uTime * 0.02)));
  vec3 col = uColor * (0.7 + 0.7 * gran) * limb * (1.0 - 0.55 * spots);
  col += uColor * pow(1.0 - mu, 3.0) * 0.8;                    // hot rim
  gl_FragColor = vec4(col * 2.4, 1.0);                         // above 1 so bloom picks it up
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float band = exp(-pow(dot(d, normalize(vec3(0.35, 1.0, 0.25))) * 3.2, 2.0));   // galactic plane
  float n = fbm(d * 3.0);
  float n2 = fbm(d * 7.0 + 4.0);
  vec3 deep = vec3(0.008, 0.01, 0.025);
  vec3 neb = mix(vec3(0.10, 0.05, 0.18), vec3(0.03, 0.09, 0.16), n2);
  vec3 col = deep + neb * smoothstep(0.35, 0.85, n) * (0.25 + band);
  col += vec3(0.09, 0.08, 0.07) * band * smoothstep(0.45, 0.9, n2) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const TRAIL_VERT = /* glsl */ `
attribute float aIndex;
uniform float uHead;
uniform float uLen;
varying float vA;
void main() {
  vA = clamp(1.0 - (uHead - aIndex) / uLen, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA * vA * uOpacity * 0.85);
}
`;

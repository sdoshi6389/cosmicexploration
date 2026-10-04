import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

const fragment = /* glsl */ `
uniform float strength;
uniform float flash;
uniform float direction;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = uv - 0.5;
  float d = length(dir);
  vec3 acc = vec3(0.0);
  const int N = 20;
  float s = strength * (0.22 + 0.5 * d);
  for (int i = 0; i < N; i++) {
    float t = float(i) / float(N - 1);
    float k = 1.0 - s * t * direction;
    vec2 p = 0.5 + dir * k;
    float ca = strength * 0.018 * t;
    acc.r += texture2D(inputBuffer, 0.5 + dir * (k - ca)).r;
    acc.g += texture2D(inputBuffer, p).g;
    acc.b += texture2D(inputBuffer, 0.5 + dir * (k + ca)).b;
  }
  vec3 blurred = acc / float(N);
  vec3 col = mix(inputColor.rgb, blurred, clamp(strength * 1.4, 0.0, 1.0));
  // Streak highlight toward the edges, then a cool flash at the scale jump.
  col += strength * 0.18 * smoothstep(0.15, 0.75, d) * vec3(0.55, 0.85, 1.0);
  col = mix(col, vec3(0.86, 0.95, 1.0), flash * (1.0 - 0.6 * d));
  outputColor = vec4(col, inputColor.a);
}
`;

/** Radial "powers of ten" zoom blur with chromatic split and a jump flash. */
export class WarpEffect extends Effect {
  constructor() {
    super('WarpEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>([
        ['strength', new Uniform(0)],
        ['flash', new Uniform(0)],
        ['direction', new Uniform(1)],
      ]),
    });
  }

  set strength(v: number) {
    this.uniforms.get('strength')!.value = v;
  }
  set flash(v: number) {
    this.uniforms.get('flash')!.value = v;
  }
  /** +1 zooms inward (streaks converge), −1 outward. */
  set direction(v: number) {
    this.uniforms.get('direction')!.value = v;
  }
}

export const warpEffect = new WarpEffect();

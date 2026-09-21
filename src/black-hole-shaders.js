/** All positions below are in the fixed hole frame, in horizon-radius units. */
export const fullscreenVertex = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Eight bounded taps resolve an elongated ray footprint without applying its
// largest mip to both axes. Only actual source radiance supplies these samples.
export const diskFilter = /* glsl */ `
  vec3 sampleDiskRadiance(sampler2D image, vec2 uv, vec2 dx, vec2 dy) {
    vec2 size = vec2(textureSize(image, 0));
    vec2 x = dx * size, y = dy * size;
    vec2 major = dot(x, x) > dot(y, y) ? x : y;
    float width = max(length(major), 1.0);
    // Discontinuous / unresolved critical rays cannot define a directional
    // footprint. Widely spaced taps would paint separated ghost crescents.
    if (width > 32.0) return textureLod(image, uv, 4.5).rgb;
    float minor = abs(x.x * y.y - x.y * y.x) / width;
    float lod = clamp(log2(max(max(minor, width * 0.125), 1.0)), 0.5, 4.5);
    vec2 stepUv = major / size * 0.125;
    return 0.125 * (
      textureLod(image, uv - stepUv * 3.5, lod).rgb +
      textureLod(image, uv - stepUv * 2.5, lod).rgb +
      textureLod(image, uv - stepUv * 1.5, lod).rgb +
      textureLod(image, uv - stepUv * 0.5, lod).rgb +
      textureLod(image, uv + stepUv * 0.5, lod).rgb +
      textureLod(image, uv + stepUv * 1.5, lod).rgb +
      textureLod(image, uv + stepUv * 2.5, lod).rgb +
      textureLod(image, uv + stepUv * 3.5, lod).rgb);
  }
`;

export const rayFragment = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 outColor;
  uniform mat4 uInverseProjection;
  uniform mat4 uCameraToHole;
  uniform mat4 uHoleToWorld;
  uniform float uTime;
  uniform float uStepScale;
  uniform float uWorldScale;
  uniform float uLensing;
  uniform float uStars;
  uniform float uDust;
  uniform sampler2D uDiskImage;
  uniform float uDiskExtent;
  uniform float uDiskEnabled;

  const float DOMAIN = 36.0;
  const float INNER = 3.05;
  const float OUTER = 10.8;
  const float THICKNESS = 0.115;
  const float NO_HIT = 60000.0;

  ${diskFilter}

  // Nine taps per retained crossing, only AFTER integration. The signed mean
  // height has the same broad support as the bounded shallow-depth correction.
  vec3 noteImage(vec2 uv, vec2 slope, vec2 dx, vec2 dy) {
    vec2 size = vec2(textureSize(uDiskImage, 0));
    float heightLod = log2(max(size.x, size.y) * 0.25);
    vec4 source = textureLod(uDiskImage, uv, heightLod);
    float height = clamp(source.a / max(dot(source.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.00000001), -0.65, 0.65);
    vec2 liftedUv = uv + clamp(slope * height / (2.0 * uDiskExtent), vec2(-0.08), vec2(0.08));
    return sampleDiskRadiance(uDiskImage, liftedUv, dx, dy);
  }

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
      mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float n = 0.5 * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 12.8;
    n += 0.25 * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 5.2;
    return n + 0.125 * noise(p);
  }

  // A cube-mapped procedural sky, sampled using the ESCAPING bent ray.
  // No screen-space star texture: flying around changes the patch of sky.
  vec3 sky(vec3 direction) {
    vec3 d = normalize(direction), a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
    else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
    uv = uv * 0.5 + 0.5;
    vec3 stars = vec3(0);
    for (int layer = 0; layer < 2; layer++) {
      float grid = layer == 0 ? 140.0 : 310.0;
      vec2 q = uv * grid;
      vec2 id = floor(q) + vec2(face * 413.7, float(layer) * 137.2);
      float seed = hash21(id);
      vec2 center = vec2(hash21(id + 7.1), hash21(id + 19.8)) * 0.7 + 0.15;
      float pixel = clamp(max(length(dFdx(q)), length(dFdy(q))), 0.035, 1.2);
      float size = layer == 0 ? 0.052 : 0.038;
      float width = max(size, pixel * 0.55);
      float energy = size * size / (width * width);
      float point = exp(-dot(fract(q) - center, fract(q) - center) / (width * width));
      float selected = step(layer == 0 ? 0.963 : 0.988, seed);
      float magnitude = 0.7 + 4.0 * pow(hash21(id + 83.3), 9.0);
      vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.87, 0.65), hash21(id + 61.4));
      stars += selected * tint * point * energy * magnitude * 3.6;
    }
    float band = exp(-pow(dot(d, normalize(vec3(0.34, 0.91, -0.23))) * 8.0, 2.0));
    float clouds = fbm(d.xz * 5.0 + d.y * 7.0);
    return vec3(0.0007, 0.0010, 0.0018) + uStars * (stars + vec3(0.003, 0.004, 0.006) * band * clouds);
  }

  // Differential rotation stretches domain-warped eddies into broken wisps.
  // Sine/cosine only rotate coordinates: density has NO periodic radial bands.
  vec4 disk(vec3 p, vec3 toObserver) {
    float r = length(p.xz);
    float angle = atan(p.z, p.x) - 2.4 * log(r) - uTime * 0.85 / (r * sqrt(r));
    vec2 flow = vec2(cos(angle), sin(angle)) * r;
    vec2 warp = vec2(fbm(flow * 0.62), fbm(flow * 0.62 + 23.7));
    float turbulence = fbm(flow * 0.92 + warp * 1.9);
    float fine = fbm(flow * 2.2 + warp * 3.2);
    float filament = smoothstep(0.44, 0.76, fine + turbulence * 0.22);
    float lanes = smoothstep(0.24, 0.64, turbulence);
    float broken = smoothstep(0.28, 0.68, fbm(flow * 1.7 - warp * 2.0));
    float outerFlow = (0.06 + 1.55 * filament * broken) * (0.12 + 0.88 * lanes);
    float body = 0.56 + 0.34 * turbulence;
    float structure = mix(body, outerFlow, smoothstep(3.3, 6.5, r));
    float radial = pow(INNER / r, 3.0);
    float mask = smoothstep(INNER, INNER + 0.23, r) * (1.0 - smoothstep(7.6, OUTER, r));
    vec3 tangent = normalize(vec3(-p.z, 0, p.x));
    float speed = 0.52 / sqrt(max(r - 1.0, 1.0));
    float doppler = sqrt(1.0 - speed * speed) / max(0.35, 1.0 - speed * dot(tangent, toObserver));
    float boost = pow(doppler, 3.0);
    float redshift = sqrt(max(0.0, 1.0 - 1.0 / r));
    float heat = clamp(0.48 + 0.35 * radial + 0.18 * filament + 0.18 * (doppler - 1.0), 0.0, 1.0);
    vec3 warm = vec3(1.0, 0.34, 0.10), gold = vec3(1.0, 0.70, 0.33), white = vec3(1.0, 0.97, 0.86);
    vec3 temperature = mix(warm, gold, smoothstep(0.2, 0.72, heat));
    temperature = mix(temperature, white, smoothstep(0.62, 0.90, heat));
    vec3 emission = temperature * (0.10 + structure * 6.4) * radial * boost * redshift;
    float density = mask * (0.45 + 0.55 * lanes) * (0.55 + turbulence);
    return vec4(emission, density);
  }

  vec3 acceleration(vec3 p, float h2) {
    float r2 = max(dot(p, p), 0.64);
    return -1.5 * uLensing * h2 * p / (r2 * r2 * sqrt(r2));
  }

  void main() {
    vec4 cameraRay = uInverseProjection * vec4(vUv * 2.0 - 1.0, 1, 1);
    vec3 initial = normalize((uCameraToHole * vec4(normalize(cameraRay.xyz / cameraRay.w), 0)).xyz);
    vec3 origin = uCameraToHole[3].xyz;
    vec3 p = origin, v = initial;
    float b = dot(p, v);
    float discriminant = b * b - dot(p, p) + DOMAIN * DOMAIN;
    vec3 radiance = vec3(0);
    vec2 noteUv = vec2(-1.0), priorUv = vec2(-1.0);
    vec2 noteSlope = vec2(0.0), priorSlope = vec2(0.0);
    float noteWeight = 0.0, priorWeight = 0.0;
    float transmission = 1.0;
    float firstDepth = NO_HIT;
    bool escaped = false;
    bool captured = false;
    bool intersects = discriminant >= 0.0;
    if (intersects) intersects = -b + sqrt(max(discriminant, 0.0)) >= 0.0;
    if (!intersects) {
      escaped = true;
    } else {
      p += v * max(0.0, -b - sqrt(max(discriminant, 0.0)));
      vec3 angular = cross(p, v);
      float h2 = dot(angular, angular);
      for (int i = 0; i < MAX_STEPS; i++) {
        float r = length(p);
        if (r < 1.015) { captured = true; break; }
        if (r > DOMAIN + 0.01 && dot(p, v) > 0.0) { escaped = true; break; }
        float dt = min(2.0 * uStepScale, max(0.035, 0.085 * r * uStepScale / max(length(v), 1.0)));
        vec3 halfVelocity = v + acceleration(p, h2) * (0.5 * dt);
        vec3 next = p + halfVelocity * dt;

        // Intersect bent rays with the live note exposure on BOTH sides of
        // periapsis. Radial ray direction is not a source-visibility test: a
        // valid disk crossing moves through periapsis as the camera orbits.
        // Gating it there cuts the lensed band before it meets the direct disk.
        // The bend/source-occultation weights below already reject duplicates.
        // Start from a thin plane; the captured mean height corrects it below.
        if (uDiskEnabled > 0.0 && p.y * next.y < 0.0) {
          float fraction = -p.y / (next.y - p.y);
          vec3 hit = mix(p, next, fraction);
          // Every direction-dependent weight uses the actual crossing time.
          // Midpoint directions jump when a hit changes integration segments.
          vec3 hitVelocity = halfVelocity + acceleration(hit, h2) * ((fraction - 0.5) * dt);
          vec3 worldHit = (uHoleToWorld * vec4(hit, 1.0)).xyz;
          vec2 uv = worldHit.xz / (2.0 * uDiskExtent) + 0.5;
          if (all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
            vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
            float highlight = 1.0 + 0.22 * dot(tangent, -normalize(hitVelocity));
            float secondary = smoothstep(0.04, 0.18, 1.0 - dot(initial, normalize(hitVelocity)));
            vec3 worldDirection = (uHoleToWorld * vec4(hitVelocity, 0.0)).xyz;
            float vertical = (worldDirection.y < 0.0 ? -1.0 : 1.0) * max(abs(worldDirection.y), 0.035);
            vec2 slope = clamp(worldDirection.xz / vertical, vec2(-12.0), vec2(12.0));
            // Fade weakly bent primary light; ordinary stars are drawn later.
            // Exposure-grade the finite source footprint as luminous light,
            // not a dark reflective-looking surface. This is art direction.
            // Hybrid rendering keeps ordinary 3D sources in the direct pass.
            // Prioritize repeated light whose straight source-to-camera
            // segment approaches the capture cone, with a soft boundary. This
            // avoids a second, displaced primary disk at high inclinations;
            // it deliberately omits some physically possible secondary light.
            vec3 toSource = hit - origin;
            float sourceDistance = length(toSource);
            vec3 straight = toSource / max(sourceDistance, 0.001);
            float closest = -dot(origin, straight);
            float impact = length(origin + straight * closest);
            float occultationWeight = (1.0 - smoothstep(1.7, 3.8, impact)) *
              smoothstep(0.0, 0.3, closest) * smoothstep(0.0, 0.3, sourceDistance - closest);
            float weight = 1.1 * highlight * secondary * occultationWeight;
            // Retain the two strongest geometric candidates, not the last
            // crossings. An invisible later hit cannot erase earlier light.
            // Higher image orders are bounded, with no texture work in the loop.
            if (weight > noteWeight) {
              priorUv = noteUv; priorSlope = noteSlope; priorWeight = noteWeight;
              noteUv = uv; noteSlope = slope; noteWeight = weight;
            } else if (weight > priorWeight) {
              priorUv = uv; priorSlope = slope; priorWeight = weight;
            }
          }
        }

        // Intersect the whole integration segment with a finite world-space
        // slab. This avoids missing a thin disk with larger mobile steps.
        // Optional supporting dust only. The observatory disables it: every
        // luminous disk star is a real note, with secondary light sampled above.
        if (uDust > 0.0 && min(p.y, next.y) < THICKNESS && max(p.y, next.y) > -THICKNESS) {
          float dy = next.y - p.y;
          float enter = 0.0, leave = 1.0;
          if (abs(dy) > 0.00001) {
            float t0 = (-THICKNESS - p.y) / dy, t1 = (THICKNESS - p.y) / dy;
            enter = max(0.0, min(t0, t1));
            leave = min(1.0, max(t0, t1));
          }
          if (leave > enter) {
            vec3 samplePoint = mix(p, next, (enter + leave) * 0.5);
            float diskRadius = length(samplePoint.xz);
            if (diskRadius > INNER && diskRadius < OUTER) {
              vec4 material = disk(samplePoint, -normalize(halfVelocity));
              float path = length(next - p) * (leave - enter);
              float verticalProfile = 1.0 - smoothstep(THICKNESS * 0.2, THICKNESS, abs(samplePoint.y));
              float opacity = min(0.04, 1.0 - exp(-material.a * verticalProfile * path / (2.0 * THICKNESS) * uDust));
              radiance += transmission * opacity * material.rgb;
              // Emissive support never supplies an opaque foreground depth.
            }
          }
        }
        p = next;
        v = halfVelocity + acceleration(p, h2) * (0.5 * dt);
      }
      if (!escaped && transmission >= 0.012) captured = true; // bounded unresolved critical rays are dark
    }
    if (captured && firstDepth == NO_HIT) {
      firstDepth = max(0.001, dot(p - origin, initial) * uWorldScale);
    }
    vec3 worldEscape = normalize((uHoleToWorld * vec4(normalize(v), 0)).xyz);
    vec3 background = sky(worldEscape); // derivatives evaluated for all pixels
    if (escaped) radiance += transmission * background;
    // Evaluate derivatives before branching; filter the actual exposure along
    // the ray footprint, preserving its narrow-axis structure rather than
    // isotropically smearing short source glints into a ribbed luminous slab.
    vec2 sourceDx = dFdx(noteUv), sourceDy = dFdy(noteUv);
    vec2 priorDx = dFdx(priorUv), priorDy = dFdy(priorUv);
    if (uDiskEnabled > 0.0 && escaped) {
      if (noteWeight > 0.0) radiance += noteImage(noteUv, noteSlope, sourceDx, sourceDy) * noteWeight;
      if (priorWeight > 0.0) radiance += noteImage(priorUv, priorSlope, priorDx, priorDy) * priorWeight;
    }
    // No reflective surface or light painted into the absorbing center.
    if (captured) radiance = vec3(0.0);
    // Signed ray-depth: negative marks capture for shadow-preserving glow.
    outColor = vec4(radiance, captured ? -firstDepth : firstDepth);
  }
`;

export const compositeFragment = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  layout(location = 0) out vec4 outColor;
  uniform sampler2D uImage;
  uniform sampler2D uForegroundLight;
  uniform float uForegroundEnabled;
  uniform vec2 uTexel;
  uniform mat4 uInverseProjection;
  uniform mat4 uProjection;
  uniform float uExposure;
  uniform float uGlow;

  vec3 bright(vec2 offset) {
    return max(texture(uImage, vUv + offset * uTexel).rgb - vec3(0.85), vec3(0));
  }
  void main() {
    vec4 image = texture(uImage, vUv);
    vec3 glow = vec3(0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981634;
      vec2 direction = vec2(cos(a), sin(a));
      glow += bright(direction * 3.0) * 0.085;
      glow += bright(direction * 9.0) * 0.04;
    }
    float luminance = dot(image.rgb, vec3(0.2126, 0.7152, 0.0722));
    float shadowProtection = image.a < 0.0 ? smoothstep(0.005, 0.10, luminance) : 1.0;
    vec3 linearColor = image.rgb + glow * uGlow * shadowProtection;
    // Deliberately modest optical glare, no broad orange veil across the frame.
    vec3 mapped = vec3(1.0) - exp(-linearColor * uExposure);
    outColor = linearToOutputTexel(vec4(mapped, 1));
    // Preserve the direct volumes' screen-space exposure grade. Combining this
    // bounded soft layer here avoids another fullscreen/MSAA blend; actual
    // stellar cores and trails still draw at full canvas resolution afterward.
    if (uForegroundEnabled > 0.0) {
      vec3 light = texture(uForegroundLight, vUv).rgb;
      outColor.rgb = light + outColor.rgb * (1.0 - light);
    }

    float depth = abs(image.a);
    if (depth >= 59000.0) { gl_FragDepth = 1.0; }
    else {
      vec4 direction = uInverseProjection * vec4(vUv * 2.0 - 1.0, 1, 1);
      vec3 viewPosition = normalize(direction.xyz / direction.w) * depth;
      vec4 clip = uProjection * vec4(viewPosition, 1);
      gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
    }
  }
`;

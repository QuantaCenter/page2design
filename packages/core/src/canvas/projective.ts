import type { DesignNode } from '../model/design.js';
import { localDrawingNode } from './transform.js';

let surface: HTMLCanvasElement | undefined;
let gl: WebGLRenderingContext | null | undefined;
let program: WebGLProgram | undefined;

function renderer(owner: Document) {
  if (gl?.isContextLost()) {
    gl = undefined;
    surface = undefined;
    program = undefined;
  }
  if (gl !== undefined) return gl;
  surface = owner.createElement('canvas');
  gl = surface.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;
  const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision
    ? 'highp'
    : 'mediump';
  const shader = (type: number, source: string) => {
    const value = gl!.createShader(type)!;
    gl!.shaderSource(value, source);
    gl!.compileShader(value);
    if (!gl!.getShaderParameter(value, gl!.COMPILE_STATUS))
      throw new Error(gl!.getShaderInfoLog(value) || 'Projection shader failed.');
    return value;
  };
  program = gl.createProgram()!;
  gl.attachShader(
    program,
    shader(
      gl.VERTEX_SHADER,
      `attribute vec4 position; attribute vec2 uv; varying ${precision} vec2 texcoord; void main(){gl_Position=position;texcoord=uv;}`,
    ),
  );
  gl.attachShader(
    program,
    shader(
      gl.FRAGMENT_SHADER,
      `precision ${precision} float; varying ${precision} vec2 texcoord; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,texcoord);}`,
    ),
  );
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error('Projection program failed.');
  return gl;
}

/** Project native painted content with perspective-correct texture interpolation.
 * Texture pixels are generated from the layer's own drawing commands, never a
 * screenshot of the source page. Children remain independently represented. */
export function paintProjectedNode(
  context: CanvasRenderingContext2D,
  node: DesignNode,
  paint: (context: CanvasRenderingContext2D, node: DesignNode) => void,
) {
  const local = localDrawingNode(node),
    box = node.localVisualBox || node.localBox!,
    m = node.transform!;
  const owner = context.canvas.ownerDocument;
  context.save();
  context.translate(-node.box.x, -node.box.y);
  const camera = context.getTransform();
  const bounds = node.visualBox || node.box;
  const left = Math.max(0, Math.floor(bounds.x * camera.a + camera.e)),
    top = Math.max(0, Math.floor(bounds.y * camera.d + camera.f));
  const right = Math.min(
    context.canvas.width,
    Math.ceil((bounds.x + bounds.width) * camera.a + camera.e),
  );
  const bottom = Math.min(
    context.canvas.height,
    Math.ceil((bounds.y + bounds.height) * camera.d + camera.f),
  );
  if (right <= left || bottom <= top || box.width <= 0 || box.height <= 0) {
    context.restore();
    return;
  }
  const density = Math.min(
    4,
    Math.max(1, Math.abs(camera.a)),
    4096 / box.width,
    4096 / box.height,
    Math.sqrt((4 * 1024 * 1024) / (box.width * box.height)),
  );
  const texture = owner.createElement('canvas');
  texture.width = Math.max(1, Math.ceil(box.width * density));
  texture.height = Math.max(1, Math.ceil(box.height * density));
  const layer = texture.getContext('2d')!;
  layer.scale(density, density);
  layer.translate(node.localBox!.x - box.x, node.localBox!.y - box.y);
  paint(layer, local);
  const gpu = renderer(owner);
  if (!gpu) {
    // A bounded affine mesh keeps the same native path available when a host
    // disables WebGL. Browser selection still uses the exact inverse matrix.
    const cells = 20;
    for (let row = 0; row < cells; row++)
      for (let column = 0; column < cells; column++) {
        const points = [
          [column, row],
          [column + 1, row],
          [column + 1, row + 1],
          [column, row + 1],
        ].map(([x, y]) => {
          const sx = (x / cells) * box.width,
            sy = (y / cells) * box.height,
            X = box.x + sx,
            Y = box.y + sy,
            w = m[6] * X + m[7] * Y + m[8];
          return {
            sx,
            sy,
            x: (m[0] * X + m[1] * Y + m[2]) / w,
            y: (m[3] * X + m[4] * Y + m[5]) / w,
          };
        });
        for (const indices of [
          [0, 1, 2],
          [0, 2, 3],
        ]) {
          const [p, q, r] = indices.map((index) => points[index]),
            det = (q.sx - p.sx) * (r.sy - p.sy) - (r.sx - p.sx) * (q.sy - p.sy);
          const a = ((q.x - p.x) * (r.sy - p.sy) - (r.x - p.x) * (q.sy - p.sy)) / det;
          const c = ((r.x - p.x) * (q.sx - p.sx) - (q.x - p.x) * (r.sx - p.sx)) / det;
          const b = ((q.y - p.y) * (r.sy - p.sy) - (r.y - p.y) * (q.sy - p.sy)) / det;
          const d = ((r.y - p.y) * (q.sx - p.sx) - (q.y - p.y) * (r.sx - p.sx)) / det;
          context.save();
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.lineTo(q.x, q.y);
          context.lineTo(r.x, r.y);
          context.closePath();
          context.clip();
          context.transform(a, b, c, d, p.x - a * p.sx - c * p.sy, p.y - b * p.sx - d * p.sy);
          context.drawImage(
            texture,
            0,
            0,
            box.width * density,
            box.height * density,
            0,
            0,
            box.width,
            box.height,
          );
          context.restore();
        }
      }
  } else {
    surface!.width = right - left;
    surface!.height = bottom - top;
    gpu.viewport(0, 0, surface!.width, surface!.height);
    gpu.clearColor(0, 0, 0, 0);
    gpu.clear(gpu.COLOR_BUFFER_BIT);
    gpu.useProgram(program!);
    const vertices: number[] = [];
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const X = box.x + u * box.width,
        Y = box.y + v * box.height,
        w = m[6] * X + m[7] * Y + m[8];
      const x = m[0] * X + m[1] * Y + m[2],
        y = m[3] * X + m[4] * Y + m[5];
      const dx = camera.a * x + camera.c * y + camera.e * w,
        dy = camera.b * x + camera.d * y + camera.f * w;
      vertices.push(
        (2 * (dx - left * w)) / surface!.width - w,
        w - (2 * (dy - top * w)) / surface!.height,
        0,
        w,
        (u * box.width * density) / texture.width,
        (v * box.height * density) / texture.height,
      );
    }
    const buffer = gpu.createBuffer();
    gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
    gpu.bufferData(gpu.ARRAY_BUFFER, new Float32Array(vertices), gpu.STREAM_DRAW);
    const position = gpu.getAttribLocation(program!, 'position'),
      uv = gpu.getAttribLocation(program!, 'uv');
    gpu.enableVertexAttribArray(position);
    gpu.vertexAttribPointer(position, 4, gpu.FLOAT, false, 24, 0);
    gpu.enableVertexAttribArray(uv);
    gpu.vertexAttribPointer(uv, 2, gpu.FLOAT, false, 24, 16);
    const image = gpu.createTexture();
    gpu.bindTexture(gpu.TEXTURE_2D, image);
    gpu.pixelStorei(gpu.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_S, gpu.CLAMP_TO_EDGE);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_T, gpu.CLAMP_TO_EDGE);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MIN_FILTER, gpu.LINEAR);
    gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MAG_FILTER, gpu.LINEAR);
    gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, gpu.RGBA, gpu.UNSIGNED_BYTE, texture);
    gpu.drawArrays(gpu.TRIANGLE_STRIP, 0, 4);
    gpu.flush();
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(surface!, left, top);
    context.restore();
    gpu.deleteTexture(image);
    gpu.deleteBuffer(buffer);
    surface!.width = surface!.height = 1;
  }
  texture.width = texture.height = 0;
  context.restore();
}

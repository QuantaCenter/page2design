# @quantacenter/page2design

把调用方已经取得的页面信息转换为设计文档，再用 Canvas2D 绘制。宿主提供已布局的浏览器 `Document` 或结构化快照，并负责打开页面、等待加载和获取资源字节。

## 安装与导入

```sh
npm install @quantacenter/page2design
```

| 入口                                     | API                                                    | 运行环境                       |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| `@quantacenter/page2design`              | [快照转换、图层和几何](#主入口)及[数据模型](#数据模型) | Node.js 20+ 或浏览器           |
| `@quantacenter/page2design/dom`          | [DOM 布局、表格、伪元素、控件和背景采集](#dom-采集)    | 已布局的浏览器 `Document`      |
| `@quantacenter/page2design/canvas`       | [资源解码、预览、绘制、命中和导出](#canvas-渲染)       | 浏览器 Canvas2D                |
| `@quantacenter/page2design/package.json` | npm 包元数据                                           | 支持 JSON 模块或文件读取的环境 |

包提供 ESM 和 TypeScript 声明。文档及布局几何以 CSS px 表示。Canvas 的设备像素尺寸由绘制选项 `pixelRatio` 决定。

## 主入口

### 快照转换

```ts
convertSnapshot(snapshot: PageSnapshot, options?: ConversionOptions): DesignDocument
prepareConversion(snapshot: LayoutSnapshot): ConversionPlan
completeConversion(
  plan: ConversionPlan,
  resources: SnapshotResources,
  options?: ConversionOptions,
): DesignDocument
```

| API                  | 行为                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `convertSnapshot`    | 同步转换齐备的布局和资源快照。等价于先调用 `prepareConversion(snapshot)`，再以同一个快照作为资源调用 `completeConversion`。 |
| `prepareConversion`  | 校验并复制布局，处理绘制顺序、表格和合成边界，返回可由宿主补齐素材引用的计划。                                              |
| `completeConversion` | 校验计划和内联资源，复制数据并计算统计信息，返回完整文档。可用同一计划重新生成文档，例如比较原始层级与平铺。                |
| `CAPTURE_REVISION`   | 当前采集数据的数值型修订号。可用于检查保存的采集计划与当前转换器是否兼容。                                                  |

| 类型                | 字段                                                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LayoutSnapshot`    | `title`、`viewport: { width, height }`、画板 `width` 和 `height`、`background`、`nodes: readonly DesignNode[]`。可选 `tables: readonly TableSnapshot[]` 和 `warnings: readonly CaptureWarning[]`。画板尺寸与采集视口尺寸可以不同。 |
| `SnapshotResources` | `id`、`capturedAt`（传入非空时间字符串）、`assets: readonly Asset[]`。可选 `fonts: readonly FontAsset[]`、内联原图 `referenceImage`、耗时 `durationMs`。没有图像素材时传 `assets: []`。                                            |
| `PageSnapshot`      | 同时满足 `LayoutSnapshot` 和 `SnapshotResources`。                                                                                                                                                                                 |
| `ConversionOptions` | 可选 `structure: LayerStructure`，默认 `'hierarchical'`。传 `'flat'` 可直接得到绝对定位文档。                                                                                                                                      |
| `ConversionPlan`    | `kind: 'page-to-design/conversion-plan'`、`captureRevision`、`title`、`viewport`、`width`、`height`、`background`、可修改的 `nodes: DesignNode[]` 和 `warnings: CaptureWarning[]`。                                                |

`prepareConversion` 要求画板和视口尺寸是有限正数，节点 ID 非空且唯一，`box` 的四个值均有限且宽高非负。无效尺寸抛出 `RangeError`，缺少 `nodes` 数组、ID 冲突或无效节点矩形抛出 `TypeError`。

`completeConversion` 要求计划修订号匹配，以及资源 ID 非空且唯一。图像、字体和原图的数据必须以 `data:` 开头。图像、SVG、栅格图层及有内容的 Canvas 图层需要有效 `assetId`。背景和遮罩中的 URL 图像也需要匹配的素材 ID，包括交叉淡化的嵌套输入。校验失败抛出 `TypeError`。图层的来源 URL 可保留作元数据。

#### 最小快照示例

```ts
import { convertSnapshot, type PageSnapshot } from '@quantacenter/page2design';

const snapshot: PageSnapshot = {
  id: 'example',
  capturedAt: new Date().toISOString(),
  title: 'Example',
  viewport: { width: 390, height: 844 },
  width: 390,
  height: 844,
  background: '#fff',
  nodes: [],
  assets: [],
};

const design = convertSnapshot(snapshot, { structure: 'flat' });
```

### 图层结构与 CSS

| 签名                                                        | 行为                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flattenDocument(document: DesignDocument): DesignDocument` | 返回 `structure: 'flat'`、`layout: 'absolute'` 的文档。按 `paintOrder`、`order` 排列节点，清空父子关系，将间距和图片内缩折算为固定绘制几何，并保留既有裁剪和合成边界。 |
| `nodeCss(node: DesignNode): string`                         | 返回以 `.element` 为选择器的 CSS 片段，包含节点尺寸和适用的文字、背景或边框样式。绝对定位节点另含 `left`、`top` 和 `z-index`。                                         |

原始文档可保留用于切回层级视图。平铺结果会复用部分内部数据，请把两个文档都作为不可变快照传给渲染器。

### 坐标、缩放和测距

```ts
clamp(value: number, min: number, max: number): number
round(value: number, digits?: number): number
screenToDocument(point: { x: number; y: number }, camera: Camera): { x: number; y: number }
zoomAt(camera: Camera, point: { x: number; y: number }, nextScale: number): Camera
fitCamera(
  document: { width: number; height: number },
  viewport: { width: number; height: number },
): Camera
intersects(a: Rect, b: Rect): boolean
contains(outer: Rect, inner: Rect): boolean
measureRects(a: Rect, b: Rect): MeasureSegment[]
```

| API                | 参数和结果                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `clamp`            | 将 `value` 限制在有序的 `min` 至 `max` 区间。                                                                |
| `round`            | 按十进制小数位舍入并返回数值，默认保留 1 位。                                                                |
| `screenToDocument` | 把画布视口中的 CSS 坐标换算为文档坐标。先减相机平移，再除以 `scale`。                                        |
| `zoomAt`           | 以参数 `point` 给出的视口坐标为锚点缩放，返回新相机。缩放比例限制在 `0.1` 至 `4`。                           |
| `fitCamera`        | 根据画板和目标视口尺寸生成水平居中且预留边距的初始相机。缩放比例在 `0.1` 至 `1` 之间。                       |
| `intersects`       | 检测两个轴对齐矩形是否相交，边缘接触也算相交。                                                               |
| `contains`         | 检测 `outer` 是否包含 `inner`，允许 `0.5` CSS px 的边缘容差。                                                |
| `measureRects`     | 包含时给出大于 `0.1` CSS px 的内边距测量。其他情况在分离或接触的轴上给出边缘间距，两个轴均交叠时返回空数组。 |

`Camera` 为 `{ x, y, scale }`，文档中的点映射到视口为 `{ x: x * scale + camera.x, y: y * scale + camera.y }`，其中公式右侧的 `x` 和 `y` 是文档坐标。`MeasureSegment` 包含端点 `x1`、`y1`、`x2`、`y2`、CSS px 距离 `value` 和方向 `axis: 'x' | 'y'`。

### 投影变换

```ts
matrixFromQuad(box: Rect, quad: number[]): TransformMatrix | null
projectPoint(matrix: TransformMatrix, point: { x: number; y: number }): { x: number; y: number }
inverseTransform(matrix: TransformMatrix): TransformMatrix | null
transformRect(matrix: TransformMatrix, box: Rect): Rect
applyNativeTransforms(nodes: DesignNode[], matrices: Record<string, TransformMatrix>): void
```

| API                     | 参数和结果                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matrixFromQuad`        | 由变换前的 `box` 和投影后四角生成矩阵。`quad` 依次是左上、右上、右下、左下的 `x, y`，共 8 个数字。退化或无效几何可能返回 `null`。                       |
| `projectPoint`          | 对点应用矩阵并除以齐次坐标 `w`。调用方需提供使 `w` 非零的点和矩阵。                                                                                     |
| `inverseTransform`      | 返回逆矩阵，矩阵接近奇异时返回 `null`。                                                                                                                 |
| `transformRect`         | 投影矩形四角并返回轴对齐外接矩形。                                                                                                                      |
| `applyNativeTransforms` | 原地修改节点。矩阵按 `captureSourceId` 索引，未单独提供矩阵的后代可继承父节点变换。保存局部矩形、更新外接矩形和裁剪几何，并清理临时 `captureSourceId`。 |

`TransformMatrix` 是 9 元素的行优先 `3 × 3` 数字元组。宿主可采集归一化后的局部边框及原始投影四角，在 `prepareConversion` 生成表格与绘制计划之后对 `plan.nodes` 调用 `applyNativeTransforms`，再执行 `completeConversion`。

## DOM 采集

本节 API 从传入的浏览器 `Document` 取数据。宿主应先在目标视口完成布局，等待参与测量的字体就绪。布局采集会为元素设置 `data-page-to-design-id`，表格、伪元素和背景采集使用这些 ID 关联图层。

### collectDomLayout

```ts
collectDomLayout(options: DomSnapshotOptions): DomLayoutSnapshot
```

| `DomSnapshotOptions` 字段         | 含义                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `document: Document`              | 要采集的文档，必须有渲染窗口 `defaultView`。                                                     |
| `fullPage: boolean`               | `true` 时采集文档高度范围，`false` 时使用视口高度。                                              |
| `maxHeight: number`               | 整页模式下的高度上限。                                                                           |
| `maxNodes: number`                | 布局图层数量上限。                                                                               |
| `transformedSourceIds?: string[]` | 宿主为变换采集标记的 `data-page-to-design-source-id`，用于保留归一化后可能落在裁剪区域外的内容。 |
| `documentHeight?: number`         | 宿主归一化变换前测得的文档滚动高度，可作为整页高度计算的输入。                                   |

`DomLayoutSnapshot` 返回 `title`、`width`、`height`、`background`、`nodes: DesignNode[]`、`warnings: CaptureWarning[]` 和 `fontFaces`。宽度取 `window.innerWidth`，节点位置计入页面滚动偏移。字体声明包含 `family`、`style`、`weight`、`unicodeRange` 和候选地址 `urls: string[]`，由宿主取得相应字体数据。转换前需要补上 `viewport`。

### 表格、伪元素、控件和背景

```ts
collectDomTables(options: { document: Document }): TableSnapshot[]
collectDomPseudos(options: PseudoOptions): DesignNode[]
collectDomControls(options: {
  document: Document;
  nodes: DesignNode[];
  text: ControlTextLayout[];
  parts: ControlPartLayout[];
}): DesignNode[]
collectDomBackgrounds(options: {
  document: Document;
  nodes: DesignNode[];
}): Promise<{ id: string; layers: BackgroundLayer[]; masks?: MaskLayer[]; clipPath?: ShapeClip }[]>
```

| API                     | 使用方式                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectDomTables`      | 读取已标记表格的行列、合并单元格、边框和绘制区域。在 `collectDomLayout` 之后调用，把结果传给 `LayoutSnapshot.tables`。                                                          |
| `collectDomPseudos`     | 使用宿主提供的伪元素盒和文字行，返回独立的伪元素图层及其文字子图层。将结果合并进节点列表，并按 `parentId` 把伪元素根图层挂到原父节点的 `children`。                             |
| `collectDomControls`    | 按节点 ID 把浏览器提供的控件文字行与内部区域追加到 `node.control.textRuns`、`node.control.parts`，原地更新并返回同一个 `nodes` 数组。适用于日期字段、占位符和自动换行的文本域。 |
| `collectDomBackgrounds` | 解析节点的多层背景、遮罩和裁剪路径。按返回记录的 `id` 将 `layers`、`masks`、`clipPath` 分别写入节点的 `backgroundLayers`、`maskLayers`、`clipPath`，再进行转换。                |

| 类型                | 字段                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PseudoOptions`     | `document`、`parents: DesignNode[]`（已有布局节点）、`pseudos: PseudoLayout[]`。                                                                                  |
| `PseudoLayout`      | `parentId`、`type`（`::before` 或 `::after`）、`box: Rect`、`paintOrder`、可包含已解析 `attr()` 或 `counter()` 的文字分片 `text: { text: string; box: Rect }[]`。 |
| `ControlTextLayout` | `nodeId`、`text`、`box: Rect`、`style: Record<string, string>`。                                                                                                  |
| `ControlPartLayout` | `nodeId`、`role`、`box: Rect`、`style: Record<string, string>`。                                                                                                  |

#### 从 Document 转换

```ts
import {
  completeConversion,
  prepareConversion,
  type ConversionPlan,
  type SnapshotResources,
} from '@quantacenter/page2design';
import {
  collectDomBackgrounds,
  collectDomLayout,
  collectDomTables,
  type DomLayoutSnapshot,
} from '@quantacenter/page2design/dom';

async function convertDocument(
  document: Document,
  resolveResources: (
    plan: ConversionPlan,
    fontFaces: DomLayoutSnapshot['fontFaces'],
  ) => Promise<SnapshotResources>,
) {
  const view = document.defaultView;
  if (!view) throw new TypeError('A document with a window is required');
  await document.fonts.ready;

  const { nodes, fontFaces, ...layout } = collectDomLayout({
    document,
    fullPage: true,
    maxHeight: 12000,
    maxNodes: 4500,
  });

  const backgrounds = new Map(
    (await collectDomBackgrounds({ document, nodes })).map((entry) => [entry.id, entry]),
  );
  for (const node of nodes) {
    const entry = backgrounds.get(node.id);
    if (!entry) continue;
    node.backgroundLayers = entry.layers;
    if (entry.masks) node.maskLayers = entry.masks;
    if (entry.clipPath) node.clipPath = entry.clipPath;
  }

  const plan = prepareConversion({
    ...layout,
    nodes,
    viewport: { width: view.innerWidth, height: view.innerHeight },
    tables: collectDomTables({ document }),
  });

  // 宿主获取资源，为计划内的图层及背景、遮罩图像补齐对应 assetId。
  const resources = await resolveResources(plan, fontFaces);
  return completeConversion(plan, resources);
}
```

## Canvas 渲染

### 资源解码与释放

```ts
loadDocumentResources(
  source: DesignDocument,
  options?: ResourceOptions,
): Promise<DocumentResources>
```

| `ResourceOptions` 字段 | 默认值和作用                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `document?: Document`  | 默认 `globalThis.document`，用于创建图像和注册字体。要求文档有 `defaultView`。    |
| `signal?: AbortSignal` | 可取消解码。解码过程中取消会使 Promise 拒绝，解码完成后取消也会释放已返回的资源。 |
| `reference?: boolean`  | 默认为 `true`。传 `false` 可跳过浏览器原图解码。                                  |

`DocumentResources` 包含 `documentId`、按素材 ID 索引的 `images: Map<string, HTMLImageElement>`、原图 `reference: HTMLImageElement | null`、`errors: string[]` 和 `dispose(): void`。部分图像或字体加载失败时，`errors` 会记录对应项，成功解码的资源仍可使用。无可用原图时 `reference` 为 `null`。`dispose()` 注销字体、释放预处理位图并清空图像映射。

`RenderResources` 只包含 `DocumentResources` 的 `images` 与 `reference`，可用 `loadDocumentResources` 的结果直接传入，也可由宿主提供已经解码的图像映射。

### CanvasRenderer

```ts
new CanvasRenderer(document: DesignDocument, resources: RenderResources)
```

| 方法                                                                            | 参数和结果                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `render(canvas: HTMLCanvasElement, options?: RenderOptions): void`              | 调整 Canvas 位图尺寸、清空旧画面，再按相机渲染指定视口。Canvas 的 CSS 显示尺寸由宿主设置。                                                                                           |
| `hitTest(point: { x: number; y: number }, camera?: Camera): DesignNode \| null` | `point` 是画布视口 CSS 坐标，通常以指针的 `clientX/clientY` 减去 Canvas 的视口位置。传入绘制时使用的相机。命中遵循前后顺序、祖先裁剪和栅格素材的透明区域。原图预览时仍查询设计图层。 |
| `toCanvas(options?: ExportOptions): HTMLCanvasElement`                          | 创建包含整张设计画板的新 Canvas。使用文档坐标绘制，适合以 `.toBlob()` 或 `.toDataURL()` 导出。                                                                                       |
| `dispose(): void`                                                               | 释放实例的预览与命中缓存。之后调用 `render`、`hitTest` 或 `toCanvas` 会抛出错误。                                                                                                    |

| 选项                            | 默认值和作用                                                       |
| ------------------------------- | ------------------------------------------------------------------ |
| `RenderOptions.width`、`height` | CSS 视口尺寸，默认取设计文档的画板宽高。                           |
| `RenderOptions.pixelRatio`      | 默认 `1`。Canvas 位图尺寸取视口尺寸乘以此值后四舍五入。            |
| `RenderOptions.camera`          | 默认 `{ x: 0, y: 0, scale: 1 }`，控制视口内的平移与缩放。          |
| `RenderOptions.referenceView`   | 传 `true` 且资源中有浏览器原图时，绘制原图。其他情况绘制设计图层。 |
| `ExportOptions.pixelRatio`      | 默认 `1`。用于计算导出 Canvas 的像素尺寸。                         |
| `ExportOptions.document`        | 创建导出 Canvas 的 `Document`，默认 `globalThis.document`。        |

`render` 要求视口宽高、像素比例和相机缩放比例是有限正数。导出也要求像素比例为有限正数。切换文档时创建新实例。资源由调用方持有，清理时先调用 `renderer.dispose()`，再调用 `resources.dispose()`。

#### 预览、命中和导出示例

```ts
import { fitCamera, type DesignDocument } from '@quantacenter/page2design';
import { CanvasRenderer, loadDocumentResources } from '@quantacenter/page2design/canvas';

async function mountPreview(design: DesignDocument, canvas: HTMLCanvasElement) {
  const document = canvas.ownerDocument;
  const resources = await loadDocumentResources(design, { document });
  const renderer = new CanvasRenderer(design, resources);
  const viewport = { width: 800, height: 600 };
  const camera = fitCamera(design, viewport);

  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  renderer.render(canvas, {
    ...viewport,
    camera,
    pixelRatio: document.defaultView?.devicePixelRatio ?? 1,
  });

  return {
    hit(event: PointerEvent) {
      const box = canvas.getBoundingClientRect();
      return renderer.hitTest({ x: event.clientX - box.left, y: event.clientY - box.top }, camera);
    },
    exportPng() {
      return renderer.toCanvas({ document, pixelRatio: 2 }).toDataURL('image/png');
    },
    dispose() {
      renderer.dispose();
      resources.dispose();
    },
  };
}
```

### 底层绘制与命中

以下签名中的 `images` 均为 `Map<string, HTMLImageElement>`，`ctx` 均为 `CanvasRenderingContext2D`。调用 `paintNode`、`clipNode`、`paintNodeHit` 或 `paintRasterHit` 时，先将上下文原点移到目标节点的 `box.x`、`box.y`。

| API                                                                                                                                  | 参数和结果                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `paintDocument(ctx, document: DesignDocument, images): void`                                                                         | 使用调用方当前的变换绘制画板背景和排序后的图层，覆盖完整画板范围，应用文档级的混合和合成组。                                           |
| `renderToCanvas(document: DesignDocument, resources: Pick<DocumentResources, 'images'>, options?: ExportOptions): HTMLCanvasElement` | 使用已经解码的图像创建整画板 Canvas。导出时只需要资源的 `images` 字段。                                                                |
| `paintNode(ctx, node: DesignNode, images, opacity?: number): void`                                                                   | 在节点局部坐标绘制单个图层。普通图层透明度默认取 `node.opacity`，栅格图层绘制其已采集像素。完整的跨图层效果通过 `paintDocument` 绘制。 |
| `clipNode(ctx, node: DesignNode): void`                                                                                              | 在当前上下文应用 `node.clips` 的矩形与圆角裁剪。可用 `ctx.save()` 和 `ctx.restore()` 将裁剪限制在本次操作内。                          |
| `roundPath(ctx, x: number, y: number, width: number, height: number, radius: number[], radiusY?: number[]): void`                    | 开始新的圆角矩形路径。传入 `radiusY` 可分别指定椭圆圆角的纵向半径，再由调用方执行填充、描边或裁剪。                                    |
| `paintNodeHit(ctx, node: DesignNode, images, color: string): void`                                                                   | 用指定颜色绘制该图层的命中区域，适合颜色拾取。考虑节点的矩形、路径裁剪和栅格素材的 alpha。                                             |
| `paintRasterHit(ctx, node: DesignNode, image: HTMLImageElement \| undefined, color: string): void`                                   | 按栅格图像的 alpha 通道填充命中颜色，透明区域可命中下一层。缺少图像时直接返回。                                                        |
| `hitTestNodes(ctx, nodes: readonly DesignNode[], images, point: { x: number; y: number }): DesignNode \| null`                       | `nodes` 按绘制顺序从底层到顶层排列，`point` 使用文档坐标。返回最上面的命中节点或 `null`。                                              |

栅格 alpha 命中使用浏览器的 `OffscreenCanvas` 和 `Path2D`，请传入已解码且可读取像素的图片。

### PreviewCache

```ts
new PreviewCache(
  document: DesignDocument,
  nodes: DesignNode[],
  images: Map<string, HTMLImageElement>,
  reference?: HTMLImageElement,
)
```

`PreviewCache` 为自建画布提供预览分块缓存。`nodes` 按 `paintOrder`、`order` 从低到高排序。构造时传入 `reference` 可缓存浏览器原图。

- `paint(context: CanvasRenderingContext2D, viewport: Rect): void` 在当前缩放和平移下绘制可见瓦片，`viewport` 使用文档坐标。缓存最多保留 64 MiB 的预览位图。
- `dispose(): void` 清空缓存的位图。下次调用 `paint` 时会按需重建。

## 数据模型

本节类型从主入口导入。几何字段通常相对于采集文档原点，变换相关字段保留投影前后的几何。`style` 使用连字符分隔的 CSS 属性名，例如 `'font-size'`。

### DesignDocument

| 字段                                                           | 含义                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `version: 1`、`captureRevision?: number`                       | 数据模型版本和采集协议修订号。                                                                           |
| `id`、`title`、`capturedAt`、`url?`                            | 文档标识、标题、采集时间和可选来源地址。宿主可为输出文档补充 `url` 元数据。                              |
| `viewport`、`width`、`height`、`background`                    | 采集视口、画板宽高和画板底色。                                                                           |
| `structure?: LayerStructure`、`layout?: 'absolute'`            | 图层结构和布局模式。平铺文档带有 `layout: 'absolute'`。                                                  |
| `nodes: DesignNode[]`、`assets: Asset[]`、`fonts: FontAsset[]` | 可绘制图层与它们使用的图像、字体数据。                                                                   |
| `referenceImage`、`warnings`                                   | 内联浏览器原图（缺省为空字符串）和 `CaptureWarning[]`。                                                  |
| `stats`                                                        | `durationMs`、`nativeNodes`、`rasterNodes`、`textRuns`，分别为耗时、原生图层数、栅格图层数和文字分片数。 |

### DesignNode

| 字段组         | 字段和含义                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 标识与结构     | `id`、`parentId`、`children`、`kind`、`name`、`tag`、`positioning?`、`pseudoElement?`。父节点和子节点以 ID 表示，根节点的 `parentId` 为 `null`。                                                                                                                                                                                                                |
| 布局与绘制     | `box`、`contentBox`、`padding`、`margin`、`border`、`radius`、`radiusY?`、`visualBox?`、`paintBox?`。分别记录边框盒、内容盒、盒模型、圆角、墨迹范围和补充的绘制矩形。                                                                                                                                                                                           |
| 变换           | `localBox?`、`localVisualBox?`、`transform?`、`captureSourceId?`。保留局部几何、投影矩阵及关联宿主变换数据的临时 ID。                                                                                                                                                                                                                                           |
| 图像与背景区域 | `imageBox?`、`controlBox?`、`backgroundBox?`、`backgroundClip?`、`backgroundAreas?`。提供固定的图像、控件、背景定位或裁剪区域。                                                                                                                                                                                                                                 |
| 样式与顺序     | `style`、`order`、`paintOrder`、`hasVisual`、`opacity`、`opacityGroups?`、`compositingGroups?`。合成组以独立层级保存，可以跨越平铺后的图层。                                                                                                                                                                                                                    |
| 裁剪与遮罩     | `clips`、`clipPath?`、`clipPaths?`、`maskLayers?`。分别记录矩形裁剪、自身路径、收集后的路径裁剪列表和遮罩图层。                                                                                                                                                                                                                                                 |
| 图像与来源     | `assetId?`、`assetUrl?`、`svgSource?`、`backgroundAssetId?`、`backgroundUrl?`、`backgroundLayers?`。ID 引用 `assets` 中的资源，URL 可作为来源信息。                                                                                                                                                                                                             |
| 文字与媒体     | `text?`、`runs?`、`textOverflow?`、`video?`、`canvas?`。视频包含 `currentTime`、`width`、`height` 及可选 `duration`、`source`、`poster`，Canvas 元数据包含固有 `width` 和 `height`。                                                                                                                                                                            |
| 控件           | `control?` 保存 `type`、`value`、`disabled`，可选 `placeholder`、`checked`、`indeterminate`、`readOnly`、`min`、`max`、`step`、`multiple`、`size`、`options`、`scrollTop`、`scrollLeft`、`focused`、`placeholderColor`、`placeholderOpacity`、`accentColor`、`textRuns` 和 `parts`。选项包含 `label`、`selected`、`disabled`，部件包含 `role`、`box`、`style`。 |
| 栅格回退       | `fallbackReason?`、`rasterBox?`、`rasterMode?`。模式为 `isolated` 或 `composited`，表示独立或已与背景合成的局部截图。                                                                                                                                                                                                                                           |
| 绘制控制       | `skipBackground?`、`skipBoxBackground?`、`skipBorders?`、`canvasBackground?`、`lines?`。用于背景转移、表格边框等绘制结果。`canvasBackground` 指定 `source`（`html` 或 `body`）和画布 `area`。                                                                                                                                                                   |

### 几何、样式与资源类型

| 类型               | 字段和取值                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Rect`             | `x`、`y`、`width`、`height`。                                                                                                                                                                                                  |
| `Insets`           | `top`、`right`、`bottom`、`left`。                                                                                                                                                                                             |
| `NodeKind`         | `frame`、`text`、`image`、`video`、`canvas`、`control`、`svg`、`raster`。                                                                                                                                                      |
| `LayerStructure`   | `hierarchical` 或 `flat`。                                                                                                                                                                                                     |
| `Tool`             | `select`、`hand` 或 `measure`，可用于宿主界面的工具状态。                                                                                                                                                                      |
| `Clip`             | 扩展 `Rect`，带 `radius`、可选 `radiusY`、`ownerId`、`localBox`、`transform`。四角按左上、右上、右下、左下排列。                                                                                                               |
| `ShapeClip`        | `ownerId`、CSS 路径或形状表达式 `value`、参考盒 `box: Clip`、可选 `transform`。                                                                                                                                                |
| `BorderLine`       | `x1`、`y1`、`x2`、`y2`、`width`、`color`、`style`。                                                                                                                                                                            |
| `TextRun`          | 扩展 `Rect`，带 `text`、`baseline`、`fontFamily`、`fontSize`、`fontWeight`、`fontStyle`、`letterSpacing`、`color`、`decoration`。可选 `textShadow`、`fontKerning`（`normal` 或 `none`）、`language`、`generated: 'ellipsis'`。 |
| `TextOverflowInfo` | `mode`（`ellipsis` 或 `line-clamp`）、`maxLines`、`truncated`、可选 `visibleText`。                                                                                                                                            |
| `CompositingGroup` | `id`、`opacity`，可选 `filter`、`backdropFilter`、`blendMode`、`isolate`、`clipPath` 和 `mask`。                                                                                                                               |
| `CssImage`         | CSS 图像值 `image`，可选 `url`、`assetId`、分辨率 `resolution` 和递归交叉淡化输入 `crossFade: { weight: number; source: CssImage }[]`。                                                                                        |
| `BackgroundLayer`  | 扩展 `CssImage`，带定位盒 `box: Rect`、裁剪区 `clip: Clip`、`style`，可选本地背景滚动裁剪 `scrollClip` 和固定背景视口裁剪 `imageClip`。                                                                                        |
| `MaskLayer`        | 扩展 `BackgroundLayer`，带 `mode`（`alpha`、`luminance` 或 `match-source`）、`composite`（`add`、`subtract`、`intersect` 或 `exclude`）和可选 `noClip`。                                                                       |
| `Asset`            | `id`、内联 `dataUrl`、`mime`，可选来源 `url` 及固有 `width`、`height`。                                                                                                                                                        |
| `FontAsset`        | `family`、`style`、`weight`、内联 `dataUrl`、可选 `unicodeRange`。                                                                                                                                                             |
| `CaptureWarning`   | `code`、`message`、可选 `nodeId`。                                                                                                                                                                                             |
| `TablePart`        | `tag`、`box`、`border`、按上右下左排列的 `colors` 和 `styles`、边框优先级 `priority`、绘制区域 `areas`、可选 `nodeId`。                                                                                                        |
| `TableCell`        | 扩展 `TablePart`，带 `row`、`column`（从 0 开始）、`rowSpan`、`colSpan`、`hiddenEmpty`、`radius`。                                                                                                                             |
| `TableSnapshot`    | `nodeId`、`collapsed`（共享边框模式）、`gridBox`、`paintBox`、`parts: TablePart[]`、`cells: TableCell[]`、`descendantIds`。                                                                                                    |

## 构建与验证

在仓库根目录运行 `bun run build:core` 构建核心包，运行 `bun run test:package` 验证 tarball 的独立安装、类型和原生 Canvas 交互。首次运行浏览器验证前可执行 `bun run setup:browser`。安装后的包内有 `examples/standalone.html`，可由静态服务器打开。

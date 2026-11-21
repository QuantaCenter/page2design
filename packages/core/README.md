# @quantacenter/page2design

把调用方已经取得的页面信息转换为设计文档，再用 Canvas2D 绘制。核心接收结构化布局快照，或显式传入的浏览器 `Document`；打开 URL、启动浏览器、等待网络、获取图片与字体、截取复杂区域均由宿主负责。

## 安装

```sh
npm install @quantacenter/page2design
```

## 入口

| 入口                               | 职责                                              | 运行环境             |
| ---------------------------------- | ------------------------------------------------- | -------------------- |
| `@quantacenter/page2design`        | 快照转换、设计模型、绝对平铺、CSS、坐标和测距     | Node.js 20+ 或浏览器 |
| `@quantacenter/page2design/dom`    | 处理已提供的 `Document`，提取布局、文字与表格信息 | 浏览器               |
| `@quantacenter/page2design/canvas` | 解码内联资源、绘制、预览缓存、命中、PNG           | 浏览器               |

包提供编译后的 ESM JavaScript 和 TypeScript 声明，运行时仅使用平台 API。React 画布适配位于应用的组件目录。[应用画布实现](https://github.com/QuantaCenter/page2design/tree/master/src/components/canvas)

## 转换已取得的信息

```ts
import { convertSnapshot, type PageSnapshot } from '@quantacenter/page2design';

// info 由宿主提供：固定几何、计算样式、文字分片、绘制顺序和资源字节。
function buildDesign(info: PageSnapshot) {
  return convertSnapshot(info, { structure: 'flat' });
}
```

`PageSnapshot` 包含：

- `id`、`capturedAt`：调用方提供的快照标识与时间。
- `title`、`viewport`、`width`、`height`、`background`：已计算的画板信息。
- `nodes`：布局节点、字体、可见文字分片、裁剪和绘制顺序。
- `tables`：可选的表格覆盖区域与边框信息。
- `assets`、`fonts`：调用方已经取得的资源，字节存入 `dataUrl`。
- `referenceImage`：可选的、调用方提供的浏览器原图。
- `warnings`、`durationMs`：可选的宿主说明和耗时。

转换是同步的数据处理；不修改输入，相同信息和选项生成相同结果。`structure` 可选 `flat` 或 `hierarchical`，默认保留层级。URL 字符串不能作为转换输入；资源字节必须是内联数据。`Asset.url` 和 `DesignDocument.url` 均为可选的来源信息，转换和绘制不依赖它们。

## 已有 Document 的处理

```ts
import { prepareConversion, completeConversion } from '@quantacenter/page2design';
import { collectDomLayout, collectDomTables } from '@quantacenter/page2design/dom';

const layout = collectDomLayout({
  document: suppliedDocument, // 必须由调用方取得，并已完成布局
  fullPage: true,
  maxHeight: 12000,
  maxNodes: 4500,
});
const plan = prepareConversion({
  ...layout,
  viewport: suppliedViewport,
  tables: collectDomTables({ document: suppliedDocument }),
});

// 宿主取得图片、字体、SVG 内联资源与局部效果位图，写入 plan.nodes 的
// assetId / rasterBox / rasterMode 等信息，再提供对应资源数据。
const design = completeConversion(plan, suppliedResources, { structure: 'flat' });
```

布局处理器只读取传入的 Document，并标注 `data-page-to-design-id` 以关联宿主提供的局部位图；它不打开网页。分阶段接口允许宿主在绘制几何确定后补齐效果素材。资源不完整时，核心报告缺失信息，由宿主处理。

宿主可将浏览器生成的伪元素几何和文字行传给 `collectDomPseudos({ document, parents: layout.nodes, pseudos })`，将返回节点加入布局并补齐父节点的 children，再执行 `prepareConversion`。应用使用 CDP 的 `DOMSnapshot.getSnapshot` 取得这些数据，包括解析后的 attr/counter 内容；核心不依赖 CDP。video 节点由宿主提供解码帧或 poster 素材，保留视频时间和原始尺寸。

转换阶段生成 `compositingGroups`，保留透明度、函数滤镜、混合、isolation 与背景采样边界，兼容原有 `opacityGroups`。边界在绝对平铺后仍正确合成，子图层保持独立。文字分片可通过 `textShadow` 保留各自的阴影样式；Canvas 原生字形生成阴影，文字仍独立可查看。

`await collectDomBackgrounds({ document: suppliedDocument, nodes: layout.nodes })` 返回每个节点的 `{ id, layers, masks?, clipPath? }`。宿主在转换前把这三个字段分别写入节点的 `backgroundLayers`、`maskLayers`、`clipPath`；每层保留定位/裁剪区域、CSS 图像、image-set 分辨率，以及交叉淡化的递归输入和权重。宿主需为每个 URL 图像提供 assetId 和内嵌数据，包含所有遮罩与交叉淡化输入。图层使用 Canvas 路径、渐变、图片与预乘合成绘制，不需要页面截图。

转换阶段还生成 `clipPaths` 以保留祖先的裁剪路径及参考几何，应用变换后记录对应矩阵；平铺后的命中仍遵循同一矢量形状。图片遮罩按 CSS 规则不改变盒子的命中范围。SVG 引用型裁剪与遮罩目前仍由宿主保留明确回退。

变换内容由宿主在保持包含块的条件下暂时归一化，读取局部布局后恢复页面，再提供原始 border quad。`matrixFromQuad` 生成二维 / 透视矩阵，`applyNativeTransforms` 将节点的 `localBox`、外接 `box` 与裁剪统一映射到画板。宿主应在表格绘制计划生成后应用矩阵；平铺不移除这些固定绘制矩阵。内置 Canvas 渲染与命中均使用该信息。

`collectDomControls` 接收宿主取得的 UA 文字行和控件子区域，将其补充到 control 节点。当前值和状态由 DOM 处理器读取，密码按掩码保存；Canvas 使用原生图形与文字重绘控件，不依赖浏览器控件截图。

## 原生 Canvas

```ts
import { CanvasRenderer, loadDocumentResources } from '@quantacenter/page2design/canvas';

const resources = await loadDocumentResources(design);
const renderer = new CanvasRenderer(design, resources);
const camera = { x: 20, y: 20, scale: 1 };
canvas.style.width = '800px';
canvas.style.height = '600px';
renderer.render(canvas, { width: 800, height: 600, pixelRatio: devicePixelRatio, camera });

const node = renderer.hitTest({ x: 100, y: 80 }, camera); // CSS 视口坐标
const png = renderer.toCanvas().toDataURL('image/png');

renderer.dispose();
resources.dispose();
```

`hitTest` 支持祖先裁剪、合并单元格覆盖范围和局部位图透明区域穿透。资源解码仅使用已提供的 `dataUrl`，支持 `AbortSignal`，通过 `dispose()` 释放注册的字体。渲染器不持有或销毁调用方的资源；先销毁渲染器，再释放资源。

`paintDocument`、`paintNode`、`paintNodeHit`、`PreviewCache` 和 `renderToCanvas` 供自定义画布宿主使用。相机与测距方法位于主入口。设计文档作为不可变快照使用；切换文档时创建新的渲染器。

## 构建与验证

在包目录可运行 `bun run build`、`bun run test` 或 `npm pack`。也可从仓库根目录构建和验证。

```sh
bun run build:core
bun run test:package
```

`test:package` 把 tarball 安装到独立临时项目，检查 Node 转换、无 DOM 的后端类型、无框架的浏览器类型、Canvas 命中、缩放与导出，以及显式传入 iframe Document 的处理。若只需生成 tarball，可在仓库根目录先运行 `mkdir -p artifacts`，再运行 `bun run pack:core`。

`examples/standalone.html` 可由静态服务器打开，示例仅依赖包内编译文件和宿主提供的数据。

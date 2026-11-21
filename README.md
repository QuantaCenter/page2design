# Page to Design

Page to Design 是一个本地网页设计查看器。输入 H5 页面地址后，Playwright 会在指定视口采集页面，应用将其重绘为可查看、测距和导出的 Canvas 图层。适用于前端教学、页面结构分析和开发标注。

可以在原始 DOM 层级和绝对定位图层之间切换，检查尺寸、字体、盒模型与 CSS，并用浏览器原图对照绘制结果。

## npm 核心包

`@quantacenter/page2design` 将已采集的页面布局和素材转换为设计文档，并提供 Canvas2D 预览、命中和导出。已有浏览器 `Document` 时，可通过 `/dom` 入口提取布局数据。页面加载和素材获取由宿主负责。[查看 npm 包](https://www.npmjs.com/package/@quantacenter/page2design)

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

[完整 API 参考与示例](#核心包-api-参考) · [核心包 README](packages/core/README.md)

## 快速开始

需要 **Bun 1.2.1+** 和 **Node.js 22.12+**（推荐 Node.js 24）。

```sh
git clone https://github.com/QuantaCenter/page2design.git
cd page2design
bun install --frozen-lockfile
bun run setup:browser
bun run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，点击「教学示例」即可转换一个内置页面。示例无需访问外网。

开发模式下，Vite 前端使用 `5173` 端口，采集 API 使用 `8787` 端口。已安装匹配版本的 Playwright Chromium 时可以跳过浏览器安装。macOS 在缺少 Playwright Chromium 时也可以使用系统安装的 Google Chrome。

| 环境变量                 | 用途                                           |
| ------------------------ | ---------------------------------------------- |
| `WEB_PORT`               | 修改开发前端端口，默认 `5173`                  |
| `PORT`                   | 修改采集 API 和本地生产服务的端口，默认 `8787` |
| `CHROME_EXECUTABLE_PATH` | 指定采集与浏览器测试使用的 Chromium 可执行文件 |

### 本地运行生产构建

```sh
bun run build
bun run start
```

打开 [http://127.0.0.1:8787](http://127.0.0.1:8787)。Express 同时提供前端静态文件和采集 API，监听地址为 `127.0.0.1`。

## 使用

1. 输入公开页面或本机开发服务的 HTTP(S) 地址，选择画板宽度，点击「转换为设计图」。取消勾选「整页」可只采集首屏。
2. 点击画布或图层列表中的对象，查看尺寸、样式、文字和 CSS。切到「原始层级」可查看原网页的布局和盒模型。双击图层可将其移至视口中央。
3. 点击「原图对照」，在浏览器截图与 Canvas 重绘之间切换。
4. 在「导出」中下载 Canvas PNG、浏览器原图 PNG 或包含资源的设计文档 JSON。JSON 使用当前选中的图层结构。单个图层的可用素材可在属性面板下载。

默认的「绝对平铺」把元素放到画板根层，用固定的 `left`、`top`、`width` 和 `height` 表达位置及尺寸。原本由 Flex、Grid、间距或内边距产生的偏移体现在固定坐标中，裁剪保留为独立遮罩。切换图层结构时会保留选择和测距状态。

| 操作                                  | 效果         |
| ------------------------------------- | ------------ |
| 滚轮                                  | 缩放画布     |
| 按住空格拖动，或按 `H` 后拖动         | 平移画布     |
| `F`                                   | 适应画布     |
| `V`                                   | 切回选择工具 |
| `M` 后依次点击两个元素                | 固定测距标注 |
| 选中元素后按住 `Alt` 并悬停另一个元素 | 临时测距     |
| `Esc`                                 | 清除选择     |

测距、属性和文档坐标均为 CSS px，与缩放比例和屏幕 DPR 无关。兄弟元素显示边界间距，有包含关系的元素显示内部四边距离。可把以下地址粘贴到转换框，体验无需外部资源的内置样例。

| 样例                                                  | 开发服务地址                                          |
| ----------------------------------------------------- | ----------------------------------------------------- |
| 合并单元格、表头、边框冲突与滚动裁剪                  | [表格样例](http://127.0.0.1:5173/table-example.html)  |
| 图片适配、背景平铺、SVG、渐变、阴影、滤镜及半透明叠加 | [视觉样例](http://127.0.0.1:5173/visual-example.html) |

## 实现结构

转换与绘制由独立工作区包 `@quantacenter/page2design` 提供。核心接收结构化快照或调用方提供的 `Document`，处理布局信息、设计模型和绘制。应用的服务端通过 Playwright 采集页面、资源和原图，前端负责交互与下载。[核心包 API 与集成示例](#核心包-api-参考)

核心包使用标准 DOM 和 Canvas2D API，当前没有第三方运行时依赖。主入口可在 Node.js 或浏览器中调用，`/dom` 和 `/canvas` 提供浏览器端能力。应用在 `src/components/canvas/` 中使用 React 和 Konva 实现画布交互。

```text
packages/core/src/convert/  信息快照 → 绘制计划 → 设计文档，纯数据处理
packages/core/src/model/    模型、相机、测距、平铺、CSS、表格和层叠算法
packages/core/src/dom/      处理调用方提供的 Document、文字与表格
packages/core/src/canvas/   原生绘制、资源解码、命中、缓存和 PNG
packages/core/examples/     无应用依赖的原生 Canvas 示例
packages/core/tests/        核心转换与算法测试
server/capture.ts           应用负责 URL、Playwright/CDP、资源和截图获取
server/index.ts             URL API、并发/超时/来源校验、本地静态服务
src/components/             图层树、属性面板、画布空状态和加载提示
src/components/canvas/      React / Konva 画布适配和资源 Hook
src/App.tsx                 输入、工具栏、状态编排与文件下载
public/                    H5 教学样例
tests/                     应用与浏览器集成测试
```

`convertSnapshot(info)` 接收布局节点与内联资源；`prepareConversion(layout)` / `completeConversion(plan, resources)` 供应用分阶段提供局部效果位图。`DesignDocument.url` 仅是应用补充的来源信息。PNG 通过核心的 `renderToCanvas` 导出，应用只触发下载。

浏览器负责 CSS 布局，采集后的文档保留实际位置、文本分行、父子关系、裁剪和样式。页面内容通过 Canvas2D 绘制，Konva 管理画布场景与交互，React 渲染侧栏与工具栏。

开发模式会先构建核心包，再监听核心编译输出、API 源码与前端。前后端采集修订号不匹配时，界面会提示更新服务并重新转换。

## 预览性能

页面内容按分辨率分块缓存，保留的预览位图最多 64 MiB，并随文档切换释放。拖动和滚轮更新合并到动画帧；悬停、选中和测距仅更新标注层，不重绘页面内容。命中图形独立复用，拖动期间暂停命中画布绘制。超过 500 行的图层列表只挂载视窗附近的行，画布选择会自动滚动到对应图层。PNG 导出仍使用原始图层逐个绘制。

启动开发服务后，从「导出」菜单保存当前版本的设计文档 JSON，然后把文件路径传给脚本。测试视窗为 1440 × 1000，DPR 为 2。

```sh
bun run profile:preview ./design.json artifacts/performance/preview.json
```

报告记录悬停、拖动和滚轮缩放的主线程耗时、内容层绘制次数及帧间隔。通过 `PREVIEW_URL` 可指定其他服务地址，通过 `PREVIEW_CPU_PROFILE` 可额外保存拖动期间的 Chromium CPU profile。测量结果受开发模式和本机负载影响，应在同一环境下比较前后版本。

## 渲染范围与限制

支持常规 DOM、文字、图片、SVG、表格、表单控件、渐变、阴影、裁剪、遮罩、混合模式和变换。视频和网页 Canvas 按采集时的画面保留。部分无法直接重绘的效果会保留为局部位图。

- 项目提供只读设计快照，支持查看、测距和导出。自由编辑、响应式重排、登录态导入和流程录制超出当前范围。
- 整页采集最多覆盖 12000 CSS px，图层上限为 4500。固定与吸顶元素保留页面顶部状态，虚拟列表只包含已渲染内容。
- 动态页面采集加载后的单个状态。持续变化或依赖特殊 WebView 能力的页面可能无法完整还原。
- 字体按可获取资源打包。未能取得的字体使用本机匹配字体，跨设备显示可能有差异。
- 导出的 CSS 表达当前快照的布局与样式。原始单位、媒体查询和组件源码需要查看原网页代码。
- 采集服务可访问本地 URL。对外部署需要另行增加访问控制、网络隔离与资源限额。

<details>
<summary>渲染与回退细节</summary>

支持常规 DOM、文字分片、图片、SVG 图片节点、线性/径向/锥形及重复渐变、多层背景、image-set、交叉淡化、圆角、边框、多层阴影和 overflow 裁剪。图片支持 fill / contain / cover / none / scale-down，以及百分比、像素和边缘偏移定位；背景图片支持尺寸、定位、repeat-x / repeat-y / space / round 和逐层定位 / 裁剪区域。打平后这些区域保留固定绝对几何，移除 padding 不会改变绘制。

线性渐变按 [CSS Images 色标规则](https://www.w3.org/TR/css-images-3/#color-stop-fixup)处理方向、未指定色标、双位置、越界与重复。外阴影支持正负 spread、多层叠加和透明填充；使用 Canvas2D 生成透明效果缓存，随场景一起缩放。SVG 保留独立资源，复制计算样式，打包同页 use / defs 引用和已取得的 image 资源；内部 path 暂不拆成独立图层。 SVG 背景按声明的宽高与 viewBox 比例计算实际尺寸；只有 viewBox 的素材使用背景定位区域作为默认尺寸，不使用图片解码器的临时宽高。素材按实际背景视口解码，保留 preserveAspectRatio、遮罩与滤镜。

HTML 表格保留独立单元格和文字图层，支持 rowspan / colspan、折叠与分离边框、粗细与样式冲突、hidden 抑制、行列背景、empty-cells、嵌套和当前状态的滚动裁剪。共享边框转换成独立的 Canvas 矢量图层，合并单元格的背景与命中范围按真实覆盖区域处理。相应规则参考 [CSS 表格模型](https://www.w3.org/TR/CSS22/tables.html#border-conflict-resolution)，并使用浏览器实际截图验证。

整体透明度使用 Canvas 离屏分组合成，组内重叠子元素先正常绘制，再统一应用透明度；子图层仍独立保留，平铺后通过固定合成组保持相同效果。`::before` / `::after` 转换为原生图形和文字图层，读取浏览器实际几何、换行及已解析的 `attr()` / `counter()` 内容。文字阴影由 Canvas 字形生成，支持多层、偏移、模糊、透明文字与混合样式，不再触发截图降级。

video 使用独立视频图层，通过 `drawImage(video)` 读取冻结时的解码帧，按 object-fit / object-position、内边距和圆角绘制；未取得帧时尝试使用 poster。文档保留视频来源、时间与原始尺寸，当前设计图仍是单帧快照，不会自动播放。跨域或受保护媒体无法读取帧且没有可用封面时，会明确报告帧不可用，不改用页面截图。

CSS transform 保留独立图层的局部几何和投影矩阵，支持平移、旋转、缩放、斜切、transform-origin、独立 translate / rotate / scale、嵌套变换与平面透视。二维内容直接在 Canvas 变换下绘制；透视内容从原生绘制指令生成纹理，再由 WebGL 作透视投影，WebGL 不可用时使用有界三角网格。裁剪和鼠标命中使用同一投影，平铺后仍保留矩阵，不再把整个变换子树合并为截图。

input、textarea、select、progress、meter 使用原生控件图层。保留当前值、占位内容、密码掩码、勾选 / 半选、选中项、禁用 / 只读状态及范围值；控件文字使用浏览器 UA 布局的真实文字行，包括 textarea 软换行和本地化日期。边框、文字、箭头、勾选和进度等由 Canvas 绘制；控件仍是设计快照，不会提交表单或打开系统弹窗。系统主题和复杂自定义控件皮肤可能存在细节差异。

CSS 函数滤镜、混合模式、isolation、背景滤镜和内阴影已接入原生绘制。合成边界保存在 `compositingGroups` 中，子图层仍独立；预览缓存保留滤镜输入边缘和真实画板背景，祖先裁剪在滤镜合成后应用。Canvas2D / WebGL 内容直接读取原画布像素和固有尺寸，不使用页面局部截图。函数滤镜与复杂变换的组合等边界仍在继续核验。

渐变支持计算长度、色彩提示、显式插值空间与预乘透明插值。image-set 保留所选素材及像素分辨率；当前浏览器支持的 -webkit-cross-fade 保留全部输入图像和混合权重，原生合成透明及嵌套图像，兼容自然尺寸和 SVG 的固定/比例视口。35 个背景用例在两种宽度、原始层级/平铺和三个预览倍率下核验。

基本 clip-path 使用原生矢量路径，支持 circle / ellipse / inset / rect / xywh、圆角多边形、path 与 shape() 命令、几何参考框和孔洞。图片遮罩支持 alpha / luminance、多层 add / subtract / intersect / exclude、尺寸与平铺、SVG 图像、image-set 和交叉淡化；滤镜先于裁剪与遮罩，透明度在最后合成。二维 / 透视变换和绝对平铺仍保留独立子图层。裁剪路径限制点击范围，图片遮罩遵循浏览器规则，保留原 CSS 盒子的点击范围。

iframe / object / embed、引用型滤镜、SVG 引用裁剪与遮罩、特殊背景与文字排版等可能使用局部截图。确实无法读回的跨域污染画布保留明确的截图说明。普通局部截图仍隔离为透明素材，截图内部暂不支持独立重编辑。

常见的左到右、左对齐单行 `text-overflow: ellipsis` 和多行 `-webkit-line-clamp` 保留为原生文字图层，支持链接、不同字重、文字颜色和字素组合。文档分别保存完整文本、可见行、省略号分片与最大行数，属性面板可以查看完整文案、字体、行高和省略方式。带背景标签等复杂省略混排仍使用局部截图，同时保留完整文字及字体属性。

CDP paint order 与 DOM 顺序提供基础顺序。打平前会根据原始父子关系修正负 z-index 子上下文，使它们位于所属上下文背景之后、普通内容之前，子上下文整体移动。复杂绘制与合成规则仍可能需要后续适配。

</details>

## 开发与验证

```sh
bun run check                    # 格式、lint 和类型检查
bun run test                     # 核心包与应用单元测试
bun run test:e2e editor.spec.ts  # 浏览器端的转换、画布交互与导出
bun run test:e2e                 # 全部浏览器测试
bun run build                    # 完整生产构建
```

Playwright 使用独立的前端 `5273` 和 API `8887` 端口，并启动自己的 HTML 测试站点。测试结果输出到终端，失败截图和 trace 保存在 `test-results/`，视觉回归对照图和分析数据位于 `artifacts/`。

使用 `bun run format` 自动格式化，或用 `bun run lint:fix` 应用支持的 lint 修复。VS Code / Cursor 可安装工作区推荐的 `oxc.oxc-vscode` 扩展。测试夹具、`public/` 页面和核心包的独立 HTML 示例保留原始空白与布局。

验证核心包时需要 npm（随 Node.js 提供）。`test:package` 会打包并安装到一个临时项目，验证独立的 Node 导入、类型声明、原生 Canvas 交互以及传入 `Document` 的处理。报告、示例截图和 tarball 位于 `artifacts/package-extraction/`。

```sh
bun run build:core
bun run test:package
```

仅需生成 tarball 时，先运行 `mkdir -p artifacts`，再运行 `bun run pack:core`。

<details>
<summary>专项浏览器回归测试</summary>

`bun run test:e2e -- native-effects.spec.ts` 验证整体透明度、video 解码帧 / poster、伪元素生成内容与文字阴影。在 390 / 1440 CSS px 下对比浏览器原图与 Canvas 导出，并检查平铺一致性及 50% / 100% / 200% 预览。结果位于 `artifacts/native-effects/<width>/`。

`bun run test:e2e -- transforms-controls.spec.ts` 验证二维 / 透视变换、原点、嵌套、镜像、旋转裁剪、伪元素、当前表单值与控件状态，检查变换后的命中和裁剪穿透，并对比原图、原始层级与平铺导出。结果位于 `artifacts/transforms-controls/<width>/`。

`bun run test:e2e -- native-masks.spec.ts native-masks-hit.spec.ts` 对照 51 个裁剪与图片遮罩区域，检查 390 / 1440 宽度、平铺/层级和三个倍率预览；另行比较 DOM、独立 Canvas 和 Konva 的命中行为。绘制结果位于 `artifacts/native-masks/<width>/`，保留独立图层，截图节点与 capture 素材数量均为零。

`bun run test:e2e -- svg-backgrounds.spec.ts` 对比 15 组 SVG 背景尺寸，包括只有 viewBox、单边尺寸、百分比、字体单位、无固有尺寸、显式视口与平铺，并检查原始层级、绝对平铺和多倍率预览。内嵌 SVG URL 中的函数与逗号不再被误判为额外背景层。

`bun run test:e2e -- missing-assets.spec.ts` 验证空图片地址、失效图片、零尺寸节点和画板外 iframe 等资源边界。没有可截取区域的节点保留几何与子节点，但不参与自身绘制；可见的缺失图片保留浏览器当前显示，外部包装层不会误删可见的溢出子节点。

`bun run test:e2e -- asset-capture.spec.ts` 验证长页首屏内跨域 iframe 横幅、圆角裁剪卡片，以及以 `application/octet-stream` 返回的字体、内嵌字体与跨域样式表内嵌字体。视口内局部素材使用视口截图，避免 Chromium 将跨域框架截为透明图；字体按浏览器请求类型识别，并跳过不支持的旧 EOT 来源，保留真实文字与伪元素字形。测试比较原始层级、绝对平铺与预览画布。旧的透明素材和缺失字体需要重新转换才能更新。

表格专项测试可运行 `bun run test:e2e -- tables.spec.ts`。测试在 390 / 1440 CSS px 两种宽度下比较浏览器原图和 Canvas 导出，检查单元格坐标、文字完整性、根图层结构、跨行单元格点击以及边框/背景像素。每次生成 `artifacts/tables/<width>/reference.png`、`canvas.png`、`comparison.png`、`design.json` 和 `report.json`；对比图左侧为浏览器原图、右侧为 Canvas。报告的差异比例统计 RGB 最大通道差值大于 32 的像素，并保留平均差值，不能把它直接当作视觉相似度。

复杂视觉专项测试可运行 `bun run test:e2e -- visuals.spec.ts`。在 390 / 1440 CSS px 下对比 44 组样例的 PNG、原始层级与绝对平铺的导出一致性、几何坐标、素材类型及滤镜扩展范围；还检查实际 Konva 场景，包括 50% / 100% / 200% 下的阴影、透明叠加、SVG 和祖先圆角裁剪。输出位于 `artifacts/visuals/<width>/`，包含原图、Canvas、并排对比图、实际场景截图、设计文档与逐项 `report.json`。每组绘制区域要求差异比例不超过 1%，RGB 最大通道差的平均值不超过 2；小数坐标、缩放采样和圆角边缘仍可能存在少量差异。

SVG 命名空间回归可运行 `bun run test:e2e -- svg.spec.ts`。覆盖页面脚本通过 `setAttribute()` 创建的 xmlns / xml / xlink 属性、规范的命名空间属性、同页 SVG 引用、双 href 图片内联，以及异常 SVG 的局部截图隔离。该测试用于防止线上页面的单个 SVG 导致整页出现 `NamespaceError`，并检查导出图片与原图一致性。

省略文字专项可运行 `bun run test:e2e -- ellipsis.spec.ts`。390 / 1440 CSS px 下各比较 14 组区域，覆盖中英文、emoji 字素、嵌套链接、字重与颜色、内边距、两行与三行省略、中文系统字体、悬挂标点、两种省略属性同时存在，以及复杂混排的全文保留；还验证 100% / 200% 时点击省略号可以选中文字图层、属性面板全文展示和平铺导出一致性。输出位于 `artifacts/ellipsis/<width>/`。

整页预加载滚动后会再次等待有限的 DOM 安静期，并在采集前暂停视频。`bun run test:e2e -- loading.spec.ts` 检查滚动后异步替换的内容和图片能够进入设计文档，避免仍按旧骨架节点采集。

采集布局前会等待捕获区域内全部图片加载并解码，包括原生懒加载、`srcset` / `picture` 当前候选图、CSS 背景、伪元素图片、SVG 引用图片和 video poster，不再限制前 150 张。页面冻结后再确认一次图片状态，使用同一份最多 20 秒的等待预算。加载失败和超时会生成说明；不会等待持续请求的统计脚本或无限流响应。浏览器端也会在设计文档的图片与字体解码完成后绘制画布。`bun run test:e2e -- image-loading.spec.ts` 覆盖超过 150 张图片、5.5 秒慢图、滚动触发的懒加载、响应式候选图、背景与伪元素，以及冻结时钟后的失败和超时。

采集上下文在页面加载前安装可暂停的时钟，等滚动预加载、字体、图片与两帧绘制完成后，冻结定时器、动画帧与 Web Animations。DOM、浏览器原图和所有局部截图使用同一个轮播状态，避免标题、选中圆点和素材在采集期间切换。`bun run test:e2e -- animation.spec.ts` 使用持续切换的定时器、动画帧色块与带伪元素的半圆指示点验证这种一致性，输出位于 `artifacts/animation/`。旧文档中的时间错位需要重新转换才能修复。

卡片层叠回归可运行 `bun run test:e2e -- stacking.spec.ts`。七组样例覆盖负层在 DOM 前后、auto 包装层、嵌套上下文、isolation、静态 Flex 项与上层独立上下文。测试逐卡片比较像素，并检查白色前景、平铺一致性和实际画布点击，防止整页指标掩盖局部灰层遮挡。

透明截图层的交互回归可运行 `bun run test:e2e -- hit-testing.spec.ts`。覆盖透明全屏容器、完全透明截图、可见悬浮按钮和环形透明孔洞，检查 50% / 100% / 200% 下的悬停、选中与测距。截图层按 alpha 生成缓存命中路径，透明区域不会用整块矩形挡住下层元素。

</details>

## 发布核心包

在要发布的提交上创建并推送 `vX.Y.Z` 标签，例如：

```sh
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions 从标签读取版本号，运行 core 测试和独立安装验证，然后用 npm Trusted Publishing 将通过验证的 tarball 公开发布为 `@quantacenter/page2design` 的 `latest` 版本。每个 npm 版本只能发布一次。[发布工作流](.github/workflows/publish-npm.yml)

## 核心包 API 参考

<!-- API 参考正文同步自 packages/core/README.md。 -->

### 主入口

#### 快照转换

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

##### 最小快照示例

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

#### 图层结构与 CSS

| 签名                                                        | 行为                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flattenDocument(document: DesignDocument): DesignDocument` | 返回 `structure: 'flat'`、`layout: 'absolute'` 的文档。按 `paintOrder`、`order` 排列节点，清空父子关系，将间距和图片内缩折算为固定绘制几何，并保留既有裁剪和合成边界。 |
| `nodeCss(node: DesignNode): string`                         | 返回以 `.element` 为选择器的 CSS 片段，包含节点尺寸和适用的文字、背景或边框样式。绝对定位节点另含 `left`、`top` 和 `z-index`。                                         |

原始文档可保留用于切回层级视图。平铺结果会复用部分内部数据，请把两个文档都作为不可变快照传给渲染器。

#### 坐标、缩放和测距

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

#### 投影变换

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

### DOM 采集

本节 API 从传入的浏览器 `Document` 取数据。宿主应先在目标视口完成布局，等待参与测量的字体就绪。布局采集会为元素设置 `data-page-to-design-id`，表格、伪元素和背景采集使用这些 ID 关联图层。

#### collectDomLayout

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

#### 表格、伪元素、控件和背景

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

##### 从 Document 转换

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

### Canvas 渲染

#### 资源解码与释放

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

#### CanvasRenderer

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

##### 预览、命中和导出示例

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

#### 底层绘制与命中

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

#### PreviewCache

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

### 数据模型

本节类型从主入口导入。几何字段通常相对于采集文档原点，变换相关字段保留投影前后的几何。`style` 使用连字符分隔的 CSS 属性名，例如 `'font-size'`。

#### DesignDocument

| 字段                                                           | 含义                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `version: 1`、`captureRevision?: number`                       | 数据模型版本和采集协议修订号。                                                                           |
| `id`、`title`、`capturedAt`、`url?`                            | 文档标识、标题、采集时间和可选来源地址。宿主可为输出文档补充 `url` 元数据。                              |
| `viewport`、`width`、`height`、`background`                    | 采集视口、画板宽高和画板底色。                                                                           |
| `structure?: LayerStructure`、`layout?: 'absolute'`            | 图层结构和布局模式。平铺文档带有 `layout: 'absolute'`。                                                  |
| `nodes: DesignNode[]`、`assets: Asset[]`、`fonts: FontAsset[]` | 可绘制图层与它们使用的图像、字体数据。                                                                   |
| `referenceImage`、`warnings`                                   | 内联浏览器原图（缺省为空字符串）和 `CaptureWarning[]`。                                                  |
| `stats`                                                        | `durationMs`、`nativeNodes`、`rasterNodes`、`textRuns`，分别为耗时、原生图层数、栅格图层数和文字分片数。 |

#### DesignNode

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

#### 几何、样式与资源类型

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

## 许可证

本项目采用 MIT 许可证。[查看许可证](LICENSE)

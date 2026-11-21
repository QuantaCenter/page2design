# Page to Design

Page to Design 是一个本地网页设计查看器。输入 H5 页面地址后，Playwright 会在指定视口采集页面，应用将其重绘为可查看、测距和导出的 Canvas 图层。适用于前端教学、页面结构分析和开发标注。

可以在原始 DOM 层级和绝对定位图层之间切换，检查尺寸、字体、盒模型与 CSS，并用浏览器原图对照绘制结果。

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

转换与绘制由独立工作区包 `@page-to-design/core` 提供。核心接收结构化快照或调用方提供的 `Document`，处理布局信息、设计模型和绘制。应用的服务端通过 Playwright 采集页面、资源和原图，前端负责交互与下载。[核心包 API 与集成示例](packages/core/README.md)

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

## 许可证

本项目采用 MIT 许可证。[查看许可证](LICENSE)

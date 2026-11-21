import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Eye,
  Frame,
  Hand,
  Link2,
  Minus,
  MousePointer2,
  Plus,
  Ruler,
  Scan,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import type {
  Camera,
  DesignDocument,
  DesignNode,
  LayerStructure,
  Tool,
} from '@page-to-design/core';
import { clamp } from '@page-to-design/core';
import { flattenDocument } from '@page-to-design/core';
import { CAPTURE_REVISION } from '@page-to-design/core';
import { renderToCanvas } from '@page-to-design/core/canvas';
import type { CanvasHandle } from './components/canvas/DesignCanvas';
import { useResources } from './components/canvas/useResources';
import { CanvasWorkspace } from './components/CanvasWorkspace';
import { LayerTree } from './components/LayerTree';
import { downloadDataUrl, Inspector } from './components/Inspector';

const EMPTY_IMAGES = new Map<string, HTMLImageElement>();
const EMPTY_ERRORS: string[] = [];

export default function App() {
  const [url, setUrl] = useState('');
  const [width, setWidth] = useState(390);
  const [fullPage, setFullPage] = useState(true);
  const [sourceDoc, setDocument] = useState<DesignDocument | null>(null);
  const [structure, setStructure] = useState<LayerStructure>('flat');
  const staleDocument = !!sourceDoc && sourceDoc.captureRevision !== CAPTURE_REVISION;
  const doc = useMemo(
    () =>
      sourceDoc && sourceDoc.captureRevision === CAPTURE_REVISION
        ? structure === 'flat'
          ? flattenDocument(sourceDoc)
          : { ...sourceDoc, structure }
        : null,
    [sourceDoc, structure],
  );
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, scale: 1 });
  const [referenceView, setReferenceView] = useState(false);
  const [showBoxModel, setShowBoxModel] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const resources = useResources(sourceDoc);
  const nodes = useMemo(() => new Map(doc?.nodes.map((node) => [node.id, node])), [doc]);
  const selected = selectedId ? nodes.get(selectedId) || null : null;
  const hovered = hoveredId ? nodes.get(hoveredId) || null : null;
  const target = targetId ? nodes.get(targetId) || null : null;

  const selectNode = useCallback(
    (id: string | null, measure = false) => {
      if (measure && selectedId && id && selectedId !== id) {
        setTargetId(id);
        return;
      }
      setSelectedId(id);
      setTargetId(null);
    },
    [selectedId],
  );
  const focusNode = useCallback((node: DesignNode) => canvas.current?.focus(node), []);
  const clearTarget = useCallback(() => setTargetId(null), []);
  const toggleBoxModel = useCallback(() => setShowBoxModel((previous) => !previous), []);
  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.matches('input,textarea,select,[contenteditable="true"]') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key.toLowerCase() === 'v') setTool('select');
      if (event.key.toLowerCase() === 'h') setTool('hand');
      if (event.key.toLowerCase() === 'm') setTool('measure');
      if (event.key === 'Escape') {
        setSelectedId(null);
        setTargetId(null);
        setExportMenu(false);
        setShowHelp(false);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  async function convert(input: string) {
    if (loading) return;
    let address = input.trim();
    if (!address) {
      setError('先输入一个 H5 页面地址，或点击「体验教学示例」。');
      return;
    }
    if (/^(?:localhost|127\.0\.0\.1)(?::|\/|$)/.test(address)) address = `http://${address}`;
    else if (!/^[a-z][a-z\d+.-]*:/i.test(address)) address = `https://${address}`;
    try {
      const parsed = new URL(address);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      setError('请输入有效的 HTTP 或 HTTPS 页面地址。');
      return;
    }
    setUrl(address);
    setLoading(true);
    setElapsed(0);
    setError('');
    setNotice('');
    setExportMenu(false);
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: address, width, height: 844, fullPage }),
        signal: requestController.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '页面转换失败，请稍后重试。');
      if (result.captureRevision !== CAPTURE_REVISION)
        throw new Error('采集服务尚未更新，请重启 npm run dev 后重新转换，避免显示旧版渲染结果。');
      setDocument(result as DesignDocument);
      setSelectedId(null);
      setHoveredId(null);
      setTargetId(null);
      setReferenceView(false);
      setTool('select');
      setNotice(`转换完成，已生成 ${result.nodes.length} 个图层`);
    } catch (error) {
      if ((error as Error).name !== 'AbortError')
        setError((error as Error).message || '无法连接本地采集服务。');
      else setNotice('已取消本次转换');
    } finally {
      if (controller.current === requestController) {
        controller.current = null;
        setLoading(false);
      }
    }
  }

  const demo = () => {
    void convert(`${window.location.origin}/api/demo`);
  };
  const exportJson = () => {
    if (!doc) return;
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
    );
    downloadDataUrl(objectUrl, `${doc.title}-design.json`);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setExportMenu(false);
  };
  const exportPng = () => {
    if (!doc || !resources) return;
    const output = renderToCanvas(doc, resources);
    downloadDataUrl(output.toDataURL('image/png'), `${doc.title}-canvas.png`);
    setExportMenu(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Page to Design 首页">
          <span className="brand-icon">
            <span />
            <span />
          </span>
          <strong>
            page<span>to</span>design
          </strong>
          <span className="beta-label">LAB</span>
        </a>
        <div className="header-divider" />
        <span className="header-description">网页设计实验室</span>
        <div className="header-actions">
          <span className="local-badge">
            <i />
            本地工作空间
          </span>
          <button
            className="icon-button"
            title="使用指南"
            aria-label="使用指南"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
          <div className="export-control">
            <button
              className="export-button"
              disabled={!doc || !resources}
              onClick={() => setExportMenu(!exportMenu)}
              aria-expanded={exportMenu}
            >
              <ArrowDownToLine size={15} />
              导出
              <ChevronDown size={12} />
            </button>
            {exportMenu && (
              <>
                <button
                  className="popover-dismiss"
                  aria-label="关闭导出菜单"
                  onClick={() => setExportMenu(false)}
                />
                <div className="export-popover">
                  <button onClick={exportPng}>
                    <Frame size={15} />
                    Canvas 图片<span>PNG</span>
                  </button>
                  <button onClick={exportJson}>
                    <Code2 size={15} />
                    设计文档<span>JSON</span>
                  </button>
                  <button
                    onClick={() => {
                      if (doc) downloadDataUrl(doc.referenceImage, 'browser-reference.png');
                      setExportMenu(false);
                    }}
                  >
                    <Eye size={15} />
                    浏览器原图<span>PNG</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="import-bar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void convert(url);
          }}
        >
          <label className="url-field">
            <Link2 size={16} />
            <input
              type="text"
              inputMode="url"
              aria-label="H5 页面 URL"
              placeholder="粘贴 H5 页面地址，开始探索…"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              spellCheck={false}
              autoComplete="url"
            />
            <kbd>↵</kbd>
          </label>
          <label className="viewport-select">
            <Frame size={14} />
            <select
              aria-label="画板宽度"
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            >
              <option value={375}>375 px · 移动端</option>
              <option value={390}>390 px · 移动端</option>
              <option value={430}>430 px · 移动端</option>
              <option value={768}>768 px · 平板</option>
              <option value={1440}>1440 px · 桌面端</option>
            </select>
            <ChevronDown size={12} />
          </label>
          <label className="full-page-toggle">
            <input
              type="checkbox"
              checked={fullPage}
              onChange={(event) => setFullPage(event.target.checked)}
            />
            <span>整页</span>
          </label>
          {loading ? (
            <button
              className="cancel-button"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              <Square size={12} />
              取消
            </button>
          ) : (
            <button className="primary-button convert-button" type="submit">
              <Sparkles size={15} />
              转换为设计图
              <ArrowRight size={15} />
            </button>
          )}
        </form>
        <button className="sample-link" onClick={demo} disabled={loading}>
          <BookOpen size={14} />
          教学示例
        </button>
      </div>

      <div className="editor-layout">
        <LayerTree
          key={doc?.id || 'empty'}
          document={doc}
          structure={structure}
          onStructureChange={setStructure}
          selectedId={selectedId}
          targetId={targetId}
          onSelect={selectNode}
          onFocus={focusNode}
          measuring={tool === 'measure'}
        />
        <main className="editor-main">
          <div className="editor-topline">
            <div className="document-breadcrumb">
              <Frame size={13} />
              <span>{doc ? doc.title : '未命名画板'}</span>
              <ChevronDown size={11} />
              <span className="document-kind">
                {doc ? `${doc.width} × ${doc.height}` : '开始你的第一次探索'}
              </span>
            </div>
            <div className="view-options">
              <button
                className={referenceView ? 'is-active' : ''}
                onClick={() => setReferenceView(!referenceView)}
                disabled={!doc}
                title="切换浏览器原图与 Canvas 图层"
                aria-label="切换原图对照"
                aria-pressed={referenceView}
              >
                <Eye size={14} />
                <span>原图对照</span>
              </button>
            </div>
          </div>
          <div className="canvas-area">
            <CanvasWorkspace
              ref={canvas}
              document={doc}
              images={resources?.images || EMPTY_IMAGES}
              reference={resources?.reference || null}
              ready={!!resources}
              selected={selected}
              hovered={hovered}
              measureTarget={target}
              onHover={setHoveredId}
              onSelect={selectNode}
              tool={tool}
              camera={camera}
              onCamera={setCamera}
              referenceView={referenceView}
              showBoxModel={showBoxModel && doc?.layout !== 'absolute'}
              loading={loading}
              elapsed={elapsed}
              onDemo={demo}
            />
            <div className="canvas-tools" role="toolbar" aria-label="画布工具">
              <ToolButton
                icon={<MousePointer2 size={18} />}
                name="选择工具"
                shortcut="V"
                active={tool === 'select'}
                onClick={() => setTool('select')}
              />
              <ToolButton
                icon={<Hand size={18} />}
                name="拖动工具"
                shortcut="H"
                active={tool === 'hand'}
                onClick={() => setTool('hand')}
              />
              <span />
              <ToolButton
                icon={<Ruler size={18} />}
                name="测距工具"
                shortcut="M"
                active={tool === 'measure'}
                onClick={() => {
                  setTool('measure');
                  setTargetId(null);
                }}
              />
            </div>
            {doc && (
              <div className="zoom-controls">
                <button aria-label="缩小" onClick={() => canvas.current?.zoom(camera.scale / 1.2)}>
                  <Minus size={14} />
                </button>
                <select
                  aria-label="缩放比例"
                  value={String(Math.round(camera.scale * 100))}
                  onChange={(event) =>
                    canvas.current?.zoom(clamp(Number(event.target.value) / 100, 0.1, 4))
                  }
                >
                  {![25, 50, 75, 100, 150, 200, 400].includes(Math.round(camera.scale * 100)) && (
                    <option value={Math.round(camera.scale * 100)}>
                      {Math.round(camera.scale * 100)}%
                    </option>
                  )}
                  {[25, 50, 75, 100, 150, 200, 400].map((value) => (
                    <option value={value} key={value}>
                      {value}%
                    </option>
                  ))}
                </select>
                <button aria-label="放大" onClick={() => canvas.current?.zoom(camera.scale * 1.2)}>
                  <Plus size={14} />
                </button>
                <i />
                <button
                  title="适应画布 F"
                  aria-label="适应画布"
                  onClick={() => canvas.current?.fit()}
                >
                  <Scan size={15} />
                </button>
              </div>
            )}
          </div>
          <footer className="status-bar">
            <span>
              <i className={doc ? 'status-dot ready' : 'status-dot'} />
              {loading ? `转换中 · ${elapsed}s` : doc ? '已就绪' : '等待导入网页'}
            </span>
            {doc && (
              <>
                <span className="status-separator" />
                <span>{doc.nodes.length} 个图层</span>
                <span>{doc.stats.rasterNodes} 个截图区域</span>
              </>
            )}
            <span className="status-right">
              Canvas 2D
              <span />
              为前端教学而造
            </span>
          </footer>
        </main>
        <Inspector
          document={doc}
          selected={selected}
          target={target}
          onClearTarget={clearTarget}
          showBoxModel={showBoxModel}
          onToggleBox={toggleBoxModel}
          resourceErrors={resources?.errors || EMPTY_ERRORS}
        />
      </div>

      {(error || staleDocument) && (
        <div className="notification error-notification" role="alert">
          <TriangleAlert size={19} />
          <div>
            <strong>{staleDocument ? '当前结果需要更新' : '转换未完成'}</strong>
            <p>{error || '当前结果由旧版采集服务生成，请重新转换以应用渲染修复。'}</p>
            {staleDocument && (
              <button
                className="text-button"
                onClick={() => {
                  void convert(sourceDoc!.url || url);
                }}
              >
                重新转换
              </button>
            )}
          </div>
          <button
            aria-label="关闭错误提示"
            onClick={() => {
              setError('');
              if (staleDocument) setDocument(null);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notification notice-notification" role="status">
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}
      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <section
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭使用指南"
              onClick={() => setShowHelp(false)}
            >
              <X size={18} />
            </button>
            <span className="eyebrow">QUICK START</span>
            <h2 id="help-title">从网页，到每一个细节。</h2>
            <p>粘贴可公开访问的 H5 URL，选择画板宽度后转换。也可以导入本地开发服务的页面。</p>
            <div className="help-shortcuts">
              <span>
                选择元素<kbd>V</kbd>
              </span>
              <span>
                拖动画布<kbd>H / 空格</kbd>
              </span>
              <span>
                元素间测距<kbd>M / Alt 悬停</kbd>
              </span>
              <span>
                适应画布<kbd>F</kbd>
              </span>
              <span>
                取消选择<kbd>Esc</kbd>
              </span>
              <span>
                缩放<kbd>滚轮</kbd>
              </span>
            </div>
            <div className="help-note">
              <TriangleAlert size={15} />
              <p>
                首版支持常规 DOM、文本、图片、渐变、边框与裁剪。表单控件、滤镜、CSS
                变换等复杂区域会保留为局部截图。登录态、交互过程和响应式重排暂不随设计图导入。
              </p>
            </div>
            <button className="primary-button full-width" onClick={() => setShowHelp(false)}>
              开始探索
              <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  name,
  shortcut,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? 'is-active' : ''}
      aria-label={name}
      aria-pressed={active}
      title={`${name} ${shortcut}`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

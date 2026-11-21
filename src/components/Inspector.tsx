import { memo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  ExternalLink,
  Info,
  Layers2,
  MousePointer2,
  Ruler,
  Scan,
  TriangleAlert,
} from 'lucide-react';
import type { DesignDocument, DesignNode } from '@page-to-design/core';
import { measureRects, round } from '@page-to-design/core';
import { NodeIcon } from './LayerTree';
import { nodeCss } from '@page-to-design/core';

export function downloadDataUrl(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric-field">
      <span>{label}</span>
      <b>{typeof value === 'number' ? round(value) : value}</b>
    </div>
  );
}

export const Inspector = memo(function Inspector({
  document,
  selected,
  target,
  onClearTarget,
  showBoxModel,
  onToggleBox,
  resourceErrors,
}: {
  document: DesignDocument | null;
  selected: DesignNode | null;
  target: DesignNode | null;
  onClearTarget: () => void;
  showBoxModel: boolean;
  onToggleBox: () => void;
  resourceErrors: string[];
}) {
  const [copied, setCopied] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const warnings = [
    ...(document?.warnings || []).map((warning) => warning.message),
    ...resourceErrors,
  ];
  const uniqueWarnings = [...new Set(warnings)];
  const segments = selected && target ? measureRects(selected.box, target.box) : [];
  const asset = document?.assets.find((asset) => asset.id === selected?.assetId);
  const absolute = selected?.positioning === 'absolute';
  const copyCss = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(nodeCss(selected));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <aside className="inspector-panel" aria-label="属性面板">
      <div className="inspector-tabs">
        <span className="active">开发属性</span>
        <span className="inspector-unit">CSS px</span>
      </div>
      <div className="inspector-scroll">
        {selected ? (
          <>
            <div className="node-heading">
              <span className={`node-kind-icon kind-${selected.kind}`}>
                <NodeIcon node={selected} size={19} />
              </span>
              <div>
                <strong title={selected.name}>{selected.name}</strong>
                <span>
                  {selected.tag} <i>·</i>{' '}
                  {selected.kind === 'text'
                    ? '文本'
                    : selected.kind === 'frame'
                      ? absolute
                        ? '独立图形'
                        : '容器'
                      : selected.kind === 'raster'
                        ? '截图区域'
                        : selected.kind === 'svg'
                          ? 'SVG 图形'
                          : selected.kind === 'video'
                            ? '视频帧'
                            : selected.kind === 'canvas'
                              ? 'Canvas 内容'
                              : selected.kind === 'control'
                                ? '表单控件'
                                : '图片'}
                </span>
              </div>
            </div>
            {selected.fallbackReason && (
              <div className="inline-warning">
                <TriangleAlert size={14} />
                <span>{selected.fallbackReason}</span>
              </div>
            )}
            <section className="inspector-section">
              <h2>
                位置与尺寸<span>{absolute ? '绝对定位 · px' : 'px'}</span>
              </h2>
              <div className="metric-grid">
                <Metric label="X" value={selected.box.x} />
                <Metric label="Y" value={selected.box.y} />
                <Metric label="W" value={selected.box.width} />
                <Metric label="H" value={selected.box.height} />
              </div>
              {absolute && <p className="muted-note">相对画板原点定位，宽高固定。</p>}
            </section>
            {(selected.kind === 'text' || selected.textOverflow) && (
              <section className="inspector-section">
                <h2>{selected.textOverflow ? '完整文字' : '文字'}</h2>
                <div className="text-preview" data-testid="full-text">
                  {selected.text}
                </div>
                <div className="property-row">
                  <span>字体</span>
                  <b title={selected.style['font-family']}>
                    {selected.style['font-family'].split(',')[0].replaceAll('"', '')}
                  </b>
                </div>
                <div className="metric-grid">
                  <Metric label="字号" value={selected.style['font-size']} />
                  <Metric label="字重" value={selected.style['font-weight']} />
                  <Metric label="行高" value={selected.style['line-height']} />
                  <Metric label="字距" value={selected.style['letter-spacing']} />
                </div>
                <ColorRow label="颜色" color={selected.style.color} />
                {selected.textOverflow && (
                  <div data-testid="text-overflow-info">
                    <div className="property-row">
                      <span>省略方式</span>
                      <b>
                        {selected.textOverflow.mode === 'ellipsis'
                          ? '单行省略'
                          : `${selected.textOverflow.maxLines} 行省略`}
                      </b>
                    </div>
                    {selected.textOverflow.visibleText !== undefined && (
                      <>
                        <p className="muted-note">画布显示的文字</p>
                        <div className="text-preview" data-testid="visible-text">
                          {selected.textOverflow.visibleText}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}
            {selected.kind !== 'text' && (
              <section className="inspector-section">
                <h2>外观</h2>
                <ColorRow
                  label="填充"
                  color={
                    selected.skipBackground ? 'transparent' : selected.style['background-color']
                  }
                />
                <div className="property-row">
                  <span>圆角</span>
                  <b>{selected.radius.map((value) => round(value)).join(' / ')}</b>
                </div>
                <div className="property-row">
                  <span>透明度</span>
                  <b>{round(selected.opacity * 100)}%</b>
                </div>
                {!absolute && selected.style['display'] && (
                  <div className="property-row">
                    <span>布局</span>
                    <b>{selected.style.display}</b>
                  </div>
                )}
                {!absolute && selected.style.gap && selected.style.gap !== 'normal' && (
                  <div className="property-row">
                    <span>Gap</span>
                    <b>{selected.style.gap}</b>
                  </div>
                )}
              </section>
            )}
            {absolute ? (
              <section className="inspector-section" data-testid="absolute-layout-info">
                <h2>独立根图层</h2>
                <div className="property-row">
                  <span>定位</span>
                  <b>absolute</b>
                </div>
                <div className="property-row">
                  <span>布局约束</span>
                  <b>无</b>
                </div>
                <div className="property-row">
                  <span>叠放顺序</span>
                  <b>{selected.style['z-index']}</b>
                </div>
                <p className="muted-note">
                  元素各自使用固定 X / Y / W / H；间距只作为几何距离测量，画板缩放不触发布局重排。
                </p>
              </section>
            ) : (
              <section className="inspector-section">
                <h2>
                  盒模型
                  <button
                    className={`small-icon ${showBoxModel ? 'is-active' : ''}`}
                    onClick={onToggleBox}
                    aria-label="切换盒模型显示"
                    title="在画布显示盒模型"
                  >
                    <Scan size={14} />
                  </button>
                </h2>
                <div className="box-margin">
                  <span className="box-label">margin</span>
                  <span className="box-top">{round(selected.margin.top)}</span>
                  <span className="box-left">{round(selected.margin.left)}</span>
                  <span className="box-right">{round(selected.margin.right)}</span>
                  <span className="box-bottom">{round(selected.margin.bottom)}</span>
                  <div className="box-padding">
                    <span className="box-label">padding</span>
                    <span className="box-top">{round(selected.padding.top)}</span>
                    <span className="box-left">{round(selected.padding.left)}</span>
                    <span className="box-right">{round(selected.padding.right)}</span>
                    <span className="box-bottom">{round(selected.padding.bottom)}</span>
                    <div className="box-content">
                      {round(selected.contentBox.width)} × {round(selected.contentBox.height)}
                    </div>
                  </div>
                </div>
              </section>
            )}
            {target && (
              <section
                className="inspector-section measurement-section"
                data-testid="measurement-panel"
              >
                <h2>
                  <Ruler size={14} />
                  元素测距
                  <button className="text-button" onClick={onClearTarget}>
                    清除
                  </button>
                </h2>
                <div className="measurement-names">
                  <span>{selected.name}</span>
                  <ArrowRight size={12} />
                  <span>{target.name}</span>
                </div>
                {segments.length ? (
                  segments.map((segment, index) => (
                    <div className="property-row" key={index}>
                      <span>{segment.axis === 'x' ? '水平距离' : '垂直距离'}</span>
                      <b className="measurement-value">{round(segment.value)} px</b>
                    </div>
                  ))
                ) : (
                  <p className="muted-note">两个元素发生重叠，边界间距为 0 px。</p>
                )}
              </section>
            )}
            {selected.control && (
              <section className="inspector-section" data-testid="control-info">
                <h2>表单控件</h2>
                <div className="property-row">
                  <span>类型</span>
                  <b>{selected.control.type}</b>
                </div>
                <div className="text-preview">
                  {selected.control.value || selected.control.placeholder || '空值'}
                </div>
                {selected.control.checked !== undefined && (
                  <div className="property-row">
                    <span>选中状态</span>
                    <b>
                      {selected.control.indeterminate
                        ? '半选'
                        : selected.control.checked
                          ? '已选中'
                          : '未选中'}
                    </b>
                  </div>
                )}
                <div className="property-row">
                  <span>状态</span>
                  <b>
                    {selected.control.disabled
                      ? '禁用'
                      : selected.control.readOnly
                        ? '只读'
                        : '正常'}
                  </b>
                </div>
              </section>
            )}
            {selected.transform && selected.localBox && (
              <section className="inspector-section" data-testid="transform-info">
                <h2>变换</h2>
                <div className="property-row">
                  <span>类型</span>
                  <b>
                    {Math.abs(selected.transform[6]) + Math.abs(selected.transform[7]) > 1e-10
                      ? '透视投影'
                      : '二维矩阵'}
                  </b>
                </div>
                <div className="metric-grid">
                  <Metric label="原宽" value={selected.localBox.width} />
                  <Metric label="原高" value={selected.localBox.height} />
                </div>
                <p className="muted-note">
                  位置与尺寸显示变换后的外接范围，内容和命中保留实际变换。
                </p>
              </section>
            )}
            {selected.video && (
              <section className="inspector-section" data-testid="video-info">
                <h2>视频帧</h2>
                <div className="metric-grid">
                  <Metric label="时间" value={`${round(selected.video.currentTime, 2)} s`} />
                  <Metric
                    label="时长"
                    value={
                      selected.video.duration === undefined
                        ? '未知'
                        : `${round(selected.video.duration, 2)} s`
                    }
                  />
                  <Metric label="原宽" value={selected.video.width} />
                  <Metric label="原高" value={selected.video.height} />
                </div>
                <p className="muted-note">记录采集时的当前帧，保留独立视频图层。</p>
              </section>
            )}
            {asset && (
              <section className="inspector-section">
                <h2>素材</h2>
                <div className="asset-preview">
                  <img src={asset.dataUrl} alt="当前图层素材" />
                </div>
                <button
                  className="secondary-button full-width"
                  onClick={() =>
                    downloadDataUrl(
                      asset.dataUrl,
                      `${selected.id}.${asset.mime.includes('svg') ? 'svg' : asset.mime.includes('jpeg') ? 'jpg' : 'png'}`,
                    )
                  }
                >
                  <ArrowDownToLine size={14} />
                  导出素材
                </button>
              </section>
            )}
            <section className="inspector-section">
              <h2>
                <Code2 size={14} />
                CSS
                <button className="text-button" onClick={copyCss}>
                  {copied ? <Check size={12} /> : <Clipboard size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </h2>
              <pre className="css-code">{nodeCss(selected)}</pre>
              <p className="muted-note">
                {absolute
                  ? '使用固定像素的绝对定位，无 Flex / Grid 或自适应约束。'
                  : '当前快照下的等效样式，供教学参考。'}
              </p>
            </section>
          </>
        ) : (
          <>
            <div className="inspector-empty">
              <span className="inspector-empty-icon">
                <MousePointer2 size={24} strokeWidth={1.4} />
              </span>
              <strong>从一个元素开始</strong>
              <p>
                点击画布或左侧图层
                <br />
                查看它的尺寸、样式与间距
              </p>
            </div>
            <div className="inspector-guide">
              <span>探索方式</span>
              <div>
                <b>01</b>
                <p>
                  点击元素<strong>查看开发属性</strong>
                </p>
              </div>
              <div>
                <b>02</b>
                <p>
                  按住 Alt 悬停<strong>测量元素间距</strong>
                </p>
              </div>
              <div>
                <b>03</b>
                <p>
                  滚轮与空格<strong>自由探索画布</strong>
                </p>
              </div>
            </div>
            {document && (
              <section className="inspector-section document-overview">
                <h2>
                  当前画板
                  <Layers2 size={14} />
                </h2>
                <div className="property-row">
                  <span>尺寸</span>
                  <b>
                    {document.width} × {document.height}
                  </b>
                </div>
                <div className="property-row">
                  <span>原生节点</span>
                  <b>{document.stats.nativeNodes}</b>
                </div>
                <div className="property-row">
                  <span>文字分片</span>
                  <b>{document.stats.textRuns}</b>
                </div>
                <div className="property-row">
                  <span>图片资源</span>
                  <b>{document.assets.length}</b>
                </div>
                <div className="property-row">
                  <span>转换耗时</span>
                  <b>{(document.stats.durationMs / 1000).toFixed(1)} s</b>
                </div>
                <a className="source-link" href={document.url} target="_blank" rel="noreferrer">
                  打开源网页
                  <ExternalLink size={12} />
                </a>
              </section>
            )}
          </>
        )}
        {!!uniqueWarnings.length && (
          <div className="capture-warnings">
            <button onClick={() => setShowWarnings(!showWarnings)}>
              <TriangleAlert size={14} />
              <span>
                {document?.stats.rasterNodes || 0} 个截图区域 · {uniqueWarnings.length} 条说明
              </span>
              {showWarnings ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {showWarnings && (
              <ul>
                {uniqueWarnings.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="inspector-footer">
        <Info size={12} />
        <span>布局由浏览器采集，内容由 Canvas 绘制</span>
      </div>
    </aside>
  );
});

function ColorRow({ label, color }: { label: string; color: string }) {
  const transparent = !color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent';
  return (
    <div className="property-row color-row">
      <span>{label}</span>
      <b>
        <i className={transparent ? 'transparent-swatch' : ''} style={{ backgroundColor: color }} />
        {transparent ? '透明' : color}
      </b>
    </div>
  );
}

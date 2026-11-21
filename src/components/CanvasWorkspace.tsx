import { forwardRef } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Command,
  Frame,
  Hand,
  MousePointer2,
  Ruler,
  Scan,
  Sparkles,
} from 'lucide-react';
import { DesignCanvas, type CanvasHandle, type CanvasProps } from './canvas/DesignCanvas';

interface Props extends CanvasProps {
  loading: boolean;
  elapsed: number;
  onDemo: () => void;
}

export const CanvasWorkspace = forwardRef<CanvasHandle, Props>(
  function CanvasWorkspace(props, ref) {
    const { document: doc, ready, referenceView, tool, selected, measureTarget } = props;
    return (
      <DesignCanvas
        {...props}
        ref={ref}
        className="canvas-workspace"
        keyboardScope="global"
        ariaLabel="设计画布，可通过左侧图层列表选择元素"
      >
        {!doc && !props.loading && (
          <div className="canvas-empty">
            <div className="empty-composition" aria-hidden="true">
              <div className="empty-grid">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="empty-frame">
                <div className="empty-frame-top">
                  <span />
                  <span />
                </div>
                <div className="empty-frame-picture">
                  <Sparkles size={29} strokeWidth={1.5} />
                </div>
                <i />
                <i />
              </div>
              <span className="empty-dimension dimension-top">390 px</span>
              <span className="empty-dimension dimension-right">设计，从网页开始</span>
              <span className="empty-cursor">
                <MousePointer2 size={22} fill="#7360e8" />
                <b>Canvas</b>
              </span>
            </div>
            <span className="eyebrow">A LITTLE CLOSER TO THE WEB</span>
            <h1>每一个网页，都值得拆开看看。</h1>
            <p>
              输入 H5 地址，把界面转换成可探索的 Canvas 图层。
              <br />
              从一个间距、一段文字，读懂页面的构成。
            </p>
            <button className="primary-button demo-button" onClick={props.onDemo}>
              <Sparkles size={16} />
              体验教学示例
              <ArrowUpRight size={16} />
            </button>
            <div className="empty-features">
              <span>
                <Frame size={14} />
                独立图层
              </span>
              <span>
                <Ruler size={14} />
                精确测距
              </span>
              <span>
                <Scan size={14} />
                样式查看
              </span>
            </div>
          </div>
        )}
        {doc && (
          <>
            {ready && (
              <div className="canvas-view-label">
                <i className={referenceView ? 'reference-dot' : ''} />
                {referenceView ? '浏览器原图' : '原生 Canvas 图层'}
              </div>
            )}
            <div className="canvas-shortcuts">
              <span>
                <Command size={11} />
                滚轮缩放
              </span>
              <span>
                <Hand size={11} />
                空格拖动
              </span>
              <span>
                <ArrowDownRight size={11} />
                Alt 悬停测距
              </span>
            </div>
            {tool === 'measure' && (
              <div className="measure-instruction">
                <Ruler size={14} />
                {!selected
                  ? '选择第一个元素，作为测距起点'
                  : !measureTarget
                    ? '再选择一个元素，查看两者间距'
                    : '已固定测距对象 · 点击其他元素更新'}
              </div>
            )}
          </>
        )}
        {(props.loading || (doc && !ready)) && (
          <div className="canvas-loading">
            <div className="loading-card">
              <span className="loading-orbit">
                <Frame size={22} />
              </span>
              <strong>{props.loading ? '正在拆解页面' : '正在加载画布资源'}</strong>
              <p>
                {props.loading
                  ? `浏览器采集与图层转换中 · ${props.elapsed} 秒`
                  : '准备图片、字体和独立图层'}
              </p>
              <div className="loading-track">
                <i />
              </div>
            </div>
          </div>
        )}
      </DesignCanvas>
    );
  },
);

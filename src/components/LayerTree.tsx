import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Frame,
  Image,
  Layers2,
  List,
  ListTree,
  Search,
  Type,
  VectorSquare,
  Video,
  SquareCheck,
  Wallpaper,
} from 'lucide-react';
import type { DesignDocument, DesignNode, LayerStructure } from '@page-to-design/core';

export function NodeIcon({ node, size = 14 }: { node: DesignNode; size?: number }) {
  const Icon =
    node.kind === 'text'
      ? Type
      : node.kind === 'svg'
        ? VectorSquare
        : node.kind === 'raster'
          ? Wallpaper
          : node.kind === 'image' || node.kind === 'canvas'
            ? Image
            : node.kind === 'video'
              ? Video
              : node.kind === 'control'
                ? SquareCheck
                : Frame;
  return <Icon size={size} strokeWidth={1.6} />;
}

export const LayerTree = memo(function LayerTree({
  document,
  structure,
  onStructureChange,
  selectedId,
  targetId,
  onSelect,
  onFocus,
  measuring,
}: {
  document: DesignDocument | null;
  selectedId: string | null;
  targetId: string | null;
  structure: LayerStructure;
  onStructureChange: (structure: LayerStructure) => void;
  onSelect: (id: string, measure?: boolean) => void;
  onFocus: (node: DesignNode) => void;
  measuring: boolean;
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const list = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(600);
  const flat = structure === 'flat';
  const nodesById = useMemo(
    () => new Map(document?.nodes.map((node) => [node.id, node])),
    [document],
  );
  const visible = useMemo(() => {
    const rows: { node: DesignNode; depth: number }[] = [];
    const add = (node: DesignNode, depth: number) => {
      rows.push({ node, depth });
      if (!collapsed.has(node.id))
        for (const id of node.children) {
          const child = nodesById.get(id);
          if (child) add(child, depth + 1);
        }
    };
    const search = query.trim().toLowerCase();
    if (search) {
      for (const node of document?.nodes || [])
        if (`${node.name} ${node.tag} ${node.text || ''}`.toLowerCase().includes(search))
          rows.push({ node, depth: 0 });
    } else if (flat) {
      for (const node of document?.nodes || []) rows.push({ node, depth: 0 });
    } else {
      const roots = document?.nodes.filter((node) => node.tag === 'body') || [];
      for (const root of roots.length
        ? roots
        : document?.nodes.filter((node) => !node.parentId) || [])
        add(root, 0);
    }
    return rows;
  }, [document, nodesById, collapsed, flat, query]);
  const virtual = visible.length > 500;
  const start = virtual
    ? Math.max(0, Math.min(visible.length - 1, Math.floor(scrollTop / 32) - 8))
    : 0;
  const end = virtual
    ? Math.min(visible.length, start + Math.ceil(listHeight / 32) + 16)
    : visible.length;
  useEffect(() => {
    if (!list.current) return;
    const observer = new ResizeObserver(() => setListHeight(list.current?.clientHeight || 600));
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [document?.id]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    // Synchronize virtual rows with the scroll position reset on the DOM element.
    // oxlint-disable-next-line react/set-state-in-effect
    setScrollTop(0);
  }, [query, flat]);
  useEffect(() => {
    if (!virtual || !selectedId || !list.current) return;
    const index = visible.findIndex((row) => row.node.id === selectedId);
    if (index < 0) return;
    const element = list.current;
    const top = index * 32 + 7;
    if (top < element.scrollTop) element.scrollTop = top - 7;
    else if (top + 32 > element.scrollTop + element.clientHeight)
      element.scrollTop = top + 32 - element.clientHeight;
    setScrollTop(element.scrollTop);
  }, [selectedId, visible, virtual]);

  return (
    <aside className="layers-panel" aria-label="图层列表">
      <div className="panel-heading">
        <span>图层</span>
        <span className="count-badge">{document?.nodes.length || 0}</span>
        <Layers2 size={15} />
      </div>
      <div className="layer-structure-switch" role="group" aria-label="图层结构">
        <button
          className={flat ? 'is-active' : ''}
          aria-label="平铺结构"
          aria-pressed={flat}
          title="每个元素都是根图层，使用画板绝对坐标和固定像素定位，导出文档同步打平"
          onClick={() => onStructureChange('flat')}
        >
          <List size={13} />
          绝对平铺
        </button>
        <button
          className={!flat ? 'is-active' : ''}
          aria-label="原始层级"
          aria-pressed={!flat}
          title="恢复网页的原始父子层级"
          onClick={() => onStructureChange('hierarchical')}
        >
          <ListTree size={13} />
          原始层级
        </button>
      </div>
      <label className="layer-search">
        <Search size={14} />
        <input
          aria-label="搜索图层"
          placeholder="搜索图层…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>⌕</kbd>
      </label>
      {document ? (
        <>
          <div className="artboard-heading">
            <Frame size={14} />
            <span>{document.viewport.width < 768 ? '移动端' : '桌面端'}画板</span>
            <span>{document.width}</span>
          </div>
          <div
            ref={list}
            className="layer-list"
            role="tree"
            aria-label="页面图层"
            data-structure={structure}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div
              style={virtual ? { height: visible.length * 32, position: 'relative' } : undefined}
            >
              {visible.slice(start, end).map(({ node, depth }, offset) => (
                <div
                  key={node.id}
                  className={`layer-row ${selectedId === node.id ? 'is-selected' : ''} ${targetId === node.id ? 'is-target' : ''}`}
                  style={{
                    paddingLeft: 10 + Math.min(depth, 10) * 13,
                    ...(virtual
                      ? { position: 'absolute', top: (start + offset) * 32, width: '100%' }
                      : {}),
                  }}
                >
                  {!flat && (
                    <button
                      className={`layer-chevron ${!node.children.length ? 'is-leaf' : ''}`}
                      tabIndex={node.children.length ? 0 : -1}
                      aria-label={`${collapsed.has(node.id) ? '展开' : '折叠'} ${node.name}`}
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(node.id)) next.delete(node.id);
                          else next.add(node.id);
                          return next;
                        })
                      }
                    >
                      {collapsed.has(node.id) ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </button>
                  )}
                  <button
                    className="layer-item"
                    role="treeitem"
                    aria-selected={selectedId === node.id}
                    aria-level={depth + 1}
                    aria-setsize={flat || query.trim() ? visible.length : undefined}
                    aria-posinset={flat || query.trim() ? start + offset + 1 : undefined}
                    aria-expanded={
                      !flat && node.children.length ? !collapsed.has(node.id) : undefined
                    }
                    data-testid={`layer-${node.id}`}
                    title={`${node.name} · ${node.tag}`}
                    onClick={(event) => onSelect(node.id, measuring || event.altKey)}
                    onDoubleClick={() => onFocus(node)}
                  >
                    <NodeIcon node={node} />
                    <span>{node.name}</span>
                    {node.kind === 'raster' && <i className="raster-indicator" title="局部截图" />}
                  </button>
                </div>
              ))}
            </div>
            {!visible.length && <p className="no-results">没有匹配的图层</p>}
          </div>
          <div className="layers-footer">
            <i />
            {document.stats.nativeNodes} 个原生节点
            <span>{document.stats.rasterNodes} 个截图区域</span>
          </div>
        </>
      ) : (
        <div className="layers-empty">
          <Layers2 size={24} strokeWidth={1.3} />
          <strong>图层将在这里出现</strong>
          <p>
            导入一个网页
            <br />
            探索它的界面结构
          </p>
          <div className="skeleton-tree">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      )}
    </aside>
  );
});

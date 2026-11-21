export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type TransformMatrix = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface Clip extends Rect {
  radius: number[];
  radiusY?: number[];
  ownerId?: string;
  localBox?: Rect;
  transform?: TransformMatrix;
}
export interface BorderLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  style: string;
}
export type NodeKind =
  | 'frame'
  | 'text'
  | 'image'
  | 'video'
  | 'canvas'
  | 'control'
  | 'svg'
  | 'raster';
export type LayerStructure = 'hierarchical' | 'flat';

export interface TextRun extends Rect {
  text: string;
  baseline: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: number;
  color: string;
  decoration: string;
  textShadow?: string;
  fontKerning?: 'normal' | 'none';
  language?: string;
  generated?: 'ellipsis';
}

export interface TextOverflowInfo {
  mode: 'ellipsis' | 'line-clamp';
  maxLines: number;
  truncated: boolean;
  visibleText?: string;
}

export interface CompositingGroup {
  id: string;
  opacity: number;
  filter?: string;
  backdropFilter?: string;
  blendMode?: string;
  isolate?: boolean;
  clipPath?: boolean;
  mask?: boolean;
}
export interface CssImage {
  image: string;
  url?: string;
  assetId?: string;
  resolution?: number;
  crossFade?: { weight: number; source: CssImage }[];
}
export interface BackgroundLayer extends CssImage {
  box: Rect;
  clip: Clip;
  /** Local backgrounds also stay inside their container's stationary scrollport. */
  scrollClip?: Clip;
  /** A viewport-fixed image is painted only within the captured viewport. */
  imageClip?: Rect;
  style: Record<string, string>;
}
export interface MaskLayer extends BackgroundLayer {
  mode: 'alpha' | 'luminance' | 'match-source';
  composite: 'add' | 'subtract' | 'intersect' | 'exclude';
  noClip?: boolean;
}
export interface ShapeClip {
  ownerId: string;
  value: string;
  box: Clip;
  transform?: TransformMatrix;
}

export interface DesignNode {
  id: string;
  parentId: string | null;
  children: string[];
  kind: NodeKind;
  positioning?: 'absolute';
  name: string;
  tag: string;
  box: Rect;
  /** Geometry before CSS transforms; matrix maps these document coordinates to the artboard. */
  localBox?: Rect;
  localVisualBox?: Rect;
  transform?: TransformMatrix;
  captureSourceId?: string;
  contentBox: Rect;
  /** Fixed drawing rectangle for an image whose source padding was baked in. */
  imageBox?: Rect;
  /** Fixed CSS background positioning / painting areas, independent of layout. */
  backgroundBox?: Rect;
  backgroundClip?: Clip;
  /** Ink overflow used for viewport culling; selection remains the border box. */
  visualBox?: Rect;
  paintBox?: Rect;
  backgroundAreas?: Clip[];
  skipBackground?: boolean;
  /** The element's background was propagated to the document canvas. Shadows remain. */
  skipBoxBackground?: boolean;
  /** A separate native paint layer for the HTML document canvas background. */
  canvasBackground?: { source: 'html' | 'body'; area: Rect };
  skipBorders?: boolean;
  lines?: BorderLine[];
  padding: Insets;
  margin: Insets;
  border: Insets;
  radius: number[];
  /** Vertical corner radii when CSS uses elliptical corners. */
  radiusY?: number[];
  opacity: number;
  /** Ordered isolation groups, retained even when layout hierarchy is flattened. */
  opacityGroups?: { id: string; opacity: number }[];
  /** Native effect boundaries, independent of the editable layout hierarchy. */
  compositingGroups?: CompositingGroup[];
  pseudoElement?: '::before' | '::after';
  video?: {
    currentTime: number;
    duration?: number;
    width: number;
    height: number;
    source?: string;
    poster?: string;
  };
  canvas?: { width: number; height: number };
  control?: {
    type: string;
    value: string;
    placeholder?: string;
    checked?: boolean;
    indeterminate?: boolean;
    disabled: boolean;
    readOnly?: boolean;
    min?: number;
    max?: number;
    step?: number;
    multiple?: boolean;
    size?: number;
    options?: { label: string; selected: boolean; disabled: boolean }[];
    scrollTop?: number;
    scrollLeft?: number;
    focused?: boolean;
    placeholderColor?: string;
    placeholderOpacity?: number;
    accentColor?: string;
    textRuns?: TextRun[];
    parts?: { role: string; box: Rect; style: Record<string, string> }[];
  };
  controlBox?: Rect;
  clips: Clip[];
  style: Record<string, string>;
  text?: string;
  runs?: TextRun[];
  textOverflow?: TextOverflowInfo;
  assetId?: string;
  assetUrl?: string;
  svgSource?: string;
  backgroundAssetId?: string;
  backgroundUrl?: string;
  backgroundLayers?: BackgroundLayer[];
  maskLayers?: MaskLayer[];
  clipPath?: ShapeClip;
  /** Ancestor clipping paths retained for hit testing after flattening. */
  clipPaths?: ShapeClip[];
  fallbackReason?: string;
  rasterBox?: Rect;
  rasterMode?: 'isolated' | 'composited';
  order: number;
  paintOrder: number;
  hasVisual: boolean;
}

export interface Asset {
  id: string;
  /** Optional source metadata; drawing only uses dataUrl. */
  url?: string;
  dataUrl: string;
  mime: string;
  width?: number;
  height?: number;
}

export interface FontAsset {
  family: string;
  style: string;
  weight: string;
  unicodeRange?: string;
  dataUrl: string;
}

export interface CaptureWarning {
  code: string;
  message: string;
  nodeId?: string;
}
export interface DesignDocument {
  version: 1;
  captureRevision?: number;
  structure?: LayerStructure;
  layout?: 'absolute';
  id: string;
  title: string;
  /** Optional provenance supplied by a host, never used to acquire a page. */
  url?: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  width: number;
  height: number;
  background: string;
  nodes: DesignNode[];
  assets: Asset[];
  fonts: FontAsset[];
  referenceImage: string;
  warnings: CaptureWarning[];
  stats: { durationMs: number; nativeNodes: number; rasterNodes: number; textRuns: number };
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}
export type Tool = 'select' | 'hand' | 'measure';

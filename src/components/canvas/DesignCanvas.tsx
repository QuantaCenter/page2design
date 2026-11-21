import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import {
  fitCamera,
  measureRects,
  projectPoint,
  round,
  zoomAt,
  type Camera,
  type DesignDocument,
  type DesignNode,
  type Tool,
} from '@page-to-design/core';
import { PreviewLayer } from './PreviewLayer';

export interface CanvasHandle {
  fit: () => void;
  zoom: (scale: number) => void;
  focus: (node: DesignNode) => void;
}
export interface CanvasProps {
  document: DesignDocument | null;
  images: Map<string, HTMLImageElement>;
  reference: HTMLImageElement | null;
  ready: boolean;
  selected: DesignNode | null;
  hovered: DesignNode | null;
  measureTarget: DesignNode | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null, measure?: boolean) => void;
  tool: Tool;
  camera: Camera;
  onCamera: (camera: Camera) => void;
  referenceView: boolean;
  showBoxModel: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  ariaLabel?: string;
  keyboardScope?: 'focused' | 'global';
}

export const DesignCanvas = forwardRef<CanvasHandle, CanvasProps>(
  function DesignCanvas(props, ref) {
    const {
      document: doc,
      images,
      reference,
      ready,
      selected,
      hovered,
      measureTarget,
      onHover,
      onSelect,
      tool,
      camera,
      onCamera,
      referenceView,
      showBoxModel,
    } = props;
    const container = useRef<HTMLDivElement>(null);
    const stage = useRef<Konva.Stage>(null);
    const [size, setSize] = useState({ width: 800, height: 700 });
    const [space, setSpace] = useState(false);
    const [alt, setAlt] = useState(false);
    const [panning, setPanning] = useState(false);
    const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null);
    const wasDragged = useRef(false);
    const fittedDocument = useRef<string | null>(null);
    const sizeRef = useRef(size);
    sizeRef.current = size;
    const pendingCamera = useRef<Camera | null>(null);
    const cameraFrame = useRef<number | null>(null);
    const flushCamera = useCallback(() => {
      if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
      cameraFrame.current = null;
      const next = pendingCamera.current;
      pendingCamera.current = null;
      if (next) onCamera(next);
    }, [onCamera]);
    const queueCamera = useCallback(
      (next: Camera) => {
        pendingCamera.current = next;
        if (cameraFrame.current === null) cameraFrame.current = requestAnimationFrame(flushCamera);
      },
      [flushCamera],
    );
    const commitCamera = useCallback(
      (next: Camera) => {
        if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
        cameraFrame.current = null;
        pendingCamera.current = null;
        onCamera(next);
      },
      [onCamera],
    );
    useEffect(
      () => () => {
        if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
      },
      [],
    );

    useEffect(() => {
      if (!container.current) return;
      const observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        setSize({ width, height });
      });
      observer.observe(container.current);
      return () => observer.disconnect();
    }, []);

    const fit = useCallback(() => {
      if (doc) commitCamera(fitCamera(doc, sizeRef.current));
    }, [doc, commitCamera]);
    useEffect(() => {
      if (doc && size.width > 100 && ready && fittedDocument.current !== doc.id) {
        fittedDocument.current = doc.id;
        commitCamera(fitCamera(doc, size));
      }
    }, [doc, ready, size, commitCamera]);

    useImperativeHandle(
      ref,
      () => ({
        fit,
        zoom: (scale) =>
          commitCamera(zoomAt(camera, { x: size.width / 2, y: size.height / 2 }, scale)),
        focus: (node) => {
          const scale = Math.max(
            camera.scale,
            Math.min(
              1.5,
              (size.width - 120) / Math.max(node.box.width, 100),
              (size.height - 120) / Math.max(node.box.height, 100),
            ),
          );
          commitCamera({
            x: size.width / 2 - (node.box.x + node.box.width / 2) * scale,
            y: size.height / 2 - (node.box.y + node.box.height / 2) * scale,
            scale,
          });
        },
      }),
      [camera, fit, commitCamera, size],
    );

    useEffect(() => {
      const keydown = (event: KeyboardEvent) => {
        if (
          props.keyboardScope !== 'global' &&
          !container.current?.contains(window.document.activeElement)
        )
          return;
        if (
          (event.target as HTMLElement)?.matches('input,textarea,select,[contenteditable="true"]')
        )
          return;
        if (event.code === 'Space') {
          event.preventDefault();
          setSpace(true);
        }
        if (event.key === 'Alt') {
          event.preventDefault();
          setAlt(true);
        }
        if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey) fit();
      };
      const keyup = (event: KeyboardEvent) => {
        if (event.code === 'Space') setSpace(false);
        if (event.key === 'Alt') setAlt(false);
      };
      const release = () => {
        drag.current = null;
        flushCamera();
        setPanning(false);
      };
      const blur = () => {
        release();
        setAlt(false);
        setSpace(false);
      };
      window.addEventListener('keydown', keydown);
      window.addEventListener('keyup', keyup);
      window.addEventListener('mouseup', release);
      window.addEventListener('blur', blur);
      return () => {
        window.removeEventListener('keydown', keydown);
        window.removeEventListener('keyup', keyup);
        window.removeEventListener('mouseup', release);
        window.removeEventListener('blur', blur);
      };
    }, [fit, flushCamera, props.keyboardScope]);

    const target =
      measureTarget ||
      ((alt || tool === 'measure') && hovered?.id !== selected?.id ? hovered : null);
    const segments = selected && target ? measureRects(selected.box, target.box) : [];
    const inverse = 1 / camera.scale;
    const padding = selected?.padding;
    const selectionBox = selected?.box;

    return (
      <div
        className={`${props.className || ''} ${space || tool === 'hand' ? 'is-hand' : ''} ${panning ? 'is-panning' : ''}`}
        ref={container}
        data-testid="design-canvas"
        data-camera={JSON.stringify(camera)}
        data-document-width={doc?.width}
        data-document-height={doc?.height}
        data-hovered-id={hovered?.id || ''}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
          outline: 'none',
          cursor: panning ? 'grabbing' : space || tool === 'hand' ? 'grab' : 'default',
          ...props.style,
        }}
        tabIndex={0}
        role="application"
        aria-label={props.ariaLabel || '设计画布'}
        onContextMenu={(event) => event.preventDefault()}
      >
        {doc && (
          <>
            <Stage
              ref={stage}
              width={size.width}
              height={size.height}
              onWheel={(event) => {
                event.evt.preventDefault();
                const point = event.target.getStage()?.getPointerPosition();
                const current = pendingCamera.current || camera;
                if (point)
                  queueCamera(
                    zoomAt(current, point, current.scale * Math.exp(-event.evt.deltaY * 0.0015)),
                  );
              }}
              onMouseDown={(event) => {
                if (tool === 'hand' || space || event.evt.button === 1) {
                  event.evt.preventDefault();
                  drag.current = {
                    x: event.evt.clientX,
                    y: event.evt.clientY,
                    camera: pendingCamera.current || camera,
                  };
                  wasDragged.current = false;
                  setPanning(true);
                } else wasDragged.current = false;
              }}
              onMouseMove={(event) => {
                if (drag.current) {
                  const dx = event.evt.clientX - drag.current.x;
                  const dy = event.evt.clientY - drag.current.y;
                  if (Math.abs(dx) + Math.abs(dy) > 3) wasDragged.current = true;
                  queueCamera({
                    ...drag.current.camera,
                    x: drag.current.camera.x + dx,
                    y: drag.current.camera.y + dy,
                  });
                } else {
                  onHover((event.target as Konva.Node).getAttr('designId') || null);
                }
              }}
              onMouseLeave={() => onHover(null)}
              onClick={(event) => {
                if (wasDragged.current || space || tool === 'hand' || event.evt.button !== 0)
                  return;
                onSelect(
                  (event.target as Konva.Node).getAttr('designId') || null,
                  tool === 'measure' || event.evt.altKey,
                );
              }}
            >
              <PreviewLayer
                document={doc}
                images={images}
                reference={reference}
                ready={ready}
                camera={camera}
                width={size.width}
                height={size.height}
                referenceView={referenceView}
                interactive={!panning && !space && tool !== 'hand'}
              />
              <Layer listening={false}>
                <Group x={camera.x} y={camera.y} scaleX={camera.scale} scaleY={camera.scale}>
                  <Text
                    text={`${doc.title.slice(0, 28)}  /  ${doc.width} × ${doc.height}`}
                    x={0}
                    y={-24 * inverse}
                    fontSize={11 * inverse}
                    fill="#7b8294"
                    fontFamily="Inter, system-ui"
                  />
                  {hovered && hovered.id !== selected?.id && (
                    <Rect
                      {...hovered.box}
                      stroke="#9685e9"
                      strokeWidth={1 * inverse}
                      fill="#8b75eb0b"
                    />
                  )}
                  {selected && (
                    <>
                      {showBoxModel &&
                      padding &&
                      selectionBox &&
                      selected.transform &&
                      selected.localBox ? (
                        <>
                          <Line
                            closed
                            points={[
                              [selected.localBox.x, selected.localBox.y],
                              [selected.localBox.x + selected.localBox.width, selected.localBox.y],
                              [
                                selected.localBox.x + selected.localBox.width,
                                selected.localBox.y + selected.localBox.height,
                              ],
                              [selected.localBox.x, selected.localBox.y + selected.localBox.height],
                            ].flatMap(([x, y]) => {
                              const point = projectPoint(selected.transform!, { x, y });
                              return [point.x, point.y];
                            })}
                            fill="#6dc99725"
                          />
                          <Line
                            closed
                            points={[
                              [selected.contentBox.x, selected.contentBox.y],
                              [
                                selected.contentBox.x + selected.contentBox.width,
                                selected.contentBox.y,
                              ],
                              [
                                selected.contentBox.x + selected.contentBox.width,
                                selected.contentBox.y + selected.contentBox.height,
                              ],
                              [
                                selected.contentBox.x,
                                selected.contentBox.y + selected.contentBox.height,
                              ],
                            ].flatMap(([x, y]) => {
                              const point = projectPoint(selected.transform!, { x, y });
                              return [point.x, point.y];
                            })}
                            fill="#77b8ef40"
                          />
                        </>
                      ) : (
                        showBoxModel &&
                        padding &&
                        selectionBox && (
                          <>
                            <Rect {...selectionBox} fill="#6dc99725" />
                            <Rect {...selected.contentBox} fill="#77b8ef40" />
                          </>
                        )
                      )}
                      <Rect {...selected.box} stroke="#7960e8" strokeWidth={1.5 * inverse} />
                      {[
                        [0, 0],
                        [1, 0],
                        [0, 1],
                        [1, 1],
                      ].map(([x, y]) => (
                        <Rect
                          key={`${x}-${y}`}
                          x={selected.box.x + selected.box.width * x - 2.5 * inverse}
                          y={selected.box.y + selected.box.height * y - 2.5 * inverse}
                          width={5 * inverse}
                          height={5 * inverse}
                          fill="white"
                          stroke="#7960e8"
                          strokeWidth={1 * inverse}
                        />
                      ))}
                      {!segments.length && (
                        <Group
                          x={selected.box.x + selected.box.width / 2}
                          y={selected.box.y + selected.box.height + 9 * inverse}
                        >
                          <Rect
                            x={-49 * inverse}
                            width={98 * inverse}
                            height={22 * inverse}
                            fill="#7960e8"
                            cornerRadius={4 * inverse}
                          />
                          <Text
                            x={-49 * inverse}
                            y={5 * inverse}
                            width={98 * inverse}
                            align="center"
                            text={`${round(selected.box.width)} × ${round(selected.box.height)}`}
                            fontSize={11 * inverse}
                            fill="white"
                            fontFamily="system-ui"
                          />
                        </Group>
                      )}
                    </>
                  )}
                  {target && (
                    <Rect
                      {...target.box}
                      stroke="#ee667b"
                      strokeWidth={1 * inverse}
                      dash={[4 * inverse, 3 * inverse]}
                    />
                  )}
                  {segments.map((segment, index) => {
                    const vertical = segment.axis === 'y';
                    const cx = (segment.x1 + segment.x2) / 2;
                    const cy = (segment.y1 + segment.y2) / 2;
                    return (
                      <Group key={index}>
                        <Line
                          points={[segment.x1, segment.y1, segment.x2, segment.y2]}
                          stroke="#ed5b73"
                          strokeWidth={1 * inverse}
                        />
                        <Line
                          points={
                            vertical
                              ? [
                                  segment.x1 - 4 * inverse,
                                  segment.y1,
                                  segment.x1 + 4 * inverse,
                                  segment.y1,
                                ]
                              : [
                                  segment.x1,
                                  segment.y1 - 4 * inverse,
                                  segment.x1,
                                  segment.y1 + 4 * inverse,
                                ]
                          }
                          stroke="#ed5b73"
                          strokeWidth={1 * inverse}
                        />
                        <Line
                          points={
                            vertical
                              ? [
                                  segment.x2 - 4 * inverse,
                                  segment.y2,
                                  segment.x2 + 4 * inverse,
                                  segment.y2,
                                ]
                              : [
                                  segment.x2,
                                  segment.y2 - 4 * inverse,
                                  segment.x2,
                                  segment.y2 + 4 * inverse,
                                ]
                          }
                          stroke="#ed5b73"
                          strokeWidth={1 * inverse}
                        />
                        <Rect
                          x={cx - 23 * inverse}
                          y={cy - 9 * inverse}
                          width={46 * inverse}
                          height={18 * inverse}
                          fill="#ed5b73"
                          cornerRadius={3 * inverse}
                        />
                        <Text
                          x={cx - 23 * inverse}
                          y={cy - 5 * inverse}
                          width={46 * inverse}
                          align="center"
                          text={`${round(segment.value)}`}
                          fontSize={10 * inverse}
                          fill="white"
                          fontFamily="system-ui"
                        />
                      </Group>
                    );
                  })}
                  {tool === 'measure' && !selected && (
                    <Circle x={doc.width / 2} y={-10} radius={0} />
                  )}
                </Group>
              </Layer>
            </Stage>
          </>
        )}
        {props.children}
      </div>
    );
  },
);

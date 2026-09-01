import { type CanvasRenderingTarget2D } from "fancy-canvas";
import {
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type PrimitivePaneViewZOrder,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
  type LineData,
} from "lightweight-charts";

export interface FillBandOptions {
  color: string;
  opacity?: number;
  /**
   * Optional per-point color based on the two underlying series values.
   * `a` is the value of the series the primitive is attached to; `b` is the
   * other series. Return `null` to skip that bar. When omitted the base
   * `color` is used.
   */
  colorFor?: (a: number, b: number) => string | null;
}

interface BandValue {
  time: Time;
  value: number;
}

interface RenderPoint {
  x: number;
  yTop: number;
  yBottom: number;
  color: string;
}

interface BandPair {
  time: Time;
  a: number;
  b: number;
  top: number;
  bottom: number;
}

function priceSeriesData(series: ISeriesApi<SeriesType>): BandValue[] {
  const out: BandValue[] = [];
  for (const item of series.data() as LineData<Time>[]) {
    const v = (item as { value?: number }).value;
    if (v !== undefined && !isNaN(v)) {
      out.push({ time: item.time as Time, value: v });
    }
  }
  return out;
}

/**
 * Primitive that paints a filled band between two series.
 * Attach it to any of the two series; it reads both via their data API.
 */
export class FillBand implements ISeriesPrimitive<Time> {
  private readonly _seriesA: ISeriesApi<SeriesType>;
  private readonly _seriesB: ISeriesApi<SeriesType>;
  private readonly _paneView: FillBandPaneView;
  private _requestUpdate?: () => void;
  private _chart?: SeriesAttachedParameter<Time>["chart"];
  private _pairs: BandPair[] = [];
  private _points: RenderPoint[] = [];

  constructor(
    seriesA: ISeriesApi<SeriesType>,
    seriesB: ISeriesApi<SeriesType>,
    options: FillBandOptions,
  ) {
    this._seriesA = seriesA;
    this._seriesB = seriesB;
    this._paneView = new FillBandPaneView(options);
  }

  private _reconcile() {
    const options = this._paneView.rendererOptions();
    const aData = priceSeriesData(this._seriesA);
    const bData = priceSeriesData(this._seriesB);
    const bByTime = new Map<string, number>();
    for (const p of bData) bByTime.set(String(p.time), p.value);

    const pairs: BandPair[] = [];
    for (const p of aData) {
      const b = bByTime.get(String(p.time));
      if (b === undefined) continue;
      pairs.push({
        time: p.time,
        a: p.value,
        b,
        top: Math.max(p.value, b),
        bottom: Math.min(p.value, b),
      });
    }
    pairs.sort((x, y) => String(x.time).localeCompare(String(y.time)));
    this._pairs = pairs;

    const filtered = pairs.filter((p) => {
      if (options.colorFor) return options.colorFor(p.a, p.b) !== null;
      return true;
    });
    const reindex = new Set(filtered.map((p) => String(p.time)));
    this._pairs = this._pairs.filter((p) => reindex.has(String(p.time)));
  }

  updateAllViews(): void {
    this._reconcile();
    if (!this._chart) return;

    const options = this._paneView.rendererOptions();
    const ts = this._chart.timeScale();
    const series = this._seriesA;
    const points: RenderPoint[] = [];
    for (const p of this._pairs) {
      const x = ts.timeToCoordinate(p.time as Time);
      const yTop = series.priceToCoordinate(p.top);
      const yBottom = series.priceToCoordinate(p.bottom);
      if (x === null || yTop === null || yBottom === null) continue;
      points.push({
        x,
        yTop,
        yBottom,
        color: options.colorFor ? options.colorFor(p.a, p.b) ?? options.color : options.color,
      });
    }
    this._points = points;
    this._paneView.update(points);
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this._paneView];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
    this._seriesA.subscribeDataChanged(this._onDataChanged);
    this._seriesB.subscribeDataChanged(this._onDataChanged);
    this.updateAllViews();
  }

  detached(): void {
    this._seriesA.unsubscribeDataChanged(this._onDataChanged);
    this._seriesB.unsubscribeDataChanged(this._onDataChanged);
  }

  private readonly _onDataChanged = () => {
    this.updateAllViews();
    if (this._requestUpdate) this._requestUpdate();
  };
}

class FillBandPaneView implements IPrimitivePaneView {
  private readonly _renderer: FillBandRenderer;

  constructor(options: FillBandOptions) {
    this._renderer = new FillBandRenderer(options);
  }

  rendererOptions(): FillBandOptions {
    return this._renderer.options;
  }

  update(points: RenderPoint[]) {
    this._renderer.update(points);
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this._renderer;
  }
}

class FillBandRenderer implements IPrimitivePaneRenderer {
  readonly options: FillBandOptions;
  private _points: RenderPoint[] = [];

  constructor(options: FillBandOptions) {
    this.options = options;
  }

  update(points: RenderPoint[]) {
    this._points = points;
  }

  draw(target: CanvasRenderingTarget2D) {
    const pts = this._points;
    if (pts.length < 2) return;

    target.useMediaCoordinateSpace(({ context }) => {
      const opacity = this.options.opacity ?? 0.25;

      // Group contiguous points by color so each run gets its own fill.
      let runStart = 0;
      for (let i = 1; i <= pts.length; i++) {
        const colorChanged = i === pts.length || pts[i].color !== pts[runStart].color;
        if (!colorChanged) continue;

        const run = pts.slice(runStart, i);
        if (run.length >= 2) {
          const color = run[0].color;
          context.beginPath();
          tracePath(context, run, (p) => p.yTop);
          const last = run[run.length - 1];
          context.lineTo(last.x, last.yBottom);
          tracePath(context, run, (p) => p.yBottom, true);
          context.lineTo(run[0].x, run[0].yTop);
          context.closePath();

          context.globalAlpha = opacity;
          context.fillStyle = color;
          context.fill();

          context.globalAlpha = 1;
          context.lineWidth = 1;
          context.strokeStyle = color;
          strokePath(context, run, (p) => p.yTop);
          strokePath(context, run, (p) => p.yBottom);
        }
        runStart = i;
      }
    });
  }
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  pts: RenderPoint[],
  yOf: (p: RenderPoint) => number,
  reverse = false,
) {
  const seq = reverse ? [...pts].reverse() : pts;
  seq.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, yOf(p));
    else ctx.lineTo(p.x, yOf(p));
  });
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: RenderPoint[],
  yOf: (p: RenderPoint) => number,
) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, yOf(p));
    else ctx.lineTo(p.x, yOf(p));
  });
}

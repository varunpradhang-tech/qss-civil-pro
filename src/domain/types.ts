// Core geometry types for the parsed drawing. All coordinates are millimetres internally
// (matches DWG $INSUNITS=mm); conversion to metres happens at extraction/display time.

export interface Pt {
  x: number;
  y: number;
}

/** A normalized line segment in world coords (mm). */
export interface Segment {
  a: Pt;
  b: Pt;
  layer: string;
}

/** A normalized linear dimension: the two measured points, the value, and where its text sits. */
export interface DimensionRef {
  measurement: number; // mm
  p1: Pt;
  p2: Pt;
  mid: Pt;
  dir: 'H' | 'V' | 'D';
  layer: string;
}

/** A text placement (labels, thickness callouts). */
export interface TextRef {
  text: string;
  pos: Pt;
  layer: string;
}

/** Normalized output of parsing a single DWG/DXF sheet. */
export interface NormalizedDwg {
  fileName: string;
  units: number; // $INSUNITS raw (4 = mm)
  unitScaleToMm: number; // multiply raw coords by this to get mm
  layers: string[];
  entityCountsByType: Record<string, number>;
  segments: Segment[];
  dimensions: DimensionRef[];
  texts: TextRef[];
  polylines: { pts: Pt[]; closed: boolean; layer: string }[];
  hatches: { pts: Pt[]; layer: string; solid: boolean }[];
  extents: { min: Pt; max: Pt };
}

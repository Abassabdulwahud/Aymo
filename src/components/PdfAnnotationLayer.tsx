/**
 * PdfAnnotationLayer
 *
 * Renders stored annotation overlays (highlight / underline / strikethrough)
 * on a single PDF page as absolutely-positioned divs that sit above the
 * text layer without touching the canvas.
 *
 * `pageWidth` and `pageHeight` are the rendered CSS pixel dimensions of the
 * page.  All bounding_rects stored on an annotation are already in those same
 * pixel units (captured at creation time), so we apply them directly.
 */

import type { Annotation } from "../types";

interface PdfAnnotationLayerProps {
  annotations: Annotation[];
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  flashId?: number | null;
}

const TYPE_STYLES: Record<
  string,
  (color: string) => React.CSSProperties
> = {
  highlight: (color) => ({
    background: color,
    opacity: 0.35,
    mixBlendMode: "multiply",
  }),
  underline: (color) => ({
    background: "transparent",
    borderBottom: `2px solid ${color}`,
    opacity: 0.9,
  }),
  strikethrough: (color) => ({
    background: "transparent",
    borderTop: `2px solid ${color}`,
    transform: "translateY(50%)",
    opacity: 0.9,
  }),
  comment: (color) => ({
    background: color,
    opacity: 0.25,
    mixBlendMode: "multiply",
  }),
  bookmark: (color) => ({
    background: color,
    opacity: 0.2,
    mixBlendMode: "multiply",
  }),
};

export function PdfAnnotationLayer({
  annotations,
  pageIndex,
  pageWidth,
  pageHeight,
  flashId,
}: PdfAnnotationLayerProps) {
  // Only render annotations that belong to this page
  const pageAnnotations = annotations.filter(
    (a) => a.page_number === pageIndex,
  );

  if (pageAnnotations.length === 0) return null;

  return (
    <div
      className="pdf-annotation-layer"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: pageWidth,
        height: pageHeight,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 3,
      }}
      aria-hidden="true"
    >
      {pageAnnotations.map((annotation) => {
        const isFlashing = flashId === annotation.id;
        const styleFn = TYPE_STYLES[annotation.annotation_type] ?? TYPE_STYLES.highlight;
        const rects = annotation.bounding_rects ?? [];

        return rects.map((rect, rectIdx) => (
          <div
            key={`${annotation.id}-${rectIdx}`}
            className={`pdf-annotation-rect${isFlashing ? " pdf-annotation-flash" : ""}`}
            style={{
              position: "absolute",
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              borderRadius: 2,
              ...styleFn(annotation.color),
            }}
          />
        ));
      })}
    </div>
  );
}

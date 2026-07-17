import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";
import { SelectionContextMenu } from "./SelectionContextMenu";
import type { SelectionMenuAction } from "./SelectionContextMenu";
import type { Annotation, BoundingRect } from "../types";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── props ─────────────────────────────────────────────────────────────────────

interface PdfCanvasViewerProps {
  source: string;
  sourceId: number;
  annotations: Annotation[];
  flashAnnotationId?: number | null;
  jumpToPage?: number | null;
  onAnnotationCreate: (
    pageIndex: number,
    selectedText: string,
    rects: BoundingRect[],
    action: SelectionMenuAction,
  ) => void;
  onAskAI: (prompt: string) => void;
  onCopyText: (text: string, withCitation?: boolean, pageNumber?: number) => void;
  onSearchGoogle: (text: string) => void;
  onCreateNote: (text: string, pageNumber: number) => void;
  onAppendToNote: (text: string, pageNumber: number) => void;
}

// ── internals ─────────────────────────────────────────────────────────────────

interface PageLayout {
  width: number;
  height: number;
  top: number;
  scale: number;
}

interface SelectionState {
  x: number;
  y: number;
  text: string;
  pageIndex: number;
  rects: BoundingRect[];
}

const PDF_PAGE_GAP = 16;

// ── component ─────────────────────────────────────────────────────────────────

export function PdfCanvasViewer({
  source,
  sourceId,
  annotations,
  flashAnnotationId,
  jumpToPage,
  onAnnotationCreate,
  onAskAI,
  onCopyText,
  onSearchGoogle,
  onCreateNote,
  onAppendToNote,
}: PdfCanvasViewerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const contentViewportRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollbarRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const textLayerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const pageLayerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const renderedPageIndexesRef = useRef<Set<number>>(new Set());

  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  const [pageLayouts, setPageLayouts] = useState<PageLayout[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [selection, setSelection] = useState<SelectionState | null>(null);

  // ── resize observer ──────────────────────────────────────────────────────────

  useEffect(() => {
    const element = shellRef.current;
    if (!element) return;
    const updateWidth = () => setViewerWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ── load PDF ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    let isCancelled = false;
    setPdfDocument(null);
    setPageCount(0);
    setError(null);
    setIsLoading(true);
    setHorizontalOffset(0);
    setPageLayouts([]);
    setActivePageIndex(0);
    setSelection(null);
    renderedPageIndexesRef.current.clear();

    const loadingTask = getDocument(source);
    void loadingTask.promise
      .then((document) => {
        if (isCancelled) { void document.destroy(); return; }
        setPdfDocument(document);
        setPageCount(document.numPages);
      })
      .catch(() => {
        if (!isCancelled) {
          setError("The PDF could not be rendered in the viewer.");
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      loadingTask.destroy();
    };
  }, [source]);

  // ── build page layouts ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!pdfDocument || viewerWidth === 0 || pageCount === 0) return;
    let isCancelled = false;
    renderedPageIndexesRef.current.clear();
    canvasRefs.current.forEach((canvas) => {
      const context = canvas?.getContext("2d");
      if (canvas && context) { context.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0; }
    });
    textLayerRefs.current.forEach((tl) => {
      if (tl) { tl.innerHTML = ""; tl.classList.remove("selecting"); }
    });

    const build = async () => {
      try {
        const firstPage = await pdfDocument.getPage(1);
        const baseViewport = firstPage.getViewport({ scale: 1 });
        const usableWidth = Math.max(200, viewerWidth - 20);
        const renderScale = usableWidth / baseViewport.width;
        const nextLayouts: PageLayout[] = [];
        let nextTop = 0;
        let nextContentWidth = 0;

        for (let i = 0; i < pageCount; i++) {
          if (isCancelled) return;
          const page = await pdfDocument.getPage(i + 1);
          const viewport = page.getViewport({ scale: renderScale });
          nextContentWidth = Math.max(nextContentWidth, Math.ceil(viewport.width));
          nextLayouts.push({
            width: Math.ceil(viewport.width),
            height: Math.ceil(viewport.height),
            top: nextTop,
            scale: viewport.scale,
          });
          nextTop += Math.ceil(viewport.height) + PDF_PAGE_GAP;
        }

        if (!isCancelled) { setContentWidth(nextContentWidth); setPageLayouts(nextLayouts); }
      } catch {
        if (!isCancelled) { setError("The PDF could not be rendered in the viewer."); setIsLoading(false); }
      }
    };

    setIsLoading(true);
    setError(null);
    void build();
    return () => { isCancelled = true; };
  }, [pageCount, pdfDocument, viewerWidth]);

  // ── active page tracker ──────────────────────────────────────────────────────

  useEffect(() => {
    const viewport = contentViewportRef.current;
    if (!viewport || pageLayouts.length === 0) return;
    const updateActivePage = () => {
      const scrollMidpoint = viewport.scrollTop + viewport.clientHeight / 2;
      let nextActiveIndex = 0;
      for (let i = 0; i < pageLayouts.length; i++) {
        const layout = pageLayouts[i];
        if (scrollMidpoint < layout.top + layout.height + PDF_PAGE_GAP) { nextActiveIndex = i; break; }
        nextActiveIndex = i;
      }
      setActivePageIndex((cur) => (cur === nextActiveIndex ? cur : nextActiveIndex));
    };
    updateActivePage();
    viewport.addEventListener("scroll", updateActivePage, { passive: true });
    return () => viewport.removeEventListener("scroll", updateActivePage);
  }, [pageLayouts]);

  // ── render pages ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pdfDocument || viewerWidth === 0 || pageLayouts.length === 0) return;
    let isCancelled = false;
    const renderTasks: Array<{ cancel?: () => void }> = [];
    const windowIndexes = new Set(
      [activePageIndex, Math.min(activePageIndex + 1, pageLayouts.length - 1)].filter((i) => i >= 0),
    );

    const releasePage = (index: number) => {
      const canvas = canvasRefs.current[index];
      if (canvas) { const ctx = canvas.getContext("2d"); ctx?.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0; }
      const tl = textLayerRefs.current[index];
      if (tl) { tl.innerHTML = ""; tl.classList.remove("selecting"); }
    };

    const renderWindow = async () => {
      try {
        const firstPage = await pdfDocument.getPage(1);
        const baseViewport = firstPage.getViewport({ scale: 1 });
        const usableWidth = Math.max(200, viewerWidth - 20);
        const renderScale = usableWidth / baseViewport.width;

        for (const idx of Array.from(renderedPageIndexesRef.current)) {
          if (!windowIndexes.has(idx)) { releasePage(idx); renderedPageIndexesRef.current.delete(idx); }
        }

        for (const index of windowIndexes) {
          if (isCancelled || renderedPageIndexesRef.current.has(index)) continue;

          const page = await pdfDocument.getPage(index + 1);
          const canvas = canvasRefs.current[index];
          const textLayer = textLayerRefs.current[index];
          if (!canvas) continue;

          const viewport = page.getViewport({ scale: renderScale });
          const tempCanvas = document.createElement("canvas");
          const tempCtx = tempCanvas.getContext("2d");
          if (!tempCtx) continue;

          const outputScale = window.devicePixelRatio || 1;
          tempCanvas.width = Math.floor(viewport.width * outputScale);
          tempCanvas.height = Math.floor(viewport.height * outputScale);
          tempCtx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

          const renderTask = page.render({ canvas: tempCanvas, canvasContext: tempCtx, viewport });
          renderTasks.push(renderTask);
          await renderTask.promise;
          if (isCancelled) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          canvas.width = tempCanvas.width;
          canvas.height = tempCanvas.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(tempCanvas, 0, 0);

          if (textLayer) {
            textLayer.innerHTML = "";
            textLayer.classList.remove("selecting");
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;
            const textContent = await page.getTextContent({ includeMarkedContent: true });
            const renderedTL = new TextLayer({ textContentSource: textContent, container: textLayer, viewport });
            await renderedTL.render();
          }

          renderedPageIndexesRef.current.add(index);
        }

        if (!isCancelled) setIsLoading(false);
      } catch {
        if (!isCancelled) { setError("The PDF could not be rendered in the viewer."); setIsLoading(false); }
      }
    };

    void renderWindow();
    return () => { isCancelled = true; renderTasks.forEach((t) => t.cancel?.()); };
  }, [activePageIndex, pageLayouts, pdfDocument, viewerWidth]);

  // ── bottom scrollbar sync ────────────────────────────────────────────────────

  useEffect(() => {
    const bottomScrollbar = bottomScrollbarRef.current;
    const shell = shellRef.current;
    if (!bottomScrollbar || !shell) return;
    const syncWidths = () => { bottomScrollbar.scrollLeft = horizontalOffset; };
    syncWidths();
    const observer = new ResizeObserver(syncWidths);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [contentWidth, horizontalOffset, pageCount, isLoading]);

  // ── jump to page (external) ──────────────────────────────────────────────────

  useEffect(() => {
    if (jumpToPage == null || pageLayouts.length === 0) return;
    const layout = pageLayouts[jumpToPage];
    if (layout && contentViewportRef.current) {
      contentViewportRef.current.scrollTo({ top: layout.top, behavior: "smooth" });
    }
  }, [jumpToPage, pageLayouts]);

  // ── text selection → context menu ────────────────────────────────────────────

  const handleMouseUp = useCallback(
    (e: React.MouseEvent, pageIndex: number) => {
      // Give the browser a tick to finalise selection
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelection(null); return; }
        const text = sel.toString().trim();
        if (!text) { setSelection(null); return; }

        const range = sel.getRangeAt(0);
        const pageLayer = pageLayerRefs.current[pageIndex];
        if (!pageLayer) { setSelection(null); return; }

        const pageRect = pageLayer.getBoundingClientRect();
        const clientRects = Array.from(range.getClientRects());

        // Convert from viewport-relative to page-relative coordinates
        const rects: BoundingRect[] = clientRects.map((r) => ({
          x: r.left - pageRect.left,
          y: r.top  - pageRect.top,
          width:  r.width,
          height: r.height,
        }));

        // Show menu just below the last rect of the selection
        const lastRect = clientRects[clientRects.length - 1];
        setSelection({
          x: lastRect ? lastRect.left : e.clientX,
          y: lastRect ? lastRect.bottom + 6 : e.clientY + 6,
          text,
          pageIndex,
          rects,
        });
      });
    },
    [],
  );

  const handleMenuAction = useCallback(
    (action: SelectionMenuAction, selectedText: string) => {
      if (!selection) return;
      const { pageIndex, rects } = selection;

      switch (action) {
        // ── Annotation ──
        case "annotate-highlight":
        case "annotate-underline":
        case "annotate-strikethrough":
        case "annotate-comment":
        case "annotate-bookmark":
        case "color-yellow":
        case "color-green":
        case "color-blue":
        case "color-pink":
          onAnnotationCreate(pageIndex, selectedText, rects, action);
          break;

        // ── Clipboard ──
        case "copy":
          void navigator.clipboard.writeText(selectedText);
          onCopyText(selectedText);
          break;
        case "copy-with-citation":
          void navigator.clipboard.writeText(`${selectedText} (p. ${pageIndex + 1})`);
          onCopyText(selectedText, true, pageIndex + 1);
          break;

        // ── AI ──
        case "ai-explain":
          onAskAI(`Explain the following text: "${selectedText}"`);
          break;
        case "ai-summarize":
          onAskAI(`Summarize: "${selectedText}"`);
          break;
        case "ai-rewrite":
          onAskAI(`Rewrite this more clearly: "${selectedText}"`);
          break;
        case "ai-simplify":
          onAskAI(`Simplify this for a general audience: "${selectedText}"`);
          break;
        case "ai-translate":
          onAskAI(`Translate to English: "${selectedText}"`);
          break;
        case "ai-ask":
          onAskAI(`Regarding this text from the PDF: "${selectedText}" — `);
          break;
        case "ai-continue":
          onAskAI(`Continue from: "${selectedText}"`);
          break;

        // ── Knowledge ──
        case "km-create-note":
          onCreateNote(selectedText, pageIndex + 1);
          break;
        case "km-append-note":
          onAppendToNote(selectedText, pageIndex + 1);
          break;

        // ── Search ──
        case "search-google":
          window.open(`https://www.google.com/search?q=${encodeURIComponent(selectedText)}`, "_blank");
          onSearchGoogle(selectedText);
          break;
        case "search-aymo":
          onAskAI(`Search AYMO knowledge base for: "${selectedText}"`);
          break;
        case "search-document":
          onAskAI(`Find all references to "${selectedText}" in this document.`);
          break;

        default:
          break;
      }
    },
    [selection, onAnnotationCreate, onAskAI, onCopyText, onCreateNote, onAppendToNote, onSearchGoogle],
  );

  const handleBottomScrollbarScroll = () => {
    const bottomScrollbar = bottomScrollbarRef.current;
    if (!bottomScrollbar) return;
    setHorizontalOffset(bottomScrollbar.scrollLeft);
  };

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div ref={shellRef} className="pdf-simple-viewer">
      {error ? (
        <div className="file-preview-fallback"><p>{error}</p></div>
      ) : (
        <>
          <div ref={contentViewportRef} className="pdf-content-viewport">
            <div
              className="pdf-simple-stack"
              style={{
                width: contentWidth ? `${contentWidth}px` : undefined,
                transform: `translateX(-${horizontalOffset}px)`,
              }}
            >
              {pageLayouts.map((layout, index) => (
                <div
                  key={`${source}-${index + 1}`}
                  ref={(el) => { pageLayerRefs.current[index] = el; }}
                  className="pdf-page-layer"
                  style={{
                    width: `${layout.width}px`,
                    minHeight: `${layout.height}px`,
                    ["--total-scale-factor" as string]: String(layout.scale),
                    ["--scale-factor" as string]: String(layout.scale),
                    position: "relative",
                  } as CSSProperties}
                  onMouseUp={(e) => handleMouseUp(e, index)}
                >
                  <canvas
                    ref={(el) => { canvasRefs.current[index] = el; }}
                    className="pdf-page-canvas"
                    style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
                  />
                  <div
                    ref={(el) => { textLayerRefs.current[index] = el; }}
                    className="pdf-text-layer"
                    style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
                  />
                  {/* Annotation overlay — rendered independently, never touches the canvas */}
                  <PdfAnnotationLayer
                    annotations={annotations}
                    pageIndex={index}
                    pageWidth={layout.width}
                    pageHeight={layout.height}
                    flashId={flashAnnotationId}
                  />
                </div>
              ))}
              {isLoading ? <p className="pdf-loading">Rendering PDF…</p> : null}
            </div>
          </div>

          <div
            ref={bottomScrollbarRef}
            className="pdf-bottom-scrollbar"
            onScroll={handleBottomScrollbarScroll}
          >
            <div
              className="pdf-bottom-scrollbar-spacer"
              style={contentWidth ? { width: `${contentWidth}px` } : undefined}
            />
          </div>

          {/* Selection context menu */}
          {selection && (
            <SelectionContextMenu
              x={selection.x}
              y={selection.y}
              selectedText={selection.text}
              context="pdf"
              pageNumber={selection.pageIndex + 1}
              onAction={handleMenuAction}
              onClose={() => setSelection(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

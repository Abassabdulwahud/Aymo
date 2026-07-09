import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfCanvasViewerProps {
  source: string;
}

interface PageLayout {
  width: number;
  height: number;
  top: number;
  scale: number;
}

const PDF_PAGE_GAP = 16;

export function PdfCanvasViewer({ source }: PdfCanvasViewerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const contentViewportRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollbarRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const textLayerRefs = useRef<Array<HTMLDivElement | null>>([]);
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

  useEffect(() => {
    const element = shellRef.current;
    if (!element) return;

    const updateWidth = () => setViewerWidth(element.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let isCancelled = false;
    setPdfDocument(null);
    setPageCount(0);
    setError(null);
    setIsLoading(true);
    setHorizontalOffset(0);
    setPageLayouts([]);
    setActivePageIndex(0);
    renderedPageIndexesRef.current.clear();

    const loadingTask = getDocument(source);

    void loadingTask.promise
      .then((document) => {
        if (isCancelled) {
          void document.destroy();
          return;
        }
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

  useEffect(() => {
    if (!pdfDocument || viewerWidth === 0 || pageCount === 0) return;

    let isCancelled = false;
    renderedPageIndexesRef.current.clear();
    canvasRefs.current.forEach((canvas) => {
      const context = canvas?.getContext("2d");
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }
    });
    textLayerRefs.current.forEach((textLayer) => {
      if (textLayer) {
        textLayer.innerHTML = "";
        textLayer.classList.remove("selecting");
      }
    });

    const buildPageLayouts = async () => {
      try {
        const firstPage = await pdfDocument.getPage(1);
        const baseViewport = firstPage.getViewport({ scale: 1 });
        // Subtract scrollbar and padding width (approx 20px) to prevent overflow
        const usableWidth = Math.max(200, viewerWidth - 20);
        const renderScale = usableWidth / baseViewport.width;
        const nextLayouts: PageLayout[] = [];
        let nextTop = 0;
        let nextContentWidth = 0;

        for (let index = 0; index < pageCount; index += 1) {
          if (isCancelled) return;

          const page = await pdfDocument.getPage(index + 1);
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

        if (!isCancelled) {
          setContentWidth(nextContentWidth);
          setPageLayouts(nextLayouts);
        }
      } catch {
        if (!isCancelled) {
          setError("The PDF could not be rendered in the viewer.");
          setIsLoading(false);
        }
      }
    };

    setIsLoading(true);
    setError(null);
    void buildPageLayouts();

    return () => {
      isCancelled = true;
    };
  }, [pageCount, pdfDocument, viewerWidth]);

  useEffect(() => {
    const viewport = contentViewportRef.current;
    if (!viewport || pageLayouts.length === 0) return;

    const updateActivePage = () => {
      const scrollMidpoint = viewport.scrollTop + viewport.clientHeight / 2;
      let nextActiveIndex = 0;

      for (let index = 0; index < pageLayouts.length; index += 1) {
        const layout = pageLayouts[index];
        const pageBottom = layout.top + layout.height + PDF_PAGE_GAP;
        if (scrollMidpoint < pageBottom) {
          nextActiveIndex = index;
          break;
        }
        nextActiveIndex = index;
      }

      setActivePageIndex((currentIndex) => (currentIndex === nextActiveIndex ? currentIndex : nextActiveIndex));
    };

    updateActivePage();
    viewport.addEventListener("scroll", updateActivePage, { passive: true });
    return () => viewport.removeEventListener("scroll", updateActivePage);
  }, [pageLayouts]);

  useEffect(() => {
    if (!pdfDocument || viewerWidth === 0 || pageLayouts.length === 0) return;

    let isCancelled = false;
    const renderTasks: Array<{ cancel?: () => void }> = [];
    const windowIndexes = new Set(
      [activePageIndex, Math.min(activePageIndex + 1, pageLayouts.length - 1)].filter((index) => index >= 0),
    );

    const releasePage = (index: number) => {
      const canvas = canvasRefs.current[index];
      if (canvas) {
        const context = canvas.getContext("2d");
        context?.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }

      const textLayer = textLayerRefs.current[index];
      if (textLayer) {
        textLayer.innerHTML = "";
        textLayer.classList.remove("selecting");
      }
    };

    const renderPageWindow = async () => {
      try {
        const firstPage = await pdfDocument.getPage(1);
        const baseViewport = firstPage.getViewport({ scale: 1 });
        const usableWidth = Math.max(200, viewerWidth - 20);
        const renderScale = usableWidth / baseViewport.width;

        for (const renderedIndex of Array.from(renderedPageIndexesRef.current)) {
          if (!windowIndexes.has(renderedIndex)) {
            releasePage(renderedIndex);
            renderedPageIndexesRef.current.delete(renderedIndex);
          }
        }

        for (const index of windowIndexes) {
          if (isCancelled || renderedPageIndexesRef.current.has(index)) continue;

          const page = await pdfDocument.getPage(index + 1);
          const canvas = canvasRefs.current[index];
          const textLayer = textLayerRefs.current[index];
          if (!canvas) continue;

          const viewport = page.getViewport({ scale: renderScale });
          const nextCanvas = document.createElement("canvas");
          const nextContext = nextCanvas.getContext("2d");
          if (!nextContext) continue;

          const outputScale = window.devicePixelRatio || 1;
          nextCanvas.width = Math.floor(viewport.width * outputScale);
          nextCanvas.height = Math.floor(viewport.height * outputScale);
          nextContext.setTransform(outputScale, 0, 0, outputScale, 0, 0);

          const renderTask = page.render({
            canvas: nextCanvas,
            canvasContext: nextContext,
            viewport,
          });
          renderTasks.push(renderTask);
          await renderTask.promise;

          if (isCancelled) return;

          const context = canvas.getContext("2d");
          if (!context) continue;

          canvas.width = nextCanvas.width;
          canvas.height = nextCanvas.height;
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(nextCanvas, 0, 0);

          if (textLayer) {
            textLayer.innerHTML = "";
            textLayer.classList.remove("selecting");
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;
            const textContent = await page.getTextContent({
              includeMarkedContent: true,
            });
            const renderedTextLayer = new TextLayer({
              textContentSource: textContent,
              container: textLayer,
              viewport,
            });
            await renderedTextLayer.render();
          }

          renderedPageIndexesRef.current.add(index);
        }

        if (!isCancelled) {
          setIsLoading(false);
        }
      } catch {
        if (!isCancelled) {
          setError("The PDF could not be rendered in the viewer.");
          setIsLoading(false);
        }
      }
    };

    void renderPageWindow();

    return () => {
      isCancelled = true;
      renderTasks.forEach((task) => task.cancel?.());
    };
  }, [activePageIndex, pageLayouts, pdfDocument, viewerWidth]);

  useEffect(() => {
    const bottomScrollbar = bottomScrollbarRef.current;
    const shell = shellRef.current;
    if (!bottomScrollbar || !shell) return;

    const syncWidths = () => {
      bottomScrollbar.scrollLeft = horizontalOffset;
    };

    syncWidths();
    const observer = new ResizeObserver(syncWidths);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [contentWidth, horizontalOffset, pageCount, isLoading]);

  const handleBottomScrollbarScroll = () => {
    const bottomScrollbar = bottomScrollbarRef.current;
    if (!bottomScrollbar) return;
    setHorizontalOffset(bottomScrollbar.scrollLeft);
  };

  return (
    <div ref={shellRef} className="pdf-simple-viewer">
      {error ? (
        <div className="file-preview-fallback">
          <p>{error}</p>
        </div>
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
                  className="pdf-page-layer"
                  style={{
                    width: `${layout.width}px`,
                    minHeight: `${layout.height}px`,
                    ["--total-scale-factor" as string]: String(layout.scale),
                    ["--scale-factor" as string]: String(layout.scale),
                  } as CSSProperties}
                >
                  <canvas
                    ref={(element) => {
                      canvasRefs.current[index] = element;
                    }}
                    className="pdf-page-canvas"
                    style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
                  />
                  <div
                    ref={(element) => {
                      textLayerRefs.current[index] = element;
                    }}
                    className="pdf-text-layer"
                    style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
                  />
                </div>
              ))}
              {isLoading ? <p className="pdf-loading">Rendering PDF...</p> : null}
            </div>
          </div>
          <div ref={bottomScrollbarRef} className="pdf-bottom-scrollbar" onScroll={handleBottomScrollbarScroll}>
            <div className="pdf-bottom-scrollbar-spacer" style={contentWidth ? { width: `${contentWidth}px` } : undefined} />
          </div>
        </>
      )}
    </div>
  );
}

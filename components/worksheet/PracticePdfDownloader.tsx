'use client';

import { useEffect, useRef } from 'react';
import { pdf } from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { PracticePDF } from './PracticePDF';
import type { CellStyle, PaperSize } from '@/lib/worksheet-types';

export type PdfStatus = 'loading' | 'done' | 'error';

export interface PracticePdfRequest {
  paperSize: PaperSize;
  cellStyle: CellStyle;
  siteHost: string;
}

interface Props extends PracticePdfRequest {
  /**
   * Request counter. The parent bumps it for every download; each value
   * produces exactly one PDF.
   */
  runId: number;
  onStatus: (status: PdfStatus) => void;
  onError: (message: string) => void;
}

/**
 * Hand the generated PDF to the browser.
 *
 * The object URL is revoked on a timer instead of immediately: revoking it
 * right after `click()` can cancel the download, because the navigation to
 * the blob URL has not started yet.
 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Generates the practice-template PDF on demand and downloads it.
 *
 * This component is the only place that pulls in `@react-pdf/renderer`
 * (react-pdf + pdfkit + yoga ≈ 1 MB of JavaScript). It is loaded through
 * `next/dynamic` when the visitor asks for a PDF, so the renderer never
 * weighs down the page itself — most visitors of /worksheet/practice only
 * use the browser's own print dialog.
 */
export default function PracticePdfDownloader({
  paperSize,
  cellStyle,
  siteHost,
  runId,
  onStatus,
  onError,
}: Props) {
  // Latest request settings, kept in a ref so that changing the paper size
  // does not restart an in-flight download (the effect below runs on
  // `runId` changes only).
  const settings = useRef<PracticePdfRequest>({ paperSize, cellStyle, siteHost });
  // The request counter value that was already handled.
  const lastRun = useRef(0);

  useEffect(() => {
    settings.current = { paperSize, cellStyle, siteHost };
  }, [paperSize, cellStyle, siteHost]);

  useEffect(() => {
    if (runId === 0 || runId === lastRun.current) return;
    lastRun.current = runId;
    const request = settings.current;
    let cancelled = false;

    (async () => {
      onStatus('loading');
      try {
        // `pdf()` takes the document element and returns a renderer whose
        // `toBlob()` lays the pages out and returns the PDF as a Blob —
        // the same call `PDFDownloadLink` makes internally.
        const document = (
          <PracticePDF
            paperSize={request.paperSize}
            cellStyle={request.cellStyle}
            siteHost={request.siteHost}
          />
        ) as unknown as ReactElement<DocumentProps>;
        const blob = await pdf(document).toBlob();
        if (cancelled) return;
        triggerDownload(blob, `练字模板-${request.paperSize}.pdf`);
        onStatus('done');
      } catch (err) {
        if (cancelled) return;
        console.error('PDF generation failed', err);
        onError((err as Error).message || 'PDF 生成失败');
        onStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId, onStatus, onError]);

  return null;
}

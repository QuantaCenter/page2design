import { useEffect, useState } from 'react';
import type { DesignDocument } from '@page-to-design/core';
import { loadDocumentResources, type DocumentResources } from '@page-to-design/core/canvas';

/** React lifecycle adapter over the same framework-free resource decoder. */
export function useResources(document: DesignDocument | null): DocumentResources | null {
  const [resources, setResources] = useState<DocumentResources | null>(null);
  useEffect(() => {
    if (!document) {
      // Clear decoded external resources when the document is detached.
      // oxlint-disable-next-line react/set-state-in-effect
      setResources(null);
      return;
    }
    const controller = new AbortController();
    let current: DocumentResources | null = null;
    void loadDocumentResources(document, { signal: controller.signal })
      .then((value) => {
        current = value;
        if (controller.signal.aborted) value.dispose();
        else setResources(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResources({
            documentId: document.id,
            images: new Map(),
            reference: null,
            errors: [String(error)],
            dispose() {},
          });
      });
    return () => {
      controller.abort();
      current?.dispose();
    };
  }, [document]);
  return resources?.documentId === document?.id ? resources : null;
}

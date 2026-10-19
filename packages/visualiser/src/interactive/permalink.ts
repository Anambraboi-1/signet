/**
 * @file @signet/visualiser/interactive — permalinks to focused nodes (issue 505).
 *
 * Provides deep linking to individual diagram nodes with neighbourhood highlighting
 * and viewport scroll. Adds a "Copy link to this node" button in the detail card (#500)
 * using navigator.clipboard, with fallback to text selection when clipboard is unavailable.
 */

import type { DetailsData, EnhanceDetailsOptions } from './details.ts';
import { enhanceDetails } from './details.ts';

export interface PermalinkOptions {
  /** Base URL for building permalinks. Defaults to window.location.href or '/'. */
  baseUrl?: string;
  /** Callback fired after successfully copying the permalink. */
  onCopy?: (url: string) => void;
  /** Callback fired when copying fails or is unavailable, and URL text is selected. */
  onFallback?: (url: string) => void;
}

/**
 * Build the canonical permalink for a node id, including ?focus= query param
 * and #diagram-<nodeId> fragment.
 */
export function buildNodePermalink(nodeId: string, currentUrl?: string): string {
  const base = currentUrl ?? (typeof window !== 'undefined' && window.location ? window.location.href : '/');
  const cleanId = nodeId.replace(/:/g, '-');
  const anchor = `diagram-${cleanId}`;

  try {
    const isRelative = base.startsWith('/') || !base.includes('://');
    const url = isRelative ? new URL(base, 'https://signet.local') : new URL(base);
    url.searchParams.set('focus', nodeId);
    url.hash = anchor;

    if (isRelative) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.toString();
  } catch {
    return `?focus=${encodeURIComponent(nodeId)}#${anchor}`;
  }
}

/**
 * Attach a "Copy link to this node" button to the detail card.
 */
export function attachPermalinkButton(
  card: HTMLElement,
  nodeId: string,
  options: PermalinkOptions = {},
): HTMLButtonElement {
  const doc = card.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'viz-details-card__permalink-btn';
  button.textContent = 'Copy link to this node';
  button.setAttribute('data-node-id', nodeId);

  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  button.addEventListener('click', async (event: Event) => {
    event.preventDefault();
    event.stopPropagation();

    const permalink = buildNodePermalink(nodeId, options.baseUrl);
    let copied = false;

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(permalink);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (copied) {
      button.textContent = 'Copied!';
      options.onCopy?.(permalink);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        button.textContent = 'Copy link to this node';
      }, 2000);
    } else {
      // Clipboard unavailable or blocked: select URL text instead
      let fallbackInput = card.querySelector<HTMLInputElement>('input.viz-permalink-fallback');
      if (!fallbackInput) {
        fallbackInput = doc.createElement('input');
        fallbackInput.type = 'text';
        fallbackInput.className = 'viz-permalink-fallback';
        fallbackInput.readOnly = true;
        fallbackInput.setAttribute('aria-label', 'Node permalink');
        card.appendChild(fallbackInput);
      }
      fallbackInput.value = permalink;
      if (typeof fallbackInput.focus === 'function') fallbackInput.focus();
      if (typeof fallbackInput.select === 'function') fallbackInput.select();
      options.onFallback?.(permalink);
    }
  });

  card.appendChild(button);
  return button;
}

/**
 * Mounts detail cards enhanced with a "Copy link to this node" button.
 */
export function enhancePermalinks(
  svg: SVGSVGElement,
  data: DetailsData,
  options: EnhanceDetailsOptions & PermalinkOptions = {},
): () => void {
  return enhanceDetails(svg, data, {
    ...options,
    renderFooter(card, nodeId) {
      attachPermalinkButton(card, nodeId, options);
      options.renderFooter?.(card, nodeId);
    },
  });
}

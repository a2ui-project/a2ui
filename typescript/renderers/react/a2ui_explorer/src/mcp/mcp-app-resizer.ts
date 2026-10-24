/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const MIN_WIDTH_PX = 240;
const MAX_WIDTH_PX = 2400;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 1800;

function findMcpAppsDeep(root: Node, out: HTMLElement[] = []): HTMLElement[] {
  if (root instanceof HTMLElement && root.tagName.toLowerCase() === 'a2ui-mcp-app') {
    out.push(root);
  }
  if (root instanceof Element && root.shadowRoot) {
    findMcpAppsDeep(root.shadowRoot, out);
  }
  for (const child of root.childNodes) {
    findMcpAppsDeep(child, out);
  }
  return out;
}

export function enhanceMcpAppElement(mcpApp: HTMLElement): void {
  const getIframe = (): HTMLIFrameElement | null => mcpApp.querySelector(':scope > iframe');

  if (mcpApp.hasAttribute('data-explorer-resizable') || !getIframe()) {
    return;
  }
  mcpApp.setAttribute('data-explorer-resizable', '');
  mcpApp.style.position = 'relative';
  mcpApp.style.display = 'flex';
  mcpApp.style.flexDirection = 'column';
  mcpApp.style.boxSizing = 'border-box';
  mcpApp.style.overflow = 'hidden';

  let initialAutoHeight = '';

  const styleIframe = () => {
    const iframe = getIframe();
    if (!iframe) return;
    iframe.style.display = 'block';
    iframe.style.width = '100%';
    iframe.style.flex = '1';
    iframe.style.border = 'none';
  };
  styleIframe();

  const edgeHandle = document.createElement('div');
  edgeHandle.className = 'explorer-mcp-resize-edge';
  edgeHandle.title = 'Drag to resize MCP App height (double-click to reset)';
  Object.assign(edgeHandle.style, {
    position: 'absolute',
    left: '18px',
    right: '18px',
    bottom: '0',
    height: '8px',
    cursor: 'ns-resize',
    zIndex: '10',
    background: 'transparent',
    transition: 'background-color 120ms ease',
  });

  const leftCornerHandle = document.createElement('div');
  leftCornerHandle.className = 'explorer-mcp-resize-corner-left';
  leftCornerHandle.title = 'Drag to resize MCP App width & height (double-click to reset)';
  Object.assign(leftCornerHandle.style, {
    position: 'absolute',
    left: '0',
    bottom: '0',
    width: '18px',
    height: '18px',
    cursor: 'nesw-resize',
    zIndex: '11',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: '3px',
    boxSizing: 'border-box',
    borderTopRightRadius: '6px',
    background: 'rgba(15, 23, 42, 0.35)',
  });

  const leftGripIcon = document.createElement('span');
  Object.assign(leftGripIcon.style, {
    width: '10px',
    height: '10px',
    display: 'block',
    background:
      'linear-gradient(225deg, transparent 0%, transparent 45%, #94a3b8 45%, #94a3b8 55%, transparent 55%, transparent 70%, #94a3b8 70%, #94a3b8 80%, transparent 80%)',
  });
  leftCornerHandle.appendChild(leftGripIcon);

  const cornerHandle = document.createElement('div');
  cornerHandle.className = 'explorer-mcp-resize-corner';
  cornerHandle.title = 'Drag to resize MCP App width & height (double-click to reset)';
  Object.assign(cornerHandle.style, {
    position: 'absolute',
    right: '0',
    bottom: '0',
    width: '18px',
    height: '18px',
    cursor: 'nwse-resize',
    zIndex: '11',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: '3px',
    boxSizing: 'border-box',
    borderTopLeftRadius: '6px',
    background: 'rgba(15, 23, 42, 0.35)',
  });

  const gripIcon = document.createElement('span');
  Object.assign(gripIcon.style, {
    width: '10px',
    height: '10px',
    display: 'block',
    background:
      'linear-gradient(135deg, transparent 0%, transparent 45%, #94a3b8 45%, #94a3b8 55%, transparent 55%, transparent 70%, #94a3b8 70%, #94a3b8 80%, transparent 80%)',
  });
  cornerHandle.appendChild(gripIcon);

  const badge = document.createElement('div');
  badge.className = 'explorer-mcp-resize-badge';
  badge.title = 'Click to reset MCP App window size';
  Object.assign(badge.style, {
    position: 'absolute',
    right: '24px',
    bottom: '6px',
    zIndex: '11',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '11px',
    lineHeight: '1',
    padding: '4px 8px',
    borderRadius: '999px',
    background: 'rgba(15, 23, 42, 0.88)',
    border: '1px solid rgba(56, 189, 248, 0.4)',
    color: '#e0f2fe',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    display: 'none',
  });

  const applyManualDimensions = (width: number | undefined, height: number) => {
    styleIframe();
    const iframe = getIframe();
    if (!initialAutoHeight && mcpApp.style.height) {
      initialAutoHeight = mcpApp.style.height;
    }
    const clampedH = Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, Math.round(height)));
    const clampedW =
      width !== undefined
        ? Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, Math.round(width)))
        : undefined;

    if (clampedW !== undefined) {
      mcpApp.style.width = `${clampedW}px`;
      mcpApp.style.left = '50%';
      mcpApp.style.transform = 'translateX(-50%)';
      if (iframe) iframe.style.width = `${clampedW}px`;
    }
    mcpApp.style.height = `${clampedH}px`;
    if (iframe) iframe.style.height = `${clampedH}px`;

    const shownW =
      clampedW ??
      (Number.parseFloat(mcpApp.style.width) || Math.round(mcpApp.getBoundingClientRect().width));
    badge.textContent = `${shownW} × ${clampedH} px ↺`;
    badge.style.display = 'block';
  };

  const resetDimensions = () => {
    const iframe = getIframe();
    mcpApp.style.removeProperty('width');
    mcpApp.style.removeProperty('left');
    mcpApp.style.removeProperty('transform');
    if (initialAutoHeight) {
      mcpApp.style.height = initialAutoHeight;
      if (iframe) iframe.style.height = initialAutoHeight;
    } else {
      mcpApp.style.removeProperty('height');
      iframe?.style.removeProperty('height');
    }
    if (iframe) {
      iframe.style.width = '100%';
    }
    badge.textContent = '';
    badge.style.display = 'none';
  };

  const bindDrag = (handle: HTMLElement, mode: 'vertical' | 'right' | 'left') => {
    let drag: {
      startX: number;
      startY: number;
      startW: number;
      startH: number;
    } | null = null;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      if (e.isTrusted && typeof handle.setPointerCapture === 'function') {
        handle.setPointerCapture(e.pointerId);
      }
      const rect = mcpApp.getBoundingClientRect();
      const startW = Number.parseFloat(mcpApp.style.width) || rect.width;
      const startH = Number.parseFloat(mcpApp.style.height) || rect.height;
      if (!initialAutoHeight && startH > 0) {
        initialAutoHeight = `${Math.round(startH)}px`;
      }
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
      };
      const iframe = getIframe();
      if (iframe) iframe.style.pointerEvents = 'none';
      edgeHandle.style.background = 'rgba(56, 189, 248, 0.35)';
    });

    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!drag) return;
      const nextH = drag.startH + (e.clientY - drag.startY);
      const deltaX = e.clientX - drag.startX;
      const nextW =
        mode === 'right'
          ? drag.startW + deltaX
          : mode === 'left'
            ? drag.startW - deltaX
            : undefined;
      applyManualDimensions(nextW, nextH);
    });

    const stopDrag = (e: PointerEvent) => {
      if (!drag) return;
      if (
        e.isTrusted &&
        typeof handle.releasePointerCapture === 'function' &&
        handle.hasPointerCapture(e.pointerId)
      ) {
        handle.releasePointerCapture(e.pointerId);
      }
      drag = null;
      const iframe = getIframe();
      if (iframe) iframe.style.pointerEvents = '';
      edgeHandle.style.background = 'transparent';
    };

    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
    handle.addEventListener('dblclick', resetDimensions);
  };

  bindDrag(edgeHandle, 'vertical');
  bindDrag(cornerHandle, 'right');
  bindDrag(leftCornerHandle, 'left');
  badge.addEventListener('click', resetDimensions);

  mcpApp.append(edgeHandle, leftCornerHandle, cornerHandle, badge);
}

/**
 * Enhances all `<a2ui-mcp-app>` elements inside `root` (including open shadow roots) with
 * host-side manual resize handles (bottom bar for height, bottom-right grip for width+height,
 * and a live dimension badge that resets on click).
 */
export function scanAndEnhanceMcpApps(root: Node): void {
  for (const app of findMcpAppsDeep(root)) {
    enhanceMcpAppElement(app);
  }
}

/**
 * Continuously watches `getRoot()` for newly rendered `<a2ui-mcp-app>` elements and attaches
 * explorer-host manual resize handles to them. Returns a cleanup function.
 */
export function observeMcpApps(getRoot: () => Node | null | undefined): () => void {
  const tick = () => {
    const root = getRoot();
    if (root) {
      scanAndEnhanceMcpApps(root);
    }
  };
  tick();
  const timer = setInterval(tick, 200);
  return () => {
    clearInterval(timer);
  };
}

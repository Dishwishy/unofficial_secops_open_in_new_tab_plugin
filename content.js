/**
 * content.js — SecOps Rule Linker Content Script
 *
 * Listens for rule data from the inject.js fetch interceptor, then uses a
 * MutationObserver to watch the DOM for rule rows. When a row appears whose
 * display name matches a known rule, an invisible <a> overlay is placed on
 * top of the rule name so users can middle-click / Ctrl+click / right-click
 * → "Open in new tab".
 *
 * Strategy: Instead of mutating Angular's DOM (which gets overwritten by
 * change detection), we overlay an absolutely-positioned <a> tag on top
 * of each rule name element. The overlay is transparent but captures
 * middle-click, Ctrl+click, and right-click events.
 */
(() => {
  'use strict';

  const RULE_LINKER_MSG_TYPE = '__SECOPS_RULE_LINKER__';
  const OVERLAY_CLASS = 'rule-linker-overlay';

  // ── State ──────────────────────────────────────────────────────────────────

  /** @type {Map<string, string>} displayName → ruleId */
  const ruleMap = new Map();

  /** @type {MutationObserver|null} */
  let observer = null;

  /** Whether we've injected the page-world script */
  let injected = false;

  /** Debounce timer for processAllRows */
  let processTimer = null;

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  init();

  function init() {
    // Inject the fetch interceptor ASAP (into <head> or documentElement)
    // so it patches fetch before Angular makes API calls
    injectPageScript();
    listenForRuleData();

    // The DOM observer and URL watcher need <body> to exist.
    // At document_start, body may not exist yet.
    if (document.body) {
      startObserver();
      extractFromUrlNavigation();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        startObserver();
        extractFromUrlNavigation();
      });
    }
  }

  // ── 1. Inject page-world script ───────────────────────────────────────────

  function injectPageScript() {
    if (injected) return;
    injected = true;

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  // ── 2. Listen for rule data from inject.js ────────────────────────────────

  function listenForRuleData() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== RULE_LINKER_MSG_TYPE) return;

      if (event.data.action === 'rulesData') {
        const rules = event.data.rules || [];
        let newRulesAdded = false;

        for (const { displayName, ruleId } of rules) {
          if (displayName && ruleId && !ruleMap.has(displayName)) {
            ruleMap.set(displayName, ruleId);
            newRulesAdded = true;
          }
        }

        if (newRulesAdded) {
          console.log(`[Rule Linker] Updated rule map: ${ruleMap.size} rules`);
          // Re-process all visible rows since we now have new data
          scheduleProcessAllRows();
        }
      }

      if (event.data.action === 'interceptorReady') {
        console.log('[Rule Linker] Fetch interceptor ready');
      }
    });
  }

  // ── 3. URL-based rule ID extraction (fallback) ────────────────────────────

  /**
   * When the user clicks a rule and the URL changes, we can associate the
   * selected rule name with the rule ID from the URL. This serves as a
   * fallback when the fetch interceptor doesn't catch the API call (e.g.,
   * if the page was loaded before the extension).
   */
  function extractFromUrlNavigation() {
    let lastUrl = location.href;

    const checkUrl = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChanged(lastUrl);
      }
    };

    // Angular uses history.pushState, which doesn't fire popstate
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      origPushState.apply(this, args);
      checkUrl();
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      origReplaceState.apply(this, args);
      checkUrl();
    };

    window.addEventListener('popstate', checkUrl);

    // Also poll as a safety net
    setInterval(checkUrl, 1000);

    // Process the initial URL
    onUrlChanged(location.href);
  }

  function onUrlChanged(url) {
    const ruleId = extractRuleIdFromUrl(url);
    if (!ruleId) return;

    // Find the currently selected/highlighted row and associate its name
    requestAnimationFrame(() => {
      const selectedRow = document.querySelector(
        'tr.row-container.selected, tr.row-container.active, ' +
        'tr.row-container[class*="highlight"], tr.row-container[aria-selected="true"]'
      );

      if (selectedRow) {
        const nameEl = findRuleNameElement(selectedRow);
        if (nameEl) {
          const displayName = nameEl.textContent.trim();
          if (displayName && !ruleMap.has(displayName)) {
            ruleMap.set(displayName, ruleId);
            console.log(`[Rule Linker] Learned from URL: "${displayName}" → ${ruleId}`);
            scheduleProcessAllRows();
          }
        }
      }
    });
  }

  function extractRuleIdFromUrl(url) {
    const match = url.match(/\/rules\/((?:ru|ur)_[a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  // ── 4. DOM observation & overlay injection ────────────────────────────────

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      // Any DOM change in the table area could mean Angular re-rendered rows.
      // Schedule a re-processing pass.
      scheduleProcessAllRows();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial processing
    scheduleProcessAllRows();
  }

  /**
   * Debounced processing — Angular triggers many rapid mutations.
   */
  function scheduleProcessAllRows() {
    if (processTimer) return;
    processTimer = requestAnimationFrame(() => {
      processTimer = null;
      processAllRows();
    });
  }

  /**
   * Process all visible rule rows and add overlays where possible.
   */
  function processAllRows() {
    if (ruleMap.size === 0) return;

    const rows = document.querySelectorAll('tr.row-container');

    for (const row of rows) {
      processRow(row);
    }
  }

  /**
   * Process a single rule row: find the name element, look up the rule ID,
   * and place an <a> overlay on top of the name if we have a mapping.
   *
   * Instead of mutating Angular's DOM (which Angular will overwrite), we
   * place an absolutely-positioned <a> element on top of the rule name.
   * This overlay is transparent but captures middle-click, Ctrl+click,
   * and right-click events for "Open in new tab" functionality.
   */
  function processRow(row) {
    const nameEl = findRuleNameElement(row);
    if (!nameEl) return;

    const displayName = nameEl.textContent.trim();
    if (!displayName) return;

    const ruleId = ruleMap.get(displayName);
    if (!ruleId) return;

    // Check if we already have an overlay for this row
    const existingOverlay = row.querySelector(`.${OVERLAY_CLASS}`);
    if (existingOverlay) {
      // Update the href in case the URL context changed
      const newUrl = buildRuleUrl(ruleId);
      if (existingOverlay.href !== newUrl) {
        existingOverlay.href = newUrl;
      }
      // Reposition the overlay to match the current name element position
      repositionOverlay(existingOverlay, nameEl);
      return;
    }

    // Build the URL
    const ruleUrl = buildRuleUrl(ruleId);

    // Create the overlay link
    const overlay = document.createElement('a');
    overlay.href = ruleUrl;
    overlay.className = OVERLAY_CLASS;
    overlay.title = `Open "${displayName}" in new tab`;
    // Accessibility: invisible text for screen readers
    overlay.setAttribute('aria-label', `Open ${displayName} in new tab`);

    // Make the name element's parent the positioning context
    const positionParent = nameEl.closest('td') || nameEl.parentElement;
    if (positionParent && getComputedStyle(positionParent).position === 'static') {
      positionParent.style.position = 'relative';
    }

    // Position the overlay on top of the name element
    repositionOverlay(overlay, nameEl);

    // Event handling:
    // - Normal left-click: prevent default (let Angular handle it)
    // - Ctrl/Cmd+click: let the browser open in new tab
    // - Middle-click: let the browser open in new tab
    // - Right-click: let the browser show context menu with "Open in new tab"
    overlay.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click or Cmd+click → open in new tab
        e.stopPropagation();
        return; // let browser handle the link
      }
      // Normal left-click → prevent link navigation, let Angular handle via row click
      e.preventDefault();
      // Don't stop propagation so Angular's row click handler fires
    });

    overlay.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        // Middle-click → open in new tab
        e.stopPropagation();
        // Browser handles this natively for <a> tags
      }
    });

    // Insert the overlay into the positioning parent
    positionParent.appendChild(overlay);
  }

  /**
   * Position an overlay element to cover the name element.
   */
  function repositionOverlay(overlay, nameEl) {
    const parent = overlay.parentElement || nameEl.closest('td') || nameEl.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const nameRect = nameEl.getBoundingClientRect();

    overlay.style.position = 'absolute';
    overlay.style.top = `${nameRect.top - parentRect.top}px`;
    overlay.style.left = `${nameRect.left - parentRect.left}px`;
    overlay.style.width = `${nameRect.width}px`;
    overlay.style.height = `${nameRect.height}px`;
  }

  /**
   * Find the rule name text element within a row.
   * DOM structure (observed):
   *   tr.row-container
   *     > td[data-test-column-id="displayName"]
   *       > div.cell > div.cell-renderer-wrapper > sc-link-cell-component
   *         > smp-highlight > div.source > div.text.u-ellipsis
   */
  function findRuleNameElement(row) {
    // Primary selector: specific column
    let el = row.querySelector(
      'td[data-test-column-id="displayName"] div.text.u-ellipsis'
    );
    if (el) return el;

    // Fallback: look for link-text variant
    el = row.querySelector(
      'td[data-test-column-id="displayName"] div.link-text.u-ellipsis'
    );
    if (el) return el;

    // Fallback: smp-highlight text div
    el = row.querySelector('smp-highlight div.text.u-ellipsis');
    if (el) return el;

    el = row.querySelector('smp-highlight div.link-text.u-ellipsis');
    if (el) return el;

    // Fallback: sc-icon-cell text
    el = row.querySelector('sc-icon-cell div.text');
    if (el) return el;

    // Last resort: first td text content
    el = row.querySelector('td:first-child div.text');
    return el;
  }

  /**
   * Build a full URL for a rule, preserving the current saved view context.
   */
  function buildRuleUrl(ruleId) {
    const currentUrl = new URL(location.href);
    const base = currentUrl.origin;

    // Preserve savedViewId if present in current URL
    const savedViewId = currentUrl.searchParams.get('savedViewId');
    const params = new URLSearchParams();

    if (savedViewId) {
      params.set('savedViewId', savedViewId);
    }
    params.set('view', 'full');
    params.set('tab', 'logic');

    return `${base}/rules/${ruleId}?${params.toString()}`;
  }
})();

/**
 * inject.js — Page-world fetch interceptor for SecOps Rule Linker
 *
 * This script runs in the page's main world (not the content script sandbox)
 * so it can intercept the page's own fetch() calls. It captures rules API
 * responses and posts the displayName → ruleId mapping to the content script
 * via window.postMessage.
 */
(() => {
  'use strict';

  const RULE_LINKER_MSG_TYPE = '__SECOPS_RULE_LINKER__';

  // Keep track of the original fetch
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // Match rules list API calls.
      if (isRulesListResponse(url)) {
        // Clone the response so we don't consume the body
        const clone = response.clone();
        clone.json().then(data => {
          const rules = extractRules(data);
          if (rules.length > 0) {
            window.postMessage({
              type: RULE_LINKER_MSG_TYPE,
              action: 'rulesData',
              rules: rules
            }, '*');
          }
        }).catch(() => {
          // Silently ignore non-JSON responses or parse errors
        });
      }
    } catch (e) {
      // Never break the page's fetch behavior
    }

    return response;
  };

  /**
   * Determine if a URL is a rules list API call.
   */
  function isRulesListResponse(url) {
    // Match various Chronicle/SecOps API patterns for rules listing
    //
    // Real endpoint observed:
    //   https://us-chronicle.googleapis.com/v1alpha/projects/.../rules?filter=...
    return (
      /chronicle\.googleapis\.com\/.*\/rules\?/.test(url) ||
      /chronicle\.googleapis\.com\/.*\/rules$/.test(url) ||
      /\/detect\/rules\?/.test(url) ||
      /\/detect\/rules$/.test(url) ||
      /\/rules:search/.test(url) ||
      /\/rules:batchGet/.test(url) ||
      /ListRules/.test(url) ||
      /SearchRules/.test(url)
    );
  }

  /**
   * Extract rule name → ID pairs from various API response formats.
   * Chronicle APIs can return data in several structures.
   */
  function extractRules(data) {
    const rules = [];

    // Try common response shapes
    const candidates = [
      data?.rules,
      data?.response?.rules,
      data?.results,
      data?.response?.results,
      data?.detectionRules,
      data?.response,
      // Sometimes the response is an array directly
      Array.isArray(data) ? data : null
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        for (const item of candidate) {
          const rule = parseRuleItem(item);
          if (rule) rules.push(rule);
        }
        if (rules.length > 0) break;
      }
    }

    // Also handle paginated responses where rules are nested
    if (rules.length === 0 && data && typeof data === 'object') {
      deepSearchForRules(data, rules, 0);
    }

    return rules;
  }

  /**
   * Parse a single rule item from the API response.
   */
  function parseRuleItem(item) {
    if (!item || typeof item !== 'object') return null;

    // Try to find the rule ID
    const ruleId = item.ruleId || item.id || item.rule_id ||
      item.ruleIdentifier || item.resourceName ||
      extractRuleIdFromName(item.name);

    // Try to find the display name
    const displayName = item.displayName || item.ruleName ||
      item.display_name || item.rule_name || item.title;

    if (ruleId && displayName) {
      return { ruleId: normalizeRuleId(ruleId), displayName };
    }

    // Some responses nest the rule data
    if (item.rule) {
      return parseRuleItem(item.rule);
    }

    return null;
  }

  /**
   * Extract rule ID from a resource name like "projects/.../rules/ru_xxxx"
   */
  function extractRuleIdFromName(name) {
    if (!name || typeof name !== 'string') return null;
    const match = name.match(/rules\/((?:ru|ur)_[a-f0-9-]+)/i);
    return match ? match[1] : null;
  }

  /**
   * Normalize a rule ID to the short form (ru_xxx or ur_xxx).
   */
  function normalizeRuleId(id) {
    if (!id || typeof id !== 'string') return id;
    // If it's already short form, return as-is
    if (/^(ru|ur)_[a-f0-9-]+$/i.test(id)) return id;
    // Extract from resource name
    const match = id.match(/((?:ru|ur)_[a-f0-9-]+)/i);
    return match ? match[1] : id;
  }

  /**
   * Recursively search an object for arrays that look like rule lists.
   * Security: Uses hasOwn check and blocks prototype-polluting keys
   * to prevent prototype traversal from untrusted API data.
   */
  function deepSearchForRules(obj, results, depth) {
    if (depth > 4 || results.length > 0) return;
    if (!obj || typeof obj !== 'object') return;

    // Security: Only iterate own properties, skip prototype-polluting keys
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    for (const key of Object.keys(obj)) {
      if (BLOCKED_KEYS.has(key)) continue;
      if (!Object.hasOwn(obj, key)) continue;

      const val = obj[key];
      if (Array.isArray(val) && val.length > 0 && val[0]?.ruleId) {
        for (const item of val) {
          const rule = parseRuleItem(item);
          if (rule) results.push(rule);
        }
        return;
      }
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        deepSearchForRules(val, results, depth + 1);
      }
    }
  }

  // Signal that the interceptor is loaded
  window.postMessage({
    type: RULE_LINKER_MSG_TYPE,
    action: 'interceptorReady'
  }, '*');
})();

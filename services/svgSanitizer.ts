import DOMPurify from 'dompurify';

const URI_ATTRS = new Set(['href', 'xlink:href']);
let hooksInstalled = false;

const ensureHooks = () => {
  if (hooksInstalled) return;

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const attr = data.attrName.toLowerCase();
    const value = (data.attrValue || '').trim();
    const valueLower = value.toLowerCase();

    // 1. Strip inline event handlers
    if (attr.startsWith('on')) {
      data.keepAttr = false;
      return;
    }

    // 2. Rescue 'fill="none"' and 'stroke="none"'
    // DOMPurify's strict color/URI regex sometimes drops the word "none".
    // We force-keep it so your transparent wireframes don't turn solid black.
    if ((attr === 'fill' || attr === 'stroke') && valueLower === 'none') {
      data.keepAttr = true;
      data.forceKeepAttr = true;
      return;
    }

    // 3. Fix the missing wheels (<use href="#wheel">)
    if (URI_ATTRS.has(attr)) {
      const isLocalRef = value.startsWith('#');
      const isImageDataUri = valueLower.startsWith('data:image/');

      if (!isLocalRef && !isImageDataUri) {
        data.keepAttr = false;
      } else {
        data.keepAttr = true;
        data.forceKeepAttr = true;
      }
      return;
    }

    // 4. Fix the broken inline animations (style="animation-delay: 0.1s;")
    if (attr === 'style') {
      if (valueLower.includes('javascript:') || valueLower.includes('expression(')) {
        data.keepAttr = false;
      } else {
        data.keepAttr = true;
        data.forceKeepAttr = true;
      }
    }
  });

  hooksInstalled = true;
};

export const sanitizeSvg = (rawSvg: string): string => {
  if (!rawSvg) return '';
  ensureHooks();

  return DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style', 'use', 'animate', 'animateTransform', 'animateMotion'],
    // 5. Added 'pointer-events' to the allowlist so overlay layers don't block clicks
    ADD_ATTR: ['href', 'xlink:href', 'pointer-events'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'foreignObject'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }) as string;
};
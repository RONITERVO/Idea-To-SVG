import DOMPurify from 'dompurify';

const URI_ATTRS = new Set(['href', 'xlink:href']);
let hooksInstalled = false;

const ensureHooks = () => {
  if (hooksInstalled) return;

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const attr = data.attrName.toLowerCase();
    const value = (data.attrValue || '').trim();
    const valueLower = value.toLowerCase();

    if (attr.startsWith('on')) {
      data.keepAttr = false;
      return;
    }

    if (URI_ATTRS.has(attr)) {
      const isLocalRef = value.startsWith('#');
      const isImageDataUri = valueLower.startsWith('data:image/');
      if (!isLocalRef && !isImageDataUri) {
        data.keepAttr = false;
      }
      return;
    }

    if (attr === 'style') {
      if (valueLower.includes('javascript:') || valueLower.includes('expression(')) {
        data.keepAttr = false;
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
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'foreignObject'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }) as string;
};

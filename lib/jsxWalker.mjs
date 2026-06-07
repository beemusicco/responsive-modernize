/**
 * JSX AST walker — production-grade replacement for regex-based JSX traversal.
 *
 * Uses acorn + acorn-jsx to parse source files into AST, then visits each
 * JSXElement node with its full ancestor chain. This lets codemods check
 * actual semantic context (e.g. "am I inside a <nav>?") instead of guessing
 * from className tokens, which fails on utility-only Tailwind.
 *
 * @typedef {object} ElementContext
 * @property {string} tagName - Lowercase tag name ('nav', 'div', etc.) or PascalCase component name
 * @property {Array<{name: string, valueStart: number, valueEnd: number, valueRaw: string, kind: 'string'|'expression'|'boolean'}>} attrs
 * @property {Array<string>} ancestorTags - Tag names from immediate parent up to root, [] if root
 * @property {number} start - Byte offset of element start in source
 * @property {number} end - Byte offset of element end in source
 * @property {number} openingEnd - Byte offset after opening tag close `>`
 * @property {boolean} selfClosing
 * @property {number} childElementCount - Number of immediate JSXElement children
 * @property {Array<string>} childTagNames - Tag names of immediate JSXElement children
 */

import {Parser} from 'acorn';
import jsx from 'acorn-jsx';

const JSXParser = Parser.extend(jsx());

/**
 * Parse JSX source + walk every JSXElement, calling visitor with ElementContext.
 * Visitor may return {newAttrs: string} to replace the attrs span verbatim,
 * or {fullReplacement: string} to replace the whole element.
 *
 * Returns: {out: string, edits: number} — transformed source + count of changes.
 *
 * Failure mode: if parse fails (TS-specific syntax, decorators, etc.), returns
 * {out: src, edits: 0, parseError: e.message}. Caller can decide to skip the
 * file or fall back to regex pass.
 *
 * @param {string} src - Raw source code (JSX/TSX)
 * @param {(ctx: ElementContext) => ({newAttrs?: string, fullReplacement?: string} | null | undefined)} visitor
 * @returns {{out: string, edits: number, parseError?: string}}
 */
export function walkJSX(src, visitor) {
  let ast;
  try {
    // Wrap src in a function body to make it parseable even if it's a fragment.
    // Use top-level program for full files (.tsx/.jsx exports etc.).
    ast = JSXParser.parse(src, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
    });
  } catch (e) {
    return {out: src, edits: 0, parseError: e.message};
  }

  /** @type {Array<{start: number, end: number, replacement: string}>} */
  const edits = [];

  function visitElement(node, ancestors) {
    if (!node) return;
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
      const isFragment = node.type === 'JSXFragment';
      const tagName = isFragment ? '__FRAGMENT__' : nameOf(node.openingElement.name);
      const ancestorTags = ancestors.map((a) => a.tagName);
      const children = Array.isArray(node.children) ? node.children : [];
      const childElems = children.filter((c) => c && (c.type === 'JSXElement' || c.type === 'JSXFragment'));
      const childTagNames = childElems.map((c) => c.type === 'JSXFragment' ? '__FRAGMENT__' : nameOf(c.openingElement.name));

      let attrs = [];
      let openingStart = node.start, openingEnd = node.end;
      let selfClosing = false;
      if (!isFragment) {
        openingStart = node.openingElement.start;
        openingEnd = node.openingElement.end;
        selfClosing = !!node.openingElement.selfClosing;
        attrs = node.openingElement.attributes.map((attr) => {
          if (attr.type === 'JSXSpreadAttribute') {
            return {name: '__spread__', valueStart: attr.start, valueEnd: attr.end, valueRaw: src.slice(attr.start, attr.end), kind: 'expression'};
          }
          const name = attr.name && attr.name.name ? attr.name.name : nameOf(attr.name);
          if (!attr.value) {
            return {name, valueStart: attr.start, valueEnd: attr.end, valueRaw: '', kind: 'boolean'};
          }
          if (attr.value.type === 'Literal') {
            return {name, valueStart: attr.value.start, valueEnd: attr.value.end, valueRaw: src.slice(attr.value.start, attr.value.end), kind: 'string'};
          }
          if (attr.value.type === 'JSXExpressionContainer') {
            return {name, valueStart: attr.value.start, valueEnd: attr.value.end, valueRaw: src.slice(attr.value.start, attr.value.end), kind: 'expression'};
          }
          return {name, valueStart: attr.value.start, valueEnd: attr.value.end, valueRaw: src.slice(attr.value.start, attr.value.end), kind: 'expression'};
        });
      }

      const ctx = {
        tagName,
        attrs,
        ancestorTags,
        start: node.start,
        end: node.end,
        openingStart,
        openingEnd,
        selfClosing,
        childElementCount: childElems.length,
        childTagNames,
      };

      const result = visitor(ctx);
      if (result) {
        if (result.fullReplacement != null) {
          edits.push({start: node.start, end: node.end, replacement: result.fullReplacement});
        } else if (result.newAttrs != null && !isFragment) {
          // Replace attrs span — preserve `<tagName` prefix and `>`/`/>`.
          const openingTagEnd = openingEnd;
          // Find position right after tagName end (skip whitespace + closing `>`/`/>`)
          const tagNameEnd = node.openingElement.name.end;
          // Replacement spans from end of tagName to before `>` or `/>`
          const closeSlice = src.slice(openingTagEnd - 2, openingTagEnd);
          const closeStr = closeSlice === '/>' ? '/>' : '>';
          const closeStart = openingTagEnd - closeStr.length;
          edits.push({start: tagNameEnd, end: closeStart, replacement: result.newAttrs});
        }
      }

      // Recurse children with this element as new ancestor
      const newAncestors = ancestors.concat([ctx]);
      for (const child of children) {
        visitElement(child, newAncestors);
      }
      return;
    }
    // Walk into containing nodes
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (key === 'parent' || key === 'loc' || key === 'range') continue;
      if (Array.isArray(v)) {
        for (const item of v) if (item && typeof item === 'object' && item.type) visitElement(item, ancestors);
      } else if (v && typeof v === 'object' && v.type) {
        visitElement(v, ancestors);
      }
    }
  }

  visitElement(ast, []);

  if (edits.length === 0) return {out: src, edits: 0};
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of edits) {
    out += src.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  out += src.slice(cursor);
  return {out, edits: edits.length};
}

function nameOf(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${nameOf(node.object)}.${nameOf(node.property)}`;
  if (node.type === 'JSXNamespacedName') return `${nameOf(node.namespace)}:${nameOf(node.name)}`;
  return '';
}

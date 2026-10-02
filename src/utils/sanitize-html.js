// 剪贴板 HTML 净化器（白名单）
//
// 剪贴板内容来自任意网页或文档，属于不可信输入，阅读器会把它渲染进 iframe。
// 用 DOMParser 而非正则剥标签：正则会被畸形嵌套、未闭合标签、属性里藏尖括号
// 等构造绕过（如 <scr<script>ipt>），只有真实解析才能保证树结构正确。
//
// 规则：
//   1. 危险元素连内容一起删除（script/style/iframe…）；
//   2. 未知元素只脱标签、保留文本，避免排版信息全丢；
//   3. 属性逐个过滤：on*、srcdoc、id/name 等一律不允许；
//   4. href/src 只放行 http(s)/mailto/tel 与图片 data:，挡掉 javascript:；
//   5. style 保留（Word/网页粘贴大量依赖内联样式），但拒绝含
//      url()/expression/javascript: 的取值。

// 连内容一起删除：这些元素的内容本身没有展示价值，且是注入的主要载体
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "noscript", "template", "form", "input", "button", "select", "option", "optgroup",
  "textarea", "link", "meta", "base", "title", "canvas", "audio", "video", "source",
  "track", "portal", "svg", "math", "xmp", "plaintext", "listing",
]);

// 允许保留的结构/排版标签
const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br",
  "caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "details",
  "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "footer", "h1",
  "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "ins", "kbd",
  "li", "main", "mark", "nav", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s",
  "samp", "section", "small", "span", "strike", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul",
  "var", "wbr",
]);

// 允许出现在任意允许标签上的属性
const GLOBAL_ATTRS = new Set(["class", "title", "dir", "lang", "style", "align", "valign"]);

// 允许出现在特定标签上的额外属性
const TAG_ATTRS = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "border", "hspace", "vspace"]),
  td: new Set(["colspan", "rowspan", "width", "height", "nowrap"]),
  th: new Set(["colspan", "rowspan", "width", "height", "nowrap", "scope"]),
  col: new Set(["span", "width"]),
  colgroup: new Set(["span", "width"]),
  ol: new Set(["start", "type"]),
  ul: new Set(["type"]),
  li: new Set(["value"]),
  time: new Set(["datetime"]),
  del: new Set(["datetime", "cite"]),
  ins: new Set(["datetime", "cite"]),
  blockquote: new Set(["cite"]),
  q: new Set(["cite"]),
  details: new Set(["open"]),
  font: new Set(["color", "face", "size"]),
};

// 只放行这些协议的显式 URL
const SAFE_URL_SCHEME = /^(?:https?|mailto|tel):/i;
// data: 仅放行位图，svg+xml 可携带脚本，明确排除
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon)[;,]/i;

// style 里这些取值能引入外部请求或旧式脚本执行
const UNSAFE_STYLE_PATTERN = /url\s*\(|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding|@import/i;

function isSafeStyle(value) {
  return !UNSAFE_STYLE_PATTERN.test(String(value || ""));
}

// 去掉控制字符与全部空白后再判断，避免 "java\tscript:" 之类的绕过
function compactUrl(value) {
  return String(value == null ? "" : value).trim().replace(/[\x00- ]+/g, "");
}

function isSafeUrl(value, { allowImageData = false } = {}) {
  const url = compactUrl(value);
  if (!url) return false;
  if (url.startsWith("#")) return true;
  if (allowImageData && SAFE_IMAGE_DATA_URL.test(url)) return true;
  if (SAFE_URL_SCHEME.test(url)) return true;
  // 无协议前缀的相对地址（无冒号，或冒号出现在首个 / ? # 之后）视为同源相对路径
  const colon = url.indexOf(":");
  if (colon === -1) return true;
  const firstDelim = [url.indexOf("/"), url.indexOf("?"), url.indexOf("#")]
    .filter((i) => i !== -1)
    .sort((a, b) => a - b)[0];
  return firstDelim !== undefined && colon > firstDelim;
}

// 脱去标签但保留子节点
function unwrap(element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

function sanitizeElement(element, tag) {
  const allowed = TAG_ATTRS[tag];
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();

    if (name.startsWith("on")) {
      element.removeAttribute(attr.name);
      continue;
    }
    if (name === "style") {
      if (isSafeStyle(attr.value)) element.setAttribute("style", attr.value);
      else element.removeAttribute("style");
      continue;
    }
    if (!GLOBAL_ATTRS.has(name) && !(allowed && allowed.has(name))) {
      element.removeAttribute(attr.name);
      continue;
    }
    if (name === "href" && !isSafeUrl(attr.value)) {
      element.removeAttribute(attr.name);
      continue;
    }
    if (name === "src" && !isSafeUrl(attr.value, { allowImageData: true })) {
      element.removeAttribute(attr.name);
    }
  }

  // 外链一律补 noopener，避免新窗口里的 tabnabbing
  if (tag === "a" && element.hasAttribute("target")) {
    element.setAttribute("rel", "noopener noreferrer nofollow");
  }
}

function sanitizeChildren(parent) {
  // 迭代快照：unwrap/remove 会改动实时的 childNodes 列表
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 8 /* COMMENT_NODE */) {
      node.remove();
      continue;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue; // 文本节点原样保留

    const tag = node.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      node.remove();
      continue;
    }

    sanitizeElement(node, tag);

    // 必须先净化子节点再 unwrap：unwrap 挪进 parent 的节点不会被快照再次访问，
    // 否则未知标签（如 <marquee>）能夹带 script/style 穿透白名单
    sanitizeChildren(node);

    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(node);
    }
  }
}

/**
 * 按白名单净化一段 HTML 字符串。
 * @param {string} html 原始 HTML（可能来自剪贴板，不可信）
 * @returns {string} 净化后的 HTML 片段
 */
export function sanitizeHtml(html) {
  if (!html) return "";
  const source = String(html);
  const doc = new DOMParser().parseFromString(source, "text/html");
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}

export default sanitizeHtml;

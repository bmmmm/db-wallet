// Just enough DOM to drive the action-code panel (action-codes.js
// initActionCodesUi) from Node: createElement, a children tree, listeners and
// click(). No layout, no selectors — tests walk the tree with find()/findAll().
class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = Object.create(null);
    this.attributes = Object.create(null);
    this.style = {};
    this.dataset = {};
    this.value = "";
    this.type = "";
    this.className = "";
    this.id = "";
    this.hidden = false;
    this.disabled = false;
    this.title = "";
    this.open = false;
    this._text = "";
    const self = this;
    this.classList = {
      add: (...names) => {
        const set = new Set(self.className.split(/\s+/).filter(Boolean));
        for (const n of names) set.add(n);
        self.className = Array.from(set).join(" ");
      },
      remove: (...names) => {
        const drop = new Set(names);
        self.className = self.className
          .split(/\s+/)
          .filter((n) => n && !drop.has(n))
          .join(" ");
      },
      toggle: (name, force) => {
        const has = self.classList.contains(name);
        const want = force === undefined ? !has : !!force;
        if (want) self.classList.add(name);
        else self.classList.remove(name);
        return want;
      },
      contains: (name) => self.className.split(/\s+/).includes(name),
    };
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  set innerHTML(v) {
    this.children = [];
    this._text = String(v || "");
  }
  get innerHTML() {
    return this.textContent;
  }
  get childNodes() {
    return this.children;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children;
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }
  insertAdjacentElement(where, el) {
    const parent = this.parentNode;
    if (where === "afterend" && parent) return parent.insertBefore(el, this.nextSibling);
    if (where === "beforebegin" && parent) return parent.insertBefore(el, this);
    if (where === "afterbegin") return this.insertBefore(el, this.children[0] || null);
    return this.appendChild(el);
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    const m = matcher(sel);
    return findAll(this, (el) => el !== this && m(el));
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }
  dispatch(type) {
    for (const fn of (this.listeners[type] || []).slice()) {
      fn({ type, target: this, preventDefault() {}, stopPropagation() {} });
    }
  }
  click() {
    this.dispatch("click");
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }
  removeAttribute(k) {
    delete this.attributes[k];
  }
  closest() {
    return null;
  }
  focus() {}
  select() {}
  setSelectionRange() {}
  getContext() {
    return null; // drawQrToCanvas returns early without a 2d context
  }
  toBlob() {}
  toDataURL() {
    return "";
  }
}

function makeFakeDocument() {
  const doc = {
    body: new FakeElement("body"),
    documentElement: new FakeElement("html"),
    createElement: (tag) => new FakeElement(tag),
    addEventListener() {},
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
  };
  return doc;
}

// Single simple selector only: "#id", ".class", "tag", "tag.class".
function matcher(sel) {
  const s = String(sel).trim();
  if (s.startsWith("#")) return (el) => el.id === s.slice(1);
  const [tag, cls] = s.split(".");
  return (el) =>
    (!tag || el.tagName === tag.toUpperCase()) &&
    (!cls || el.classList.contains(cls));
}

// A document for booting wallet.html's scripts: every element of the real page
// that carries an id or a class is created (flat under <body>, no nesting), so
// getElementById/querySelector find what wallet-ui.js looks up. Listeners on
// the document are kept; `doc._fire("DOMContentLoaded")` runs them and returns
// their results (the boot handler's promise).
function makePageDocument(html) {
  const doc = makeFakeDocument();
  const listeners = Object.create(null);
  doc.addEventListener = (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  };
  doc.removeEventListener = (type, fn) => {
    listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
  };
  doc._fire = (type) =>
    (listeners[type] || []).slice().map((fn) => fn({ type, target: doc }));
  const bodyTag = html.indexOf("<body");
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  re.lastIndex = bodyTag < 0 ? 0 : bodyTag;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    if (tag === "body" || tag === "script") continue;
    const attrs = m[2];
    const id = /\bid="([^"]*)"/.exec(attrs);
    const cls = /\bclass="([^"]*)"/.exec(attrs);
    if (!id && !cls && tag !== "h1") continue;
    const el = new FakeElement(tag);
    if (id) el.id = id[1];
    if (cls) el.className = cls[1];
    const st = /\bstyle="display:\s*none"/.exec(attrs);
    if (st) el.style.display = "none";
    doc.body.appendChild(el);
  }
  doc.getElementById = (id) => find(doc.body, (el) => el.id === id);
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  return doc;
}

function findAll(root, pred, out = []) {
  if (pred(root)) out.push(root);
  for (const c of root.children) findAll(c, pred, out);
  return out;
}

function find(root, pred) {
  return findAll(root, pred)[0] || null;
}

// The first <button> under `root` whose own text is exactly `text`.
function button(root, text) {
  const b = find(root, (el) => el.tagName === "BUTTON" && el._text === text);
  if (!b) throw new Error(`button "${text}" not found`);
  return b;
}

// The action-code card whose label is `label`.
function card(root, label) {
  return find(
    root,
    (el) =>
      el.classList.contains("action-code-card") &&
      !!find(
        el,
        (c) => c.classList.contains("action-code-label") && c._text === label,
      ),
  );
}

module.exports = {
  FakeElement,
  makeFakeDocument,
  makePageDocument,
  find,
  findAll,
  button,
  card,
};

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

module.exports = { FakeElement, makeFakeDocument, find, findAll, button, card };

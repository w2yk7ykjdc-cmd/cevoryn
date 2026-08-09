/**
 * Minimal jsdom environment registration for component/hook tests that need
 * a DOM. Imported explicitly by the test files that need it — the plain
 * unit-test suite (the vast majority of test/**\/*.test.ts) never touches
 * this and is unaffected.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const { window } = dom;

function copyProps(src: typeof window, target: typeof globalThis) {
  const props = Object.getOwnPropertyNames(src)
    .filter((prop) => !(prop in target))
    .reduce(
      (result, prop) => ({
        ...result,
        [prop]: Object.getOwnPropertyDescriptor(src, prop),
      }),
      {}
    );
  Object.defineProperties(target, props);
}

globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.document = window.document;
Object.defineProperty(globalThis, "navigator", {
  value: window.navigator,
  configurable: true,
  writable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

copyProps(window, globalThis);

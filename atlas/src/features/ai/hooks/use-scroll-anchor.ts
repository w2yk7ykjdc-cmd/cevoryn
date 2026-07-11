"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a scrollable container pinned to the bottom
 * when new content is added (unless the user has scrolled up).
 */
export function useScrollAnchor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el) return;
      const threshold = 100;
      isAtBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // MutationObserver to auto-scroll when content changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      if (isAtBottomRef.current) {
        scrollToBottom();
      }
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [scrollToBottom]);

  return { containerRef, scrollToBottom };
}

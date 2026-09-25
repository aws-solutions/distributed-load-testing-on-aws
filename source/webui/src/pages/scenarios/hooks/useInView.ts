// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";

/**
 * Defers work until an element scrolls near the viewport. Attach the returned
 * `ref` to a container; `inView` flips to true once it approaches the viewport
 * and stays true thereafter. Used to lazy-mount expensive sections (e.g. Test
 * Runs, whose hook fetches the full run history) so they don't load on initial
 * page mount for users who never scroll to them.
 *
 * Falls back to `true` when IntersectionObserver is unavailable (SSR, older
 * browsers, jsdom tests), so content still renders.
 */
export function useInView<T extends Element>(rootMargin = "200px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (inView || !ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

import { useEffect, useRef } from 'react';

export default function useAutoAdjust(designWidth = 420) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let badge: HTMLDivElement | null = null;

    const ensureBadge = () => {
      if (!badge) {
        badge = document.createElement('div');
        badge.style.position = 'fixed';
        badge.style.right = '12px';
        badge.style.top = '12px';
        badge.style.zIndex = '9999';
        badge.style.padding = '6px 8px';
        badge.style.background = 'rgba(0,0,0,0.6)';
        badge.style.color = 'white';
        badge.style.fontSize = '12px';
        badge.style.borderRadius = '6px';
        badge.style.pointerEvents = 'none';
        badge.textContent = 'Scaled to fit';
        document.body.appendChild(badge);
      }
    };

    const removeBadge = () => {
      if (badge) {
        try { document.body.removeChild(badge); } catch {}
        badge = null;
      }
    };

    const apply = () => {
      const w = window.innerWidth || document.documentElement.clientWidth;
      const scale = Math.min(1, w / designWidth);
      el.style.transformOrigin = 'top center';
      if (scale < 0.995) {
        el.style.width = `${designWidth}px`;
        el.style.margin = '0 auto';
        el.style.transform = `scale(${scale})`;
        el.style.position = 'relative';
        ensureBadge();
      } else {
        el.style.width = '';
        el.style.margin = '';
        el.style.transform = '';
        el.style.position = '';
        removeBadge();
      }
    };

    apply();
    let tid: number | undefined;
    const onResize = () => {
      if (tid) window.clearTimeout(tid);
      tid = window.setTimeout(() => apply(), 80) as unknown as number;
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      removeBadge();
      if (tid) window.clearTimeout(tid as unknown as number);
    };
  }, [designWidth]);

  return ref;
}

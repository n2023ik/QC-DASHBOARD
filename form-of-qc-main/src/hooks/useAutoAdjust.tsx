import { useEffect, useRef } from 'react';

export default function useAutoAdjust(designWidth = 420) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = () => {
      const w = window.innerWidth || document.documentElement.clientWidth;
      const scale = Math.min(1, w / designWidth);
      el.style.transformOrigin = 'top center';
      if (scale < 0.995) {
        el.style.width = `${designWidth}px`;
        el.style.margin = '0 auto';
        el.style.transform = `scale(${scale})`;
        el.style.position = 'relative';
      } else {
        el.style.width = '';
        el.style.margin = '';
        el.style.transform = '';
        el.style.position = '';
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
      if (tid) window.clearTimeout(tid as unknown as number);
    };
  }, [designWidth]);

  return ref;
}

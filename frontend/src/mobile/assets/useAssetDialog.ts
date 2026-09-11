import { useEffect, useRef } from 'react';

export function useAssetDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const target = dialog.current;
    const previous = document.activeElement;
    target?.showModal();
    // Start on the heading, so opening a viewer does not highlight its first
    // action. Tab still reaches the controls with normal focus indicators.
    target?.querySelector<HTMLElement>('header')?.focus({ preventScroll: true });
    return () => {
      target?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return dialog;
}

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { FileAsset } from '../api';
import { FileAssetCard } from './FileAssetCard';

afterEach(() => { cleanup(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close'); });

it('keeps an individual share open when streaming turns its card into a stack', () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  const first = { id: 'a', title: 'First file', name: 'first.pdf', kind: 'pdf', size: 1, mediaType: 'application/pdf' } as FileAsset;
  const second = { ...first, id: 'b', title: 'Second file', name: 'second.pdf' };
  const view = render(<FileAssetCard assets={[first]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share file: First file' }));
  expect(screen.getByRole('dialog', { name: 'Share files' })).toBeDefined();
  view.rerender(<FileAssetCard assets={[first, second]} />);
  const sharing = screen.getByRole('dialog', { name: 'Share files' });
  expect(within(sharing).getByText('First file')).toBeDefined();
  expect(within(sharing).queryByText('Second file')).toBeNull();
  expect(screen.getByRole('button', { name: 'Open 2 files' })).toBeDefined();
});

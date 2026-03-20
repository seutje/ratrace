import { OverlayMode } from '../sim/types';

export type OverlayOption = {
  mode: OverlayMode;
  label: string;
};

export const overlayOptions: OverlayOption[] = [
  { mode: 'none', label: 'Clear' },
  { mode: 'traffic', label: 'Traffic' },
  { mode: 'hunger', label: 'Hunger' },
  { mode: 'energy', label: 'Energy' },
  { mode: 'wallet', label: 'Wallet' },
  { mode: 'housing', label: 'Housing' },
  { mode: 'businessCash', label: 'Cash' },
  { mode: 'retailStock', label: 'Retail Stock' },
];

export const getOverlayModeLabel = (mode: OverlayMode) =>
  overlayOptions.find((option) => option.mode === mode)?.label ?? 'Clear';

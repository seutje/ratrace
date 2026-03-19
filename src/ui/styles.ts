type ClassName = string | false | null | undefined;

export const cx = (...classNames: ClassName[]) => classNames.filter(Boolean).join(' ');

export const displayHeadingClass =
  "font-['Avenir Next Condensed','Franklin Gothic Medium','Arial Narrow',sans-serif] tracking-[0.04em]";

export const labelClass =
  "font-mono text-[0.74rem] uppercase tracking-[0.14em] text-[#6a5c4f]";

const panelSurfaceClass =
  'rounded-[18px] border border-[rgba(60,40,20,0.14)] bg-[rgba(255,252,246,0.74)] shadow-[0_18px_36px_rgba(84,49,15,0.09)]';

export const panelClass = `${panelSurfaceClass} p-4`;

export const panelHeadingClass = `${displayHeadingClass} mb-3 text-[1.12rem]`;

export const hudCardClass = `${panelSurfaceClass} flex min-h-full flex-col gap-0.5 px-4 py-[14px]`;

export const buttonClass = [
  'rounded-xl',
  'border-0',
  'bg-[linear-gradient(180deg,#f4e2c5_0%,#e6c998_100%)]',
  'px-3',
  'py-2.5',
  'text-[#281a11]',
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_18px_rgba(113,74,29,0.08)]',
  'transition-[transform,filter]',
  'duration-150',
  'ease-out',
  'hover:-translate-y-px',
  'hover:brightness-[1.02]',
  'disabled:cursor-not-allowed',
  'disabled:transform-none',
  'disabled:saturate-[0.7]',
  'disabled:opacity-[0.55]',
].join(' ');

export const selectedButtonClass =
  'bg-[linear-gradient(180deg,#251710_0%,#4d3023_100%)] text-[#fff7ea] hover:brightness-100';

export const drawerClass = [
  'pointer-events-auto',
  'absolute',
  'flex',
  'flex-col',
  'overflow-hidden',
  'rounded-[22px]',
  'border',
  'border-[rgba(69,43,19,0.16)]',
  'bg-[rgba(255,249,239,0.78)]',
  'shadow-[0_28px_64px_rgba(61,36,15,0.18)]',
  'backdrop-blur-[18px]',
  'max-[720px]:left-3',
  'max-[720px]:right-3',
  'max-[720px]:rounded-[18px]',
].join(' ');

export const drawerHeaderClass = [
  'flex',
  'items-start',
  'justify-between',
  'gap-4',
  'px-[14px]',
  'pb-3',
  'pt-[14px]',
  'min-[721px]:px-[18px]',
  'min-[721px]:pb-[14px]',
  'min-[721px]:pt-4',
].join(' ');

export const drawerBodyClass =
  'min-h-0 overflow-y-auto px-3 pb-3 min-[721px]:px-4 min-[721px]:pb-4';

export const drawerPillClass =
  'inline-flex items-center rounded-full bg-[#231811] px-[11px] py-[7px] font-mono text-[0.76rem] text-[#fbf5e9]';

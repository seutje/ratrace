import { useState, type ReactNode } from 'react';
import {
  buttonClass,
  cx,
  displayHeadingClass,
  drawerBodyClass,
  drawerClass,
  drawerHeaderClass,
  labelClass,
} from './styles';

type DrawerProps = {
  title: string;
  className?: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  children: ReactNode;
};

export const Drawer = ({ title, className, defaultOpen = true, summary, children }: DrawerProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const toggleLabel = `${open ? 'Hide' : 'Show'} ${title}`;

  return (
    <section className={cx(drawerClass, className, !open && 'w-auto')}>
      <header className={drawerHeaderClass}>
        <div className="min-w-0">
          <span className={labelClass}>Drawer</span>
          <h2 className={cx(displayHeadingClass, 'm-0')}>{title}</h2>
        </div>
        <div className="flex items-center gap-2.5">
          {summary}
          <button
            type="button"
            className={cx(buttonClass, 'min-w-[76px]')}
            aria-label={toggleLabel}
            onClick={() => setOpen((currentOpen) => !currentOpen)}
          >
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </header>
      <div className={drawerBodyClass} hidden={!open}>
        {children}
      </div>
    </section>
  );
};

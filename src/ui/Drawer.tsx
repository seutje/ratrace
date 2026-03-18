import { useState, type ReactNode } from 'react';

type DrawerProps = {
  title: string;
  className?: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  children: ReactNode;
};

export const Drawer = ({ title, className, defaultOpen = true, summary, children }: DrawerProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`drawer ${open ? 'open' : 'collapsed'} ${className ?? ''}`.trim()}>
      <header className="drawer-header">
        <div>
          <span className="label">Drawer</span>
          <h2>{title}</h2>
        </div>
        <div className="drawer-actions">
          {summary}
          <button type="button" className="drawer-toggle" onClick={() => setOpen((currentOpen) => !currentOpen)}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </header>
      <div className="drawer-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
};

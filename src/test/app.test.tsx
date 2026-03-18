import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../app/App';
import { useWorldStore } from '../app/store';

describe('App', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    useWorldStore.setState({ buildMode: 'select', overlayMode: 'none' });
  });

  it('renders the main HUD and canvas shell', () => {
    render(<App />);

    expect(screen.getByText('RatRace')).toBeInTheDocument();
    expect(screen.getByText('World Time')).toBeInTheDocument();
    expect(screen.getByLabelText('RatRace world canvas')).toBeInTheDocument();
    expect(screen.getByText('Zoom')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('updates the visible zoom level when controls are used', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Show Tools' }));
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByText('200%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Zoom' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('switches overlay modes from the overlays drawer', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Show Overlays' }));
    fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));

    expect(useWorldStore.getState().overlayMode).toBe('traffic');
    expect(screen.getByRole('button', { name: 'Traffic' })).toHaveClass('selected');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'Traffic' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('activates follow mode from the inspector and deactivates it when the map is dragged', async () => {
    const agentId = useWorldStore.getState().world.entities.agents[0]!.id;
    useWorldStore.getState().selectAgent(agentId);

    render(<App />);

    const followButton = screen.getByRole('button', { name: 'Follow' });
    expect(followButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(followButton);
    expect(followButton).toHaveAttribute('aria-pressed', 'true');

    const canvas = screen.getByLabelText('RatRace world canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 640,
      height: 640,
      left: 0,
      right: 960,
      top: 0,
      width: 960,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(canvas, { button: 0, buttons: 1, clientX: 120, clientY: 120, pointerId: 1 });
    fireEvent.pointerMove(canvas, { buttons: 1, clientX: 132, clientY: 132, pointerId: 1 });

    await waitFor(() => {
      expect(followButton).toHaveAttribute('aria-pressed', 'false');
    });
  });
});

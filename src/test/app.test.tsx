import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../app/App';
import { useWorldStore } from '../app/store';

describe('App', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    useWorldStore.setState({ buildMode: 'select' });
  });

  it('renders the main HUD and canvas shell', () => {
    render(<App />);

    expect(screen.getByText('RatRace')).toBeInTheDocument();
    expect(screen.getByText('World Time')).toBeInTheDocument();
    expect(screen.getByLabelText('RatRace world canvas')).toBeInTheDocument();
    expect(screen.getByText('Zoom')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('updates the visible zoom level when controls are used', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByText('50%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset Zoom' }));
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});

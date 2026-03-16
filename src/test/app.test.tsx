import { render, screen } from '@testing-library/react';
import { App } from '../app/App';

describe('App', () => {
  it('renders the main HUD and canvas shell', () => {
    render(<App />);

    expect(screen.getByText('RatRace')).toBeInTheDocument();
    expect(screen.getByText('World Time')).toBeInTheDocument();
    expect(screen.getByLabelText('RatRace world canvas')).toBeInTheDocument();
  });
});

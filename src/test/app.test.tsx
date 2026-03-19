import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../app/App';
import { useWorldStore } from '../app/store';
import { Inspector } from '../ui/Inspector';

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

  it('shows family and roommate relationships in the inspector', () => {
    const world = structuredClone(useWorldStore.getState().world);
    const [selected, roommate, coParent, childA, childB, parentA, parentB] = world.entities.agents;

    selected!.name = 'Selected Agent';
    roommate!.name = 'Room Mate';
    coParent!.name = 'Co Parent';
    childA!.name = 'Kid Alpha';
    childB!.name = 'Kid Beta';
    parentA!.name = 'Parent One';
    parentB!.name = 'Parent Two';

    roommate!.homeId = selected!.homeId;
    coParent!.homeId = parentA!.homeId;
    childA!.homeId = parentA!.homeId;
    childB!.homeId = parentB!.homeId;
    selected!.coParentIds = [coParent!.id];
    selected!.childIds = [childA!.id, childB!.id];
    selected!.parentIds = [parentA!.id, parentB!.id];
    coParent!.coParentIds = [selected!.id];
    coParent!.childIds = [childA!.id, childB!.id];
    childA!.parentIds = [selected!.id, coParent!.id];
    childB!.parentIds = [selected!.id, coParent!.id];

    useWorldStore.setState({
      selectedAgentSnapshot: undefined,
      world: {
        ...world,
        selectedAgentId: selected!.id,
      },
    });

    render(<Inspector followActive={false} onFollowToggle={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Room Mate' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Co Parent' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Kid Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kid Beta' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parent One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parent Two' })).toBeInTheDocument();
  });

  it('retargets the inspector when a relationship name is clicked', () => {
    const world = structuredClone(useWorldStore.getState().world);
    const [selected, roommate, coParent, childA] = world.entities.agents;

    selected!.name = 'Selected Agent';
    roommate!.name = 'Room Mate';
    coParent!.name = 'Co Parent';
    childA!.name = 'Kid Alpha';

    roommate!.homeId = selected!.homeId;
    coParent!.homeId = roommate!.homeId;
    childA!.homeId = world.entities.agents[4]!.homeId;
    selected!.coParentIds = [coParent!.id];
    selected!.childIds = [childA!.id];
    coParent!.coParentIds = [selected!.id];

    useWorldStore.setState({
      selectedAgentSnapshot: undefined,
      world: {
        ...world,
        selectedAgentId: selected!.id,
      },
    });

    render(<Inspector followActive={false} onFollowToggle={() => undefined} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Co Parent' })[0]!);

    expect(useWorldStore.getState().world.selectedAgentId).toBe(coParent!.id);
    expect(screen.getByText('Co Parent', { selector: 'strong' })).toBeInTheDocument();
  });
});

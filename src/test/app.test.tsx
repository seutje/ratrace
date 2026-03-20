import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../app/App';
import { buildCanvasUiModel, defaultCanvasDrawerState, type CanvasDrawerState, type CanvasUiAction } from '../render/canvasUi';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from '../render/canvasRenderer';
import { useWorldStore } from '../app/store';

type LocalCanvasUiState = {
  drawers: CanvasDrawerState;
  followActive: boolean;
  zoom: number;
};

const CANVAS_RECT: DOMRect = {
  bottom: 640,
  height: 640,
  left: 0,
  right: 960,
  top: 0,
  width: 960,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

const createLocalCanvasUiState = (): LocalCanvasUiState => ({
  drawers: { ...defaultCanvasDrawerState },
  followActive: false,
  zoom: DEFAULT_ZOOM,
});

const getCanvasUiState = (localState: LocalCanvasUiState) => {
  const store = useWorldStore.getState();
  return {
    buildMode: store.buildMode,
    drawers: localState.drawers,
    followActive: localState.followActive,
    height: 640,
    overlayMode: store.overlayMode,
    paused: store.paused,
    selectedAgentSnapshot: store.selectedAgentSnapshot,
    width: 960,
    world: store.world,
    zoom: localState.zoom,
  };
};

const applyLocalAction = (localState: LocalCanvasUiState, action: CanvasUiAction): LocalCanvasUiState => {
  switch (action.type) {
    case 'toggleDrawer':
      return {
        ...localState,
        drawers: {
          ...localState.drawers,
          [action.drawer]: !localState.drawers[action.drawer],
        },
      };
    case 'toggleFollow':
      return {
        ...localState,
        followActive: !localState.followActive,
      };
    case 'zoomIn':
      return {
        ...localState,
        zoom: Math.min(MAX_ZOOM, localState.zoom * 2),
      };
    case 'zoomOut':
      return {
        ...localState,
        zoom: Math.max(MIN_ZOOM, localState.zoom / 2),
      };
    case 'resetZoom':
      return {
        ...localState,
        zoom: DEFAULT_ZOOM,
      };
    default:
      return localState;
  }
};

const clickCanvasControl = (label: string, localState: LocalCanvasUiState) => {
  const canvas = screen.getByLabelText('RatRace world canvas');
  const model = buildCanvasUiModel(getCanvasUiState(localState));
  const element = model.elements.find((entry) => entry.label === label);

  expect(element).toBeDefined();

  const clientX = Math.floor(element!.rect.x + element!.rect.width / 2);
  const clientY = Math.floor(element!.rect.y + element!.rect.height / 2);
  fireEvent.pointerDown(canvas, { button: 0, buttons: 1, clientX, clientY, pointerId: 1 });
  fireEvent.pointerUp(canvas, { button: 0, buttons: 1, clientX, clientY, pointerId: 1 });

  return applyLocalAction(localState, element!.action);
};

describe('App', () => {
  beforeEach(() => {
    useWorldStore.getState().reset();
    useWorldStore.setState({ buildMode: 'select', overlayMode: 'none' });
  });

  it('renders the canvas shell with the expected canvas UI model', () => {
    render(<App />);

    const canvas = screen.getByLabelText('RatRace world canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);

    expect(canvas).toBeInTheDocument();

    const model = buildCanvasUiModel(getCanvasUiState(createLocalCanvasUiState()));
    expect(model.panels.map((panel) => panel.title)).toEqual(['Overview', 'Overlays', 'Tools', 'Inspector']);
    expect(model.metricCards.map((card) => card.label)).toEqual(['World Time', 'Population', 'Treasury']);
    expect(model.elements.some((entry) => entry.label === 'Show Tools')).toBe(true);
    expect(model.elements.find((entry) => entry.label === 'Show Overlays')?.rect.width).toBeGreaterThanOrEqual(120);
    expect(model.elements.some((entry) => entry.label === 'Reset Zoom')).toBe(false);
    expect(model.metricCards[0]!.rect.y).toBeGreaterThan(model.panels[0]!.bodyRect!.y + 40);
  });

  it('updates the visible zoom level when the canvas is scrolled', async () => {
    render(<App />);

    const canvas = screen.getByLabelText('RatRace world canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);

    fireEvent.wheel(canvas, { clientX: 480, clientY: 320, deltaY: -500 });

    await waitFor(() => {
      expect(Number(canvas.getAttribute('data-zoom'))).toBeGreaterThan(1);
    });
  });

  it('switches overlay modes from the canvas overlays drawer', () => {
    render(<App />);

    const canvas = screen.getByLabelText('RatRace world canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);

    let localState = createLocalCanvasUiState();
    localState = clickCanvasControl('Show Overlays', localState);
    localState = clickCanvasControl('Traffic', localState);

    expect(useWorldStore.getState().overlayMode).toBe('traffic');

    const model = buildCanvasUiModel(getCanvasUiState(localState));
    expect(model.elements.find((entry) => entry.label === 'Traffic')?.active).toBe(true);
  });

  it('activates follow mode from the canvas inspector and deactivates it when the map is dragged', async () => {
    const agentId = useWorldStore.getState().world.entities.agents[0]!.id;
    useWorldStore.getState().selectAgent(agentId);

    render(<App />);

    const canvas = screen.getByLabelText('RatRace world canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);

    let localState = createLocalCanvasUiState();
    localState = clickCanvasControl('Follow', localState);

    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-follow-active', 'true');
    });

    fireEvent.pointerDown(canvas, { button: 0, buttons: 1, clientX: 400, clientY: 250, pointerId: 1 });
    fireEvent.pointerMove(canvas, { buttons: 1, clientX: 412, clientY: 262, pointerId: 1 });

    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-follow-active', 'false');
    });
  });

  it('shows family and roommate relationships in the canvas inspector model', () => {
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

    const model = buildCanvasUiModel(getCanvasUiState(createLocalCanvasUiState()));
    const labels = model.elements.map((entry) => entry.label);
    const relationshipButtons = model.elements
      .filter((entry) =>
        ['Room Mate', 'Co Parent', 'Kid Alpha', 'Kid Beta', 'Parent One', 'Parent Two'].includes(entry.label),
      )
      .sort((left, right) => left.rect.y - right.rect.y);

    expect(labels).toContain('Room Mate');
    expect(labels.filter((label) => label === 'Co Parent').length).toBeGreaterThan(0);
    expect(labels).toContain('Kid Alpha');
    expect(labels).toContain('Kid Beta');
    expect(labels).toContain('Parent One');
    expect(labels).toContain('Parent Two');
    expect(model.panels[3]!.rect.height).toBeGreaterThanOrEqual(420);
    for (let index = 1; index < relationshipButtons.length; index += 1) {
      expect(relationshipButtons[index]!.rect.y).toBeGreaterThanOrEqual(
        relationshipButtons[index - 1]!.rect.y + relationshipButtons[index - 1]!.rect.height,
      );
    }
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

    render(<App />);

    const canvas = screen.getByLabelText('RatRace world canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(CANVAS_RECT);

    clickCanvasControl('Co Parent', createLocalCanvasUiState());

    expect(useWorldStore.getState().world.selectedAgentId).toBe(coParent!.id);
  });
});

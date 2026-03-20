import { DynamicAgentSnapshot } from '../sim/simulationWorkerTypes';
import { BuildMode, OverlayMode, TileType, WorldState } from '../sim/types';
import { formatClock } from '../sim/utils';
import {
  inspectorSexLabels,
  inspectorStateColors,
  resolveInspectorData,
  type RelationshipEntry,
} from '../ui/inspectorData';
import { overlayOptions } from '../ui/overlayOptions';

export type Rect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type CanvasUiPoint = {
  x: number;
  y: number;
};

export type CanvasDrawerId = 'inspector' | 'overview' | 'overlays' | 'tools';

export type CanvasDrawerState = Record<CanvasDrawerId, boolean>;

export type CanvasUiAction =
  | { drawer: CanvasDrawerId; type: 'toggleDrawer' }
  | { type: 'togglePause' }
  | { type: 'singleStep' }
  | { type: 'resetSimulation' }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'resetZoom' }
  | { mode: BuildMode; type: 'setBuildMode' }
  | { mode: OverlayMode; type: 'setOverlayMode' }
  | { type: 'toggleFollow' }
  | { agentId: string; type: 'selectAgent' };

export type CanvasUiElement = {
  action: CanvasUiAction;
  active?: boolean;
  disabled?: boolean;
  id: string;
  kind: 'button' | 'link';
  label: string;
  rect: Rect;
};

export type CanvasUiPanel = {
  bodyRect?: Rect;
  open: boolean;
  rect: Rect;
  summary?: string;
  summaryRect?: Rect;
  title: string;
  toggleRect: Rect;
  toggleElementId: string;
};

type MetricCard = {
  caption: string;
  label: string;
  rect: Rect;
  value: string;
};

type OverviewLayout = {
  cards: MetricCard[];
  introRect: Rect;
};

type InspectorRow = {
  label: string;
  values: string[];
};

type InspectorRelationSection = {
  entries: RelationshipEntry[];
  label: string;
};

export type CanvasUiModel = {
  elements: CanvasUiElement[];
  inspectorRows: InspectorRow[];
  metricCards: MetricCard[];
  panels: CanvasUiPanel[];
};

export type CanvasUiLayoutState = {
  buildMode: BuildMode;
  drawers: CanvasDrawerState;
  followActive: boolean;
  height: number;
  overlayMode: OverlayMode;
  paused: boolean;
  selectedAgentSnapshot?: DynamicAgentSnapshot;
  width: number;
  world: WorldState;
  zoom: number;
};

const OVERLAYS_DRAWER_HEIGHT = 250;
const PANEL_HEADER_HEIGHT = 56;
const PANEL_PADDING = 14;
const PANEL_WIDTH_OVERVIEW_DESKTOP = 672;
const PANEL_WIDTH_OVERVIEW_TABLET = 552;
const PANEL_WIDTH_OVERLAYS_DESKTOP = 300;
const PANEL_WIDTH_OVERLAYS_TABLET = 320;
const PANEL_WIDTH_TOOLS_DESKTOP = 360;
const PANEL_WIDTH_TOOLS_TABLET = 420;
const PANEL_WIDTH_INSPECTOR_DESKTOP = 360;
const PANEL_WIDTH_INSPECTOR_TABLET = 320;

export const defaultCanvasDrawerState: CanvasDrawerState = {
  inspector: true,
  overview: true,
  overlays: false,
  tools: false,
};

const buildModeOptions: { label: string; mode: BuildMode }[] = [
  { label: 'Select', mode: 'select' },
  { label: 'Road', mode: TileType.Road },
  { label: 'Zone Res', mode: TileType.Residential },
  { label: 'Zone Comm', mode: TileType.Commercial },
  { label: 'Zone Ind', mode: TileType.Industrial },
];

const textColor = '#281a11';
const subduedTextColor = '#5f4c3a';
const panelFill = 'rgba(255, 247, 234, 0.9)';
const panelStroke = 'rgba(68, 45, 21, 0.2)';
const cardFill = 'rgba(255, 251, 242, 0.92)';
const cardStroke = 'rgba(92, 62, 35, 0.12)';
const accentFill = '#9f4e27';
const accentStroke = '#763414';
const selectedFill = '#3c6c90';
const selectedStroke = '#214a67';
const disabledFill = 'rgba(122, 110, 97, 0.24)';
const disabledStroke = 'rgba(91, 74, 57, 0.2)';
const linkFill = 'rgba(240, 233, 222, 0.86)';
const buttonHorizontalPadding = 14;
const buttonGap = 8;
const inspectorLabelWidth = 118;
const inspectorLineHeight = 18;
const inspectorRowGap = 8;
const inspectorLinkHeight = 28;
const inspectorLinkGap = 6;
const inspectorRelationshipButtonOffset = 12;

const buttonTextWidthFactor = 8.1;
const monoTextWidthFactor = 7.15;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const containsPoint = (rect: Rect, point: CanvasUiPoint) =>
  point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

const makeRect = (x: number, y: number, width: number, height: number): Rect => ({
  height,
  width,
  x,
  y,
});

const estimateTextWidth = (text: string, kind: 'button' | 'mono' | 'title' = 'mono') => {
  const factor = kind === 'button' ? buttonTextWidthFactor : kind === 'title' ? 12 : monoTextWidthFactor;
  return Math.ceil(text.length * factor);
};

const getButtonWidth = (label: string, minimum = 56) =>
  Math.max(minimum, estimateTextWidth(label, 'button') + buttonHorizontalPadding * 2);

const wrapTextToWidth = (value: string, width: number) => {
  if (value.length === 0) {
    return [''];
  }

  const maxChars = Math.max(6, Math.floor(width / monoTextWidthFactor));
  if (value.length <= maxChars) {
    return [value];
  }

  const words = value.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
    if (candidate.length <= maxChars) {
      currentLine = candidate;
      continue;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > maxChars) {
      lines.push(remaining.slice(0, maxChars - 1));
      remaining = remaining.slice(maxChars - 1);
    }
    currentLine = remaining;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
};

const getToggleRect = (panelRect: Rect, label: string) =>
  makeRect(panelRect.x + panelRect.width - getButtonWidth(label, 88) - PANEL_PADDING, panelRect.y + 12, getButtonWidth(label, 88), 32);

const getSummaryRect = (panelRect: Rect, toggleRect: Rect, summary: string | undefined) => {
  if (!summary) {
    return undefined;
  }

  const width = estimateTextWidth(summary, 'mono') + 24;
  return makeRect(toggleRect.x - width - buttonGap, panelRect.y + 14, width, 24);
};

const getOverviewContentHeight = (panelWidth: number) => {
  if (panelWidth >= 560) {
    return 140;
  }

  return 284;
};

const getInspectorRelationshipSectionHeight = (entryCount: number) => {
  if (entryCount === 0) {
    return inspectorLineHeight + inspectorRowGap;
  }

  const stackHeight = entryCount * inspectorLinkHeight + (entryCount - 1) * inspectorLinkGap;
  return Math.max(inspectorLineHeight, stackHeight) + inspectorRowGap;
};

const getOverviewLayout = (bodyRect: Rect, world: WorldState): OverviewLayout => {
  const cardHeight = 74;
  const gap = 12;

  if (bodyRect.width >= 560) {
    const cardWidth = Math.floor((bodyRect.width - gap * 2) / 3);
    const cardsY = bodyRect.y + 58;

    return {
      cards: [
        {
          caption: `day ${world.day}`,
          label: 'World Time',
          rect: makeRect(bodyRect.x, cardsY, cardWidth, cardHeight),
          value: formatClock(world.minutesOfDay),
        },
        {
          caption: `cap ${world.metrics.populationCapacity}`,
          label: 'Population',
          rect: makeRect(bodyRect.x + cardWidth + gap, cardsY, cardWidth, cardHeight),
          value: String(world.entities.agents.length),
        },
        {
          caption: `wealth ${world.economy.totalWealth}`,
          label: 'Treasury',
          rect: makeRect(bodyRect.x + (cardWidth + gap) * 2, cardsY, cardWidth, cardHeight),
          value: `$${world.economy.treasury}`,
        },
      ],
      introRect: makeRect(bodyRect.x, bodyRect.y + 4, bodyRect.width, 44),
    };
  }

  const cardsY = bodyRect.y + 58;

  return {
    cards: [
      {
        caption: `day ${world.day}`,
        label: 'World Time',
        rect: makeRect(bodyRect.x, cardsY, bodyRect.width, cardHeight),
        value: formatClock(world.minutesOfDay),
      },
      {
        caption: `cap ${world.metrics.populationCapacity}`,
        label: 'Population',
        rect: makeRect(bodyRect.x, cardsY + cardHeight + gap, bodyRect.width, cardHeight),
        value: String(world.entities.agents.length),
      },
      {
        caption: `wealth ${world.economy.totalWealth}`,
        label: 'Treasury',
        rect: makeRect(bodyRect.x, cardsY + (cardHeight + gap) * 2, bodyRect.width, cardHeight),
        value: `$${world.economy.treasury}`,
      },
    ],
    introRect: makeRect(bodyRect.x, bodyRect.y + 4, bodyRect.width, 44),
  };
};

const getOverviewRect = (width: number, drawers: CanvasDrawerState) => {
  const mobile = width <= 720;
  const tablet = width <= 960;
  const panelWidth = mobile
    ? Math.max(280, width - 24)
    : Math.min(tablet ? PANEL_WIDTH_OVERVIEW_TABLET : PANEL_WIDTH_OVERVIEW_DESKTOP, width - 36);
  const heightValue = drawers.overview ? getOverviewContentHeight(panelWidth) + PANEL_HEADER_HEIGHT + PANEL_PADDING : PANEL_HEADER_HEIGHT;
  const y = mobile ? 12 : 18;
  return makeRect(Math.floor((width - panelWidth) / 2), y, panelWidth, heightValue);
};

const getOverlaysRect = (width: number, drawers: CanvasDrawerState) => {
  const mobile = width <= 720;
  const tablet = width <= 960;
  const panelWidth = mobile
    ? Math.max(280, width - 24)
    : Math.min(tablet ? PANEL_WIDTH_OVERLAYS_TABLET : PANEL_WIDTH_OVERLAYS_DESKTOP, width - 36);
  const y = mobile ? 136 : 18;
  const heightValue = drawers.overlays ? OVERLAYS_DRAWER_HEIGHT : PANEL_HEADER_HEIGHT;
  return makeRect(mobile ? 12 : 18, y, panelWidth, heightValue);
};

const getToolsRect = (width: number, height: number, drawers: CanvasDrawerState) => {
  const mobile = width <= 720;
  const tablet = width <= 960;
  const panelWidth = mobile
    ? Math.max(280, width - 24)
    : Math.min(tablet ? PANEL_WIDTH_TOOLS_TABLET : PANEL_WIDTH_TOOLS_DESKTOP, width - 32);
  const panelHeight = drawers.tools ? getToolsContentHeight() + PANEL_HEADER_HEIGHT + PANEL_PADDING : PANEL_HEADER_HEIGHT;
  const x = mobile ? 12 : tablet ? width - panelWidth - 18 : 18;
  const y = height - panelHeight - (mobile ? 12 : 18);
  return makeRect(x, y, panelWidth, panelHeight);
};

const getToolsContentHeight = () => {
  let height = 0;
  height += 12;
  height += 26 + 36;
  height += 26;
  height += 3 * 44;
  return height + 8;
};

const getInspectorContentHeight = (selectedAgentSnapshot: DynamicAgentSnapshot | undefined, world: WorldState, panelWidth: number) => {
  const details = resolveInspectorData(world, selectedAgentSnapshot);
  if (!details.agent) {
    return 126;
  }
  const bodyWidth = panelWidth - PANEL_PADDING * 2;
  const valueWidth = Math.max(96, bodyWidth - inspectorLabelWidth - 10);
  const rows = buildInspectorRows({
    buildMode: 'select',
    drawers: defaultCanvasDrawerState,
    followActive: false,
    height: 0,
    overlayMode: 'none',
    paused: false,
    selectedAgentSnapshot,
    width: panelWidth,
    world,
    zoom: 1,
  });
  const relationshipSections: InspectorRelationSection[] = [
    { label: 'Roommates', entries: details.roommates },
    { label: 'Had Child With', entries: details.coParents },
    { label: 'Children', entries: details.children },
    { label: 'Parents', entries: details.parents },
  ];

  let height = 0;
  height += 24;
  height += 42 + 36 + 20;
  height += 30;
  for (const row of rows) {
    const lines = row.values.flatMap((value) => wrapTextToWidth(value, valueWidth));
    height += lines.length * inspectorLineHeight + inspectorRowGap;
  }

  for (const section of relationshipSections) {
    height += getInspectorRelationshipSectionHeight(section.entries.length);
  }

  return height + 16;
};

const getInspectorRect = (width: number, height: number, drawers: CanvasDrawerState, state: CanvasUiLayoutState) => {
  const mobile = width <= 720;
  const tablet = width <= 960;
  const panelWidth = mobile
    ? Math.max(280, width - 24)
    : Math.min(tablet ? PANEL_WIDTH_INSPECTOR_TABLET : PANEL_WIDTH_INSPECTOR_DESKTOP, width - 32);
  const desiredHeight = drawers.inspector
    ? getInspectorContentHeight(state.selectedAgentSnapshot, state.world, panelWidth) + PANEL_HEADER_HEIGHT + PANEL_PADDING
    : PANEL_HEADER_HEIGHT;
  const maxHeight = mobile ? Math.max(160, height - 356) : tablet ? 420 : height - 36;
  const panelHeight = clamp(desiredHeight, PANEL_HEADER_HEIGHT, maxHeight);
  const x = mobile ? 12 : tablet ? 18 : width - panelWidth - 18;
  const y = mobile ? 344 : tablet ? height - panelHeight - 18 : 18;
  return makeRect(x, y, panelWidth, panelHeight);
};

const addButton = (
  elements: CanvasUiElement[],
  label: string,
  rect: Rect,
  action: CanvasUiAction,
  options: Partial<Pick<CanvasUiElement, 'active' | 'disabled' | 'kind'>> = {},
) => {
  const id = `${action.type}:${label}:${elements.length}`;
  const element: CanvasUiElement = {
    action,
    active: options.active,
    disabled: options.disabled,
    id,
    kind: options.kind ?? 'button',
    label,
    rect,
  };
  elements.push(element);
  return element;
};

const buildOverviewPanel = (state: CanvasUiLayoutState, elements: CanvasUiElement[]): { metricCards: MetricCard[]; panel: CanvasUiPanel } => {
  const rect = getOverviewRect(state.width, state.drawers);
  const toggleLabel = `${state.drawers.overview ? 'Hide' : 'Show'} Overview`;
  const toggleRect = getToggleRect(rect, toggleLabel);
  const summaryRect = getSummaryRect(rect, toggleRect, state.paused ? 'Paused' : 'Live');
  const panel: CanvasUiPanel = {
    bodyRect: state.drawers.overview ? makeRect(rect.x + PANEL_PADDING, rect.y + PANEL_HEADER_HEIGHT, rect.width - PANEL_PADDING * 2, rect.height - PANEL_HEADER_HEIGHT - PANEL_PADDING) : undefined,
    open: state.drawers.overview,
    rect,
    summary: state.paused ? 'Paused' : 'Live',
    summaryRect,
    title: 'Overview',
    toggleRect,
    toggleElementId: addButton(elements, toggleLabel, toggleRect, {
      drawer: 'overview',
      type: 'toggleDrawer',
    }).id,
  };

  if (!state.drawers.overview || !panel.bodyRect) {
    return { metricCards: [], panel };
  }

  const cards = getOverviewLayout(panel.bodyRect, state.world).cards;

  return { metricCards: cards, panel };
};

const buildToolsPanel = (state: CanvasUiLayoutState, elements: CanvasUiElement[]): CanvasUiPanel => {
  const rect = getToolsRect(state.width, state.height, state.drawers);
  const toggleLabel = `${state.drawers.tools ? 'Hide' : 'Show'} Tools`;
  const toggleRect = getToggleRect(rect, toggleLabel);
  const panel: CanvasUiPanel = {
    bodyRect: state.drawers.tools ? makeRect(rect.x + PANEL_PADDING, rect.y + PANEL_HEADER_HEIGHT, rect.width - PANEL_PADDING * 2, rect.height - PANEL_HEADER_HEIGHT - PANEL_PADDING) : undefined,
    open: state.drawers.tools,
    rect,
    title: 'Tools',
    toggleRect,
    toggleElementId: addButton(elements, toggleLabel, toggleRect, {
      drawer: 'tools',
      type: 'toggleDrawer',
    }).id,
  };

  if (!state.drawers.tools || !panel.bodyRect) {
    return panel;
  }

  const bodyRect = panel.bodyRect;
  const thirdWidth = Math.floor((bodyRect.width - 16) / 3);
  addButton(elements, state.paused ? 'Resume' : 'Pause', makeRect(bodyRect.x, bodyRect.y + 26, thirdWidth, 36), {
    type: 'togglePause',
  });
  addButton(elements, 'Step', makeRect(bodyRect.x + thirdWidth + 8, bodyRect.y + 26, thirdWidth, 36), {
    type: 'singleStep',
  });
  addButton(elements, 'Reset', makeRect(bodyRect.x + (thirdWidth + 8) * 2, bodyRect.y + 26, thirdWidth, 36), {
    type: 'resetSimulation',
  });

  const buildTop = bodyRect.y + 92;
  const buildWidth = Math.floor((bodyRect.width - 8) / 2);
  buildModeOptions.forEach((option, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    addButton(
      elements,
      option.label,
      makeRect(bodyRect.x + column * (buildWidth + 8), buildTop + row * 44, buildWidth, 36),
      { mode: option.mode, type: 'setBuildMode' },
      { active: state.buildMode === option.mode },
    );
  });

  return panel;
};

const buildOverlaysPanel = (state: CanvasUiLayoutState, elements: CanvasUiElement[]): CanvasUiPanel => {
  const rect = getOverlaysRect(state.width, state.drawers);
  const toggleLabel = `${state.drawers.overlays ? 'Hide' : 'Show'} Overlays`;
  const toggleRect = getToggleRect(rect, toggleLabel);
  const panel: CanvasUiPanel = {
    bodyRect: state.drawers.overlays ? makeRect(rect.x + PANEL_PADDING, rect.y + PANEL_HEADER_HEIGHT, rect.width - PANEL_PADDING * 2, rect.height - PANEL_HEADER_HEIGHT - PANEL_PADDING) : undefined,
    open: state.drawers.overlays,
    rect,
    title: 'Overlays',
    toggleRect,
    toggleElementId: addButton(elements, toggleLabel, toggleRect, {
      drawer: 'overlays',
      type: 'toggleDrawer',
    }).id,
  };

  if (!state.drawers.overlays || !panel.bodyRect) {
    return panel;
  }

  const bodyRect = panel.bodyRect;
  const buttonWidth = Math.floor((bodyRect.width - 8) / 2);
  overlayOptions.forEach((option, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    addButton(
      elements,
      option.label,
      makeRect(bodyRect.x + column * (buttonWidth + 8), bodyRect.y + row * 44, buttonWidth, 36),
      { mode: option.mode, type: 'setOverlayMode' },
      { active: state.overlayMode === option.mode },
    );
  });

  return panel;
};

const buildInspectorRows = (state: CanvasUiLayoutState) => {
  const inspector = resolveInspectorData(state.world, state.selectedAgentSnapshot);
  if (!inspector.agent) {
    return [];
  }

  const agent = inspector.agent;
  return [
    { label: 'Age', values: [String(agent.age)] },
    { label: 'Sex', values: [inspectorSexLabels[agent.sex]] },
    { label: 'Wallet', values: [`$${agent.wallet}`] },
    { label: 'Lunches', values: [String(agent.carriedMeals)] },
    { label: 'Hunger', values: [agent.stats.hunger.toFixed(1)] },
    { label: 'Energy', values: [agent.stats.energy.toFixed(1)] },
    { label: 'Happiness', values: [agent.stats.happiness.toFixed(1)] },
    {
      label: 'Traits',
      values: [
        `A ${agent.traits.appetite.toFixed(2)} / S ${agent.traits.stamina.toFixed(2)}`,
        `T ${agent.traits.thrift.toFixed(2)} / R ${agent.traits.resilience.toFixed(2)}`,
      ],
    },
    { label: 'Home', values: [inspector.home?.label ?? 'None'] },
    { label: 'Work', values: [inspector.work?.label ?? 'None'] },
    {
      label: 'Pantry',
      values: [inspector.home ? `${inspector.home.pantryStock}/${inspector.home.pantryCapacity}` : 'None'],
    },
    {
      label: 'Memory',
      values: [
        `Avg ${agent.memory.averageCommuteMinutes.toFixed(0)}m / Max ${agent.memory.longestCommuteMinutes.toFixed(0)}m`,
        `Shops ${agent.memory.shoppingTrips} / Shifts ${agent.memory.completedShifts}`,
      ],
    },
    {
      label: 'Hardship',
      values: [`${agent.memory.recentHardshipDays}d, unpaid ${agent.memory.unpaidHours}h`],
    },
    { label: 'Path Count', values: [String(agent.routeComputeCount)] },
  ];
};

const buildInspectorPanel = (
  state: CanvasUiLayoutState,
  elements: CanvasUiElement[],
): { inspectorRows: InspectorRow[]; panel: CanvasUiPanel } => {
  const rect = getInspectorRect(state.width, state.height, state.drawers, state);
  const toggleLabel = `${state.drawers.inspector ? 'Hide' : 'Show'} Inspector`;
  const toggleRect = getToggleRect(rect, toggleLabel);
  const panel: CanvasUiPanel = {
    bodyRect: state.drawers.inspector ? makeRect(rect.x + PANEL_PADDING, rect.y + PANEL_HEADER_HEIGHT, rect.width - PANEL_PADDING * 2, rect.height - PANEL_HEADER_HEIGHT - PANEL_PADDING) : undefined,
    open: state.drawers.inspector,
    rect,
    title: 'Inspector',
    toggleRect,
    toggleElementId: addButton(elements, toggleLabel, toggleRect, {
      drawer: 'inspector',
      type: 'toggleDrawer',
    }).id,
  };

  if (!state.drawers.inspector || !panel.bodyRect) {
    return { inspectorRows: [], panel };
  }

  const bodyRect = panel.bodyRect;
  const inspector = resolveInspectorData(state.world, state.selectedAgentSnapshot);
  const inspectorRows = buildInspectorRows(state);
  if (!inspector.agent) {
    return { inspectorRows, panel };
  }

  addButton(
    elements,
    'Follow',
    makeRect(bodyRect.x, bodyRect.y + 42, bodyRect.width, 36),
    { type: 'toggleFollow' },
    { active: state.followActive },
  );

  const valueX = bodyRect.x + inspectorLabelWidth;
  const valueWidth = bodyRect.width - inspectorLabelWidth;
  let relationY = bodyRect.y + 130;
  for (const row of inspectorRows) {
    const lines = row.values.flatMap((value) => wrapTextToWidth(value, valueWidth - 10));
    relationY += lines.length * inspectorLineHeight + inspectorRowGap;
  }

  for (const section of [
    { label: 'Roommates', entries: inspector.roommates },
    { label: 'Had Child With', entries: inspector.coParents },
    { label: 'Children', entries: inspector.children },
    { label: 'Parents', entries: inspector.parents },
  ] satisfies InspectorRelationSection[]) {
    if (section.entries.length === 0) {
      relationY += getInspectorRelationshipSectionHeight(0);
      continue;
    }

    let buttonY = relationY - inspectorRelationshipButtonOffset;
    for (const entry of section.entries) {
      addButton(
        elements,
        entry.name,
        makeRect(valueX, buttonY, valueWidth - 10, inspectorLinkHeight),
        { agentId: entry.id, type: 'selectAgent' },
        { kind: 'link' },
      );
      buttonY += inspectorLinkHeight + inspectorLinkGap;
    }

    relationY += getInspectorRelationshipSectionHeight(section.entries.length);
  }

  return { inspectorRows, panel };
};

export const buildCanvasUiModel = (state: CanvasUiLayoutState): CanvasUiModel => {
  const elements: CanvasUiElement[] = [];
  const { metricCards, panel: overviewPanel } = buildOverviewPanel(state, elements);
  const overlaysPanel = buildOverlaysPanel(state, elements);
  const toolsPanel = buildToolsPanel(state, elements);
  const { inspectorRows, panel: inspectorPanel } = buildInspectorPanel(state, elements);

  return {
    elements,
    inspectorRows,
    metricCards,
    panels: [overviewPanel, overlaysPanel, toolsPanel, inspectorPanel],
  };
};

export const findCanvasUiElementAtPoint = (model: CanvasUiModel, point: CanvasUiPoint) => {
  for (let index = model.elements.length - 1; index >= 0; index -= 1) {
    const element = model.elements[index]!;
    if (!element.disabled && containsPoint(element.rect, point)) {
      return element;
    }
  }

  return undefined;
};

export const isCanvasUiPoint = (model: CanvasUiModel, point: CanvasUiPoint) =>
  model.panels.some((panel) => containsPoint(panel.rect, point));

const drawPanel = (ctx: CanvasRenderingContext2D, panel: CanvasUiPanel) => {
  ctx.fillStyle = panelFill;
  ctx.strokeStyle = panelStroke;
  ctx.lineWidth = 1;
  ctx.fillRect(panel.rect.x, panel.rect.y, panel.rect.width, panel.rect.height);
  ctx.strokeRect(panel.rect.x, panel.rect.y, panel.rect.width, panel.rect.height);

  ctx.fillStyle = subduedTextColor;
  ctx.font = "600 11px 'Iowan Old Style', Georgia, serif";
  ctx.fillText('Drawer', panel.rect.x + PANEL_PADDING, panel.rect.y + 16);

  ctx.fillStyle = textColor;
  ctx.font = "700 22px 'Iowan Old Style', Georgia, serif";
  ctx.fillText(panel.title, panel.rect.x + PANEL_PADDING, panel.rect.y + 38);

  if (panel.summary) {
    const summaryRect = panel.summaryRect ?? makeRect(panel.toggleRect.x - estimateTextWidth(panel.summary, 'mono') - 32, panel.rect.y + 14, estimateTextWidth(panel.summary, 'mono') + 24, 24);
    ctx.fillStyle = 'rgba(243, 239, 231, 0.96)';
    ctx.strokeStyle = panelStroke;
    ctx.lineWidth = 1;
    ctx.fillRect(summaryRect.x, summaryRect.y, summaryRect.width, summaryRect.height);
    ctx.strokeRect(summaryRect.x, summaryRect.y, summaryRect.width, summaryRect.height);

    ctx.fillStyle = 'rgba(63, 74, 94, 0.9)';
    ctx.font = "600 12px ui-monospace, 'SFMono-Regular', monospace";
    ctx.fillText(panel.summary, summaryRect.x + 12, summaryRect.y + 16);
  }
};

const drawButton = (ctx: CanvasRenderingContext2D, element: CanvasUiElement) => {
  const fill =
    element.disabled
      ? disabledFill
      : element.kind === 'link'
        ? linkFill
        : element.active
          ? selectedFill
          : accentFill;
  const stroke =
    element.disabled
      ? disabledStroke
      : element.kind === 'link'
        ? cardStroke
        : element.active
          ? selectedStroke
          : accentStroke;

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.fillRect(element.rect.x, element.rect.y, element.rect.width, element.rect.height);
  ctx.strokeRect(element.rect.x, element.rect.y, element.rect.width, element.rect.height);

  ctx.fillStyle = element.kind === 'link' ? textColor : '#fffdf6';
  ctx.font =
    element.kind === 'link'
      ? "600 12px ui-monospace, 'SFMono-Regular', monospace"
      : "700 13px ui-monospace, 'SFMono-Regular', monospace";
  ctx.save();
  ctx.beginPath();
  ctx.rect(element.rect.x, element.rect.y, element.rect.width, element.rect.height);
  ctx.clip();
  ctx.fillText(element.label, element.rect.x + buttonHorizontalPadding, element.rect.y + Math.floor(element.rect.height / 2) + 4);
  ctx.restore();
};

const drawMetricCards = (ctx: CanvasRenderingContext2D, cards: MetricCard[]) => {
  for (const card of cards) {
    ctx.fillStyle = cardFill;
    ctx.strokeStyle = cardStroke;
    ctx.lineWidth = 1;
    ctx.fillRect(card.rect.x, card.rect.y, card.rect.width, card.rect.height);
    ctx.strokeRect(card.rect.x, card.rect.y, card.rect.width, card.rect.height);

    ctx.fillStyle = subduedTextColor;
    ctx.font = "600 11px 'Iowan Old Style', Georgia, serif";
    ctx.fillText(card.label, card.rect.x + 12, card.rect.y + 18);

    ctx.fillStyle = textColor;
    ctx.font = "700 24px 'Iowan Old Style', Georgia, serif";
    ctx.fillText(card.value, card.rect.x + 12, card.rect.y + 46);

    ctx.fillStyle = '#6a5c4f';
    ctx.font = "600 12px ui-monospace, 'SFMono-Regular', monospace";
    ctx.fillText(card.caption, card.rect.x + 12, card.rect.y + 63);
  }
};

const drawOverviewBody = (ctx: CanvasRenderingContext2D, panel: CanvasUiPanel, cards: MetricCard[]) => {
  if (!panel.open || !panel.bodyRect) {
    return;
  }

  const bodyRect = panel.bodyRect;
  const firstCard = cards[0];
  const introRect =
    firstCard && firstCard.rect.x > bodyRect.x + 24
      ? makeRect(bodyRect.x, bodyRect.y + 6, firstCard.rect.x - bodyRect.x - 18, 52)
      : makeRect(bodyRect.x, bodyRect.y + 4, bodyRect.width, 44);
  ctx.fillStyle = textColor;
  ctx.font = "700 30px 'Iowan Old Style', Georgia, serif";
  ctx.fillText('RatRace', introRect.x, introRect.y + 18);
  ctx.fillStyle = subduedTextColor;
  ctx.font = "500 14px 'Iowan Old Style', Georgia, serif";
  ctx.fillText(
    'Drag with the left mouse button to pan. Scroll to zoom the city like a map.',
    introRect.x,
    introRect.y + 40,
  );

  drawMetricCards(ctx, cards);
};

const drawToolsBody = (ctx: CanvasRenderingContext2D, panel: CanvasUiPanel) => {
  if (!panel.open || !panel.bodyRect) {
    return;
  }

  const bodyRect = panel.bodyRect;
  ctx.fillStyle = subduedTextColor;
  ctx.font = "600 11px 'Iowan Old Style', Georgia, serif";
  ctx.fillText('Simulation', bodyRect.x, bodyRect.y + 12);

  ctx.fillStyle = subduedTextColor;
  ctx.font = "600 11px 'Iowan Old Style', Georgia, serif";
  ctx.fillText('Build Menu', bodyRect.x, bodyRect.y + 78);
};

const drawInspectorBody = (ctx: CanvasRenderingContext2D, state: CanvasUiLayoutState, panel: CanvasUiPanel, rows: InspectorRow[]) => {
  if (!panel.open || !panel.bodyRect) {
    return;
  }

  const bodyRect = panel.bodyRect;
  const inspector = resolveInspectorData(state.world, state.selectedAgentSnapshot);
  if (!inspector.agent) {
    ctx.fillStyle = subduedTextColor;
    ctx.font = "500 14px 'Iowan Old Style', Georgia, serif";
    ctx.fillText('Click an agent on the canvas to inspect them.', bodyRect.x, bodyRect.y + 22);
    return;
  }

  const agent = inspector.agent;
  const stateBadgeWidth = Math.max(118, estimateTextWidth(agent.state, 'button') + 28);
  ctx.fillStyle = textColor;
  ctx.font = "700 20px 'Iowan Old Style', Georgia, serif";
  ctx.fillText(agent.name, bodyRect.x, bodyRect.y + 18);

  ctx.fillStyle = inspectorStateColors[agent.state];
  ctx.fillRect(bodyRect.x + bodyRect.width - stateBadgeWidth, bodyRect.y, stateBadgeWidth, 24);
  ctx.fillStyle = '#fffdf6';
  ctx.font = "700 11px ui-monospace, 'SFMono-Regular', monospace";
  ctx.fillText(agent.state, bodyRect.x + bodyRect.width - stateBadgeWidth + 10, bodyRect.y + 16);

  ctx.fillStyle = subduedTextColor;
  ctx.font = "italic 14px 'Iowan Old Style', Georgia, serif";
  ctx.fillText(`"${agent.thought}"`, bodyRect.x, bodyRect.y + 98);

  let rowY = bodyRect.y + 130;
  const valueX = bodyRect.x + inspectorLabelWidth;
  const valueWidth = bodyRect.width - inspectorLabelWidth - 10;
  rows.forEach((row) => {
    ctx.fillStyle = subduedTextColor;
    ctx.font = "600 11px 'Iowan Old Style', Georgia, serif";
    ctx.fillText(row.label, bodyRect.x, rowY);

    const lines = row.values.flatMap((value) => wrapTextToWidth(value, valueWidth));
    ctx.fillStyle = textColor;
    ctx.font = "600 12px ui-monospace, 'SFMono-Regular', monospace";
    lines.forEach((line, index) => {
      ctx.fillText(line, valueX, rowY + index * inspectorLineHeight);
    });
    rowY += lines.length * inspectorLineHeight + inspectorRowGap;
  });

  for (const section of [
    { label: 'Roommates', entries: inspector.roommates },
    { label: 'Had Child With', entries: inspector.coParents },
    { label: 'Children', entries: inspector.children },
    { label: 'Parents', entries: inspector.parents },
  ] satisfies InspectorRelationSection[]) {
    ctx.fillStyle = subduedTextColor;
    ctx.font = "600 11px 'Iowan Old Style', Georgia, serif";
    ctx.fillText(section.label, bodyRect.x, rowY);

    if (section.entries.length === 0) {
      ctx.fillStyle = textColor;
      ctx.font = "600 12px ui-monospace, 'SFMono-Regular', monospace";
      ctx.fillText('None', valueX, rowY);
      rowY += getInspectorRelationshipSectionHeight(0);
      continue;
    }

    rowY += getInspectorRelationshipSectionHeight(section.entries.length);
  }
};

export const renderCanvasUi = (ctx: CanvasRenderingContext2D, state: CanvasUiLayoutState) => {
  const model = buildCanvasUiModel(state);

  for (const panel of model.panels) {
    drawPanel(ctx, panel);
  }

  drawOverviewBody(ctx, model.panels[0]!, model.metricCards);
  drawToolsBody(ctx, model.panels[2]!);
  drawInspectorBody(ctx, state, model.panels[3]!, model.inspectorRows);

  for (const element of model.elements) {
    drawButton(ctx, element);
  }

  return model;
};

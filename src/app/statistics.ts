import { DynamicBuildingSnapshot, WorldDynamicSnapshot } from '../sim/simulationWorkerTypes';
import { BuildingKind, WorldState } from '../sim/types';

export const STATISTICS_HISTORY_LIMIT = 720;

export type SimulationStatisticsPoint = {
  averageEnergy: number;
  averageHappiness: number;
  averageHunger: number;
  businessCash: number;
  cumulativeBirths: number;
  cumulativeDeaths: number;
  day: number;
  factoryStock: number;
  housingUsagePercent: number;
  minutesOfDay: number;
  pantryFillPercent: number;
  population: number;
  populationCapacity: number;
  retailStock: number;
  supplyStock: number;
  tick: number;
  totalWealth: number;
  trafficPeak: number;
  treasury: number;
};

type StatisticsSample = Omit<SimulationStatisticsPoint, 'cumulativeBirths' | 'cumulativeDeaths'> & {
  obituaryCount: number;
};

const getAverage = (values: ArrayLike<number>) => {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index] ?? 0;
  }
  return total / values.length;
};

const summarizeBuildings = (buildings: DynamicBuildingSnapshot[]) => {
  let businessCash = 0;
  let retailStock = 0;
  let factoryStock = 0;
  let pantryStock = 0;
  let pantryCapacity = 0;

  for (const building of buildings) {
    businessCash += building.cash;

    if (building.kind === BuildingKind.Commercial) {
      retailStock += building.stock;
      continue;
    }

    if (building.kind === BuildingKind.Industrial) {
      factoryStock += building.stock;
      continue;
    }

    pantryStock += building.pantryStock;
    pantryCapacity += building.pantryCapacity;
  }

  return {
    businessCash,
    factoryStock,
    pantryFillPercent: pantryCapacity > 0 ? (pantryStock / pantryCapacity) * 100 : 0,
    retailStock,
  };
};

export const sampleWorldStatistics = (world: WorldState): StatisticsSample => {
  const buildingSummary = summarizeBuildings(world.entities.buildings);

  return {
    averageEnergy: getAverage(world.entities.agents.map((agent) => agent.stats.energy)),
    averageHappiness: getAverage(world.entities.agents.map((agent) => agent.stats.happiness)),
    averageHunger: getAverage(world.entities.agents.map((agent) => agent.stats.hunger)),
    businessCash: buildingSummary.businessCash,
    day: world.day,
    factoryStock: buildingSummary.factoryStock,
    housingUsagePercent:
      world.metrics.populationCapacity > 0
        ? (world.entities.agents.length / world.metrics.populationCapacity) * 100
        : 0,
    minutesOfDay: world.minutesOfDay,
    obituaryCount: world.obituary.length,
    pantryFillPercent: buildingSummary.pantryFillPercent,
    population: world.entities.agents.length,
    populationCapacity: world.metrics.populationCapacity,
    retailStock: buildingSummary.retailStock,
    supplyStock: world.economy.supplyStock,
    tick: world.tick,
    totalWealth: world.economy.totalWealth,
    trafficPeak: world.metrics.trafficPeak,
    treasury: world.economy.treasury,
  };
};

export const sampleDynamicStatistics = (snapshot: WorldDynamicSnapshot): StatisticsSample => {
  const buildingSummary = summarizeBuildings(snapshot.entities.buildings);
  const population = snapshot.frame.posX.length;

  return {
    averageEnergy: getAverage(snapshot.frame.energyValues),
    averageHappiness: getAverage(snapshot.frame.happinessValues),
    averageHunger: getAverage(snapshot.frame.hungerValues),
    businessCash: buildingSummary.businessCash,
    day: snapshot.day,
    factoryStock: buildingSummary.factoryStock,
    housingUsagePercent:
      snapshot.metrics.populationCapacity > 0 ? (population / snapshot.metrics.populationCapacity) * 100 : 0,
    minutesOfDay: snapshot.minutesOfDay,
    obituaryCount: snapshot.obituary.length,
    pantryFillPercent: buildingSummary.pantryFillPercent,
    population,
    populationCapacity: snapshot.metrics.populationCapacity,
    retailStock: buildingSummary.retailStock,
    supplyStock: snapshot.economy.supplyStock,
    tick: snapshot.tick,
    totalWealth: snapshot.economy.totalWealth,
    trafficPeak: snapshot.metrics.trafficPeak,
    treasury: snapshot.economy.treasury,
  };
};

const getHistoryHourCode = (point: Pick<SimulationStatisticsPoint, 'day' | 'minutesOfDay'>) =>
  point.day * 24 + Math.floor(point.minutesOfDay / 60);

const toHistoryPoint = (
  sample: StatisticsSample,
  previousPoint?: SimulationStatisticsPoint,
): SimulationStatisticsPoint => {
  const deathDelta = Math.max(0, sample.obituaryCount - (previousPoint?.cumulativeDeaths ?? 0));
  const birthDelta = previousPoint
    ? Math.max(0, sample.population - previousPoint.population + deathDelta)
    : 0;

  return {
    averageEnergy: sample.averageEnergy,
    averageHappiness: sample.averageHappiness,
    averageHunger: sample.averageHunger,
    businessCash: sample.businessCash,
    cumulativeBirths: (previousPoint?.cumulativeBirths ?? 0) + birthDelta,
    cumulativeDeaths: sample.obituaryCount,
    day: sample.day,
    factoryStock: sample.factoryStock,
    housingUsagePercent: sample.housingUsagePercent,
    minutesOfDay: sample.minutesOfDay,
    pantryFillPercent: sample.pantryFillPercent,
    population: sample.population,
    populationCapacity: sample.populationCapacity,
    retailStock: sample.retailStock,
    supplyStock: sample.supplyStock,
    tick: sample.tick,
    totalWealth: sample.totalWealth,
    trafficPeak: sample.trafficPeak,
    treasury: sample.treasury,
  };
};

export const updateStatisticsHistory = (
  history: SimulationStatisticsPoint[],
  sample: StatisticsSample,
): SimulationStatisticsPoint[] => {
  const latestPoint = history[history.length - 1];
  if (!latestPoint || sample.tick < latestPoint.tick || sample.day < latestPoint.day) {
    return [toHistoryPoint(sample)];
  }

  const sameHourBucket =
    latestPoint.day === sample.day &&
    getHistoryHourCode(latestPoint) === getHistoryHourCode(sample);
  const structureChanged =
    latestPoint.population !== sample.population || latestPoint.cumulativeDeaths !== sample.obituaryCount;

  if (!sameHourBucket || structureChanged) {
    const nextHistory = history.concat(toHistoryPoint(sample, latestPoint));
    return nextHistory.slice(Math.max(0, nextHistory.length - STATISTICS_HISTORY_LIMIT));
  }

  const previousPoint = history[history.length - 2];
  const nextPoint = toHistoryPoint(sample, previousPoint);
  return history.slice(0, -1).concat(nextPoint);
};

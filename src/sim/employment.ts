import { Building, BuildingKind } from './types';

type ShiftProfile = {
  share: number;
  startMinute: number;
};

export type JobAssignment = {
  shiftStartMinute: number;
  workId: string;
};

export const COMMERCIAL_WORKER_SHARE = 0.1;
export const INDUSTRIAL_SHIFT_PROFILES: ShiftProfile[] = [
  { share: 0.6, startMinute: 8 * 60 },
  { share: 0.25, startMinute: 12 * 60 },
  { share: 0.15, startMinute: 16 * 60 },
];
export const COMMERCIAL_SHIFT_PROFILES: ShiftProfile[] = [
  { share: 0.2, startMinute: 10 * 60 },
  { share: 0.5, startMinute: 12 * 60 },
  { share: 0.3, startMinute: 14 * 60 },
];

const roundToProfileCounts = (count: number, profiles: ShiftProfile[]) => {
  const counts = profiles.map((profile) => Math.floor(count * profile.share));
  let assigned = counts.reduce((sum, value) => sum + value, 0);

  if (assigned >= count) {
    return counts;
  }

  const rankedRemainders = profiles
    .map((profile, index) => ({
      index,
      remainder: count * profile.share - counts[index]!,
    }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  let cursor = 0;
  while (assigned < count) {
    const next = rankedRemainders[cursor % rankedRemainders.length];
    counts[next.index] = counts[next.index]! + 1;
    assigned += 1;
    cursor += 1;
  }

  return counts;
};

const buildShiftSlots = (count: number, profiles: ShiftProfile[]) => {
  const perProfile = roundToProfileCounts(count, profiles);
  const slots: number[] = [];

  perProfile.forEach((profileCount, index) => {
    const startMinute = profiles[index]!.startMinute;
    for (let slotIndex = 0; slotIndex < profileCount; slotIndex += 1) {
      slots.push(startMinute);
    }
  });

  return slots;
};

const getShiftProfiles = (kind: BuildingKind) =>
  kind === BuildingKind.Commercial ? COMMERCIAL_SHIFT_PROFILES : INDUSTRIAL_SHIFT_PROFILES;

const isWorkplace = (building: Building) => building.kind !== BuildingKind.Residential;

const createAssignmentsForKind = (count: number, buildings: Building[], kind: BuildingKind) => {
  if (count <= 0 || buildings.length === 0) {
    return [];
  }

  const shiftSlots = buildShiftSlots(count, getShiftProfiles(kind));
  return Array.from({ length: count }, (_, index) => ({
    workId: buildings[index % buildings.length]!.id,
    shiftStartMinute: shiftSlots[index] ?? getShiftProfiles(kind)[0]!.startMinute,
  }));
};

const getBuildingById = (buildings: Building[]) => new Map(buildings.map((building) => [building.id, building]));

const getWorkersByKind = (assignments: JobAssignment[], buildings: Building[], kind: BuildingKind) => {
  const buildingById = getBuildingById(buildings);
  return assignments.filter((assignment) => buildingById.get(assignment.workId)?.kind === kind);
};

const pickBuildingWithLowestLoad = (buildings: Building[], assignments: Pick<JobAssignment, 'workId'>[]) => {
  const loads = new Map<string, number>();
  for (const assignment of assignments) {
    loads.set(assignment.workId, (loads.get(assignment.workId) ?? 0) + 1);
  }

  let chosen = buildings[0];
  let chosenLoad = Number.POSITIVE_INFINITY;

  for (const building of buildings) {
    const load = loads.get(building.id) ?? 0;
    if (!chosen || load < chosenLoad || (load === chosenLoad && building.id < chosen.id)) {
      chosen = building;
      chosenLoad = load;
    }
  }

  return chosen;
};

const pickShiftStartMinute = (kind: BuildingKind, assignments: JobAssignment[]) => {
  const profiles = getShiftProfiles(kind);
  const counts = new Map<number, number>();
  for (const assignment of assignments) {
    counts.set(assignment.shiftStartMinute, (counts.get(assignment.shiftStartMinute) ?? 0) + 1);
  }

  const totalAfterAssignment = assignments.length + 1;
  let chosen = profiles[0]!.startMinute;
  let bestDeficit = Number.NEGATIVE_INFINITY;

  for (const profile of profiles) {
    const deficit = totalAfterAssignment * profile.share - (counts.get(profile.startMinute) ?? 0);
    if (deficit > bestDeficit) {
      chosen = profile.startMinute;
      bestDeficit = deficit;
    }
  }

  return chosen;
};

export const getWorkBuildings = (buildings: Building[]) => buildings.filter(isWorkplace);

export const createEmploymentAssignments = (agentCount: number, buildings: Building[]): JobAssignment[] => {
  const workplaces = getWorkBuildings(buildings);
  const commercial = workplaces.filter((building) => building.kind === BuildingKind.Commercial);
  const industrial = workplaces.filter((building) => building.kind === BuildingKind.Industrial);

  if (commercial.length === 0) {
    return createAssignmentsForKind(agentCount, industrial, BuildingKind.Industrial);
  }

  if (industrial.length === 0) {
    return createAssignmentsForKind(agentCount, commercial, BuildingKind.Commercial);
  }

  const commercialWorkers = Math.min(agentCount, Math.round(agentCount * COMMERCIAL_WORKER_SHARE));
  const industrialWorkers = Math.max(0, agentCount - commercialWorkers);

  return [
    ...createAssignmentsForKind(industrialWorkers, industrial, BuildingKind.Industrial),
    ...createAssignmentsForKind(commercialWorkers, commercial, BuildingKind.Commercial),
  ];
};

export const pickEmploymentAssignment = (
  buildings: Building[],
  existingAssignments: JobAssignment[],
): JobAssignment | undefined => {
  const workplaces = getWorkBuildings(buildings);
  const commercial = workplaces.filter((building) => building.kind === BuildingKind.Commercial);
  const industrial = workplaces.filter((building) => building.kind === BuildingKind.Industrial);

  if (commercial.length === 0 && industrial.length === 0) {
    return undefined;
  }

  if (commercial.length === 0) {
    const workers = getWorkersByKind(existingAssignments, buildings, BuildingKind.Industrial);
    return {
      workId: pickBuildingWithLowestLoad(industrial, workers)!.id,
      shiftStartMinute: pickShiftStartMinute(BuildingKind.Industrial, workers),
    };
  }

  if (industrial.length === 0) {
    const workers = getWorkersByKind(existingAssignments, buildings, BuildingKind.Commercial);
    return {
      workId: pickBuildingWithLowestLoad(commercial, workers)!.id,
      shiftStartMinute: pickShiftStartMinute(BuildingKind.Commercial, workers),
    };
  }

  const currentCommercial = getWorkersByKind(existingAssignments, buildings, BuildingKind.Commercial);
  const targetCommercial = Math.round((existingAssignments.length + 1) * COMMERCIAL_WORKER_SHARE);
  const nextKind =
    currentCommercial.length < targetCommercial ? BuildingKind.Commercial : BuildingKind.Industrial;
  const workers = getWorkersByKind(existingAssignments, buildings, nextKind);
  const buildingsByKind = nextKind === BuildingKind.Commercial ? commercial : industrial;

  return {
    workId: pickBuildingWithLowestLoad(buildingsByKind, workers)!.id,
    shiftStartMinute: pickShiftStartMinute(nextKind, workers),
  };
};

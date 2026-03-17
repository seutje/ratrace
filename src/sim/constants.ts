export const ticksPerSecond = 60;
export const gameMinutesPerTick = 1;
export const msPerTick = 1000 / ticksPerSecond;
export const MAX_FRAME_ADVANCE_STEPS = 4;
export const MAX_FRAME_ADVANCE_MS = msPerTick * MAX_FRAME_ADVANCE_STEPS;
export const dayMinutes = 24 * 60;

export const WORK_START_MINUTE = 9 * 60;
export const WORK_SHIFT_MINUTES = 8 * 60;
export const SLEEP_START_MINUTE = 22 * 60;
export const SLEEP_END_MINUTE = 6 * 60;
export const SLEEP_MINIMUM_MINUTES = 6 * 60;
export const SLEEP_TARGET_ENERGY = 85;
export const SLEEP_ENERGY_RECOVERY_PER_TICK = 0.45;

export const BASE_MOVE_SPEED = 0.1;
export const ROAD_SPEED_MULTIPLIER = 2;
export const ROAD_CAPACITY = 4;
export const MIN_SPEED_FACTOR = 0.2;

export const STARTER_WORLD_WIDTH = 144;
export const STARTER_WORLD_HEIGHT = 96;
export const STARTER_WORLD_SEED = 42;
export const STARTER_POPULATION = 1000;
export const STARTER_ROAD_SPACING = 4;
export const STARTER_RESIDENTIAL_CAPACITY = 4;
export const STARTER_COMMERCIAL_CAPACITY = 18;
export const STARTER_INDUSTRIAL_CAPACITY = 20;

export const MAX_STAT = 100;
export const SHOPPING_HUNGER_THRESHOLD = 60;
export const SHOPPING_COOLDOWN_TICKS = 180;
export const SLEEP_ENERGY_THRESHOLD = 20;
export const SHOP_PRICE_PER_UNIT = 5;
export const RETAIL_SALES_TAX_PER_UNIT = 1;
export const SHOPPING_BASKET_UNITS = 8;
export const PANTRY_MEAL_HUNGER_RECOVERY = 100;
export const PACKED_LUNCH_CAPACITY = 1;
export const HOME_PANTRY_UNITS_PER_RESIDENT = 4;
export const HOURLY_WAGE = 12;
export const INDUSTRIAL_OUTPUT_PER_HOUR = 10;
export const COMMERCIAL_RESTOCK_PER_HOUR = 2;
export const WHOLESALE_PRICE_PER_UNIT = 2;
export const COMMERCIAL_STARTING_CASH = 240;
export const INDUSTRIAL_STARTING_CASH = 320;
export const HOUSEHOLD_GROWTH_COST = 1000;
export const HOUSEHOLD_GROWTH_HAPPINESS_THRESHOLD = 75;
export const HOUSEHOLD_GROWTH_WALLET_THRESHOLD = 1000;

export const STARVATION_CULL_DAYS = 2;

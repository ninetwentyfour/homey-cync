import type { EffectName } from './types';

/** Factory effect byte pairs. Sourced from cync-lan/src/cync_lan/const.py. */
export const FACTORY_EFFECTS: Record<EffectName, readonly [number, number]> = {
  candle: [0x01, 0xf1],
  rainbow: [0x02, 0x7a],
  cyber: [0x43, 0x9f],
  fireworks: [0x3a, 0xda],
  volcanic: [0x04, 0xf4],
  aurora: [0x05, 0x1c],
  happy_holidays: [0x06, 0x54],
  red_white_blue: [0x07, 0x4f],
  vegas: [0x08, 0xe3],
  party_time: [0x09, 0x06],
};

export const EFFECT_NAMES: readonly EffectName[] = Object.keys(FACTORY_EFFECTS) as EffectName[];

export function isEffectName(value: string): value is EffectName {
  return value in FACTORY_EFFECTS;
}

"use strict";
/**
 * Cync device-type catalog.
 *
 * deviceType is a 1-byte id returned by the Cync REST property endpoint
 * (bulbsArray[].deviceType). Ported from
 * .references/cync-lan/src/cync_lan/metadata/model_info.py and extended with
 * rated wattage at 100% brightness (wattsActive) plus a conservative standby
 * figure (wattsIdle). Figures come from GE Cync retail packaging / spec sheets.
 *
 * wattsActive missing → estimated at lookup time from lumens @ ~90 lm/W.
 * wattsIdle missing → 0.5W (typical Wi-Fi LED product standby).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_TYPE_MAP = void 0;
exports.lookupModel = lookupModel;
exports.estimateWattsActive = estimateWattsActive;
exports.estimateWattsIdle = estimateWattsIdle;
exports.formatModelName = formatModelName;
exports.formatSpecsLine = formatSpecsLine;
exports.formatWatts = formatWatts;
const IDLE_DEFAULT = 0.5;
exports.DEVICE_TYPE_MAP = {
    5: { modelName: 'Tunable White A19 Bulb', classification: 'light', lumens: 800, wattsActive: 9 },
    6: { modelName: 'Full Color Light', classification: 'light' },
    7: { modelName: 'Full Color Light', classification: 'light' },
    8: { modelName: 'Full Color Light', classification: 'light' },
    9: {
        modelName: 'Soft White A19 Bulb',
        classification: 'light',
        lumens: 800,
        minKelvin: 2700,
        wattsActive: 9,
    },
    10: { modelName: 'Tunable White Light', classification: 'light' },
    11: { modelName: 'Tunable White Light', classification: 'light' },
    14: { modelName: 'Tunable White Light', classification: 'light' },
    15: { modelName: 'Tunable White Light', classification: 'light' },
    17: {
        modelName: 'White Dimmable A19 Bulb (BTLE only)',
        modelId: 'CLED199L2',
        classification: 'light',
        lumens: 760,
        minKelvin: 2700,
        wattsActive: 9,
    },
    18: {
        modelName: 'White Dimmable A19 Bulb (BTLE only)',
        modelId: 'CLED199L2',
        classification: 'light',
        lumens: 760,
        minKelvin: 2700,
        wattsActive: 9,
    },
    19: { modelName: 'Tunable White A19 Bulb', classification: 'light', wattsActive: 9 },
    20: { modelName: 'Tunable White Light', classification: 'light' },
    21: {
        modelName: 'C by GE Full Color A19 Bulb (BTLE only)',
        modelId: 'CLEDA1911C2',
        classification: 'light',
        lumens: 760,
        wattsActive: 9,
    },
    22: {
        modelName: 'C by GE Full Color BR30 Bulb (BTLE only)',
        modelId: 'CLEDR3010C2',
        classification: 'light',
        lumens: 700,
        wattsActive: 9,
    },
    23: { modelName: 'Full Color Light', classification: 'light' },
    25: { modelName: 'Tunable White Light', classification: 'light' },
    26: {
        modelName: 'C by GE Tunable White BR30 Bulb (BTLE only)',
        modelId: 'CLEDR309S2',
        classification: 'light',
        lumens: 800,
        minKelvin: 2000,
        maxKelvin: 7000,
        wattsActive: 10,
    },
    28: { modelName: 'Tunable White Light', classification: 'light' },
    29: { modelName: 'Tunable White Light', classification: 'light' },
    30: {
        modelName: 'C by GE Full Color A19 Bulb',
        modelId: 'CLEDA1911C2',
        classification: 'light',
        lumens: 760,
        wattsActive: 9,
    },
    31: {
        modelName: 'C by GE Full Color A19 Bulb',
        modelId: 'CLEDA1911C2',
        classification: 'light',
        lumens: 800,
        wattsActive: 9,
    },
    32: { modelName: 'Full Color Light', classification: 'light' },
    33: { modelName: 'Full Color Light', classification: 'light' },
    34: { modelName: 'Full Color Light', classification: 'light' },
    35: { modelName: 'Full Color Light', classification: 'light' },
    37: {
        modelName: 'Dimmer Switch with Motion and Ambient Light',
        modelId: 'CSWDMOCBWF1',
        classification: 'switch',
        wattsActive: 0.8,
    },
    39: {
        modelName: 'Paddle Switch',
        modelId: 'CSWONBLPWF1',
        classification: 'switch',
        wattsActive: 0.8,
    },
    40: {
        modelName: 'Paddle Switch',
        modelId: 'CSWONBLTWF1',
        classification: 'switch',
        wattsActive: 0.8,
    },
    41: {
        modelName: 'Reveal HD+ Full Color Under Cabinet Light - 12 Inch',
        classification: 'light',
        lumens: 750,
        wattsActive: 7,
    },
    42: {
        modelName: 'Reveal HD+ Full Color Under Cabinet Light - 18 Inch',
        classification: 'light',
        lumens: 1150,
        wattsActive: 11,
    },
    43: {
        modelName: 'Reveal HD+ Full Color Under Cabinet Light - 24 Inch',
        classification: 'light',
        lumens: 1500,
        wattsActive: 14,
    },
    47: {
        modelName: 'Reveal Full Color 6" Recessed Downlight',
        modelId: 'CFIXRSCR6CRVD',
        classification: 'light',
        wattsActive: 12,
    },
    48: {
        modelName: 'C by GE Paddle Switch',
        modelId: 'CSWDMBLBWF1',
        classification: 'switch',
        wattsActive: 0.8,
    },
    49: {
        modelName: 'C by GE Dimmer Switch with Motion and Ambient Light',
        modelId: 'CSWDMOCBWF1',
        classification: 'switch',
        wattsActive: 0.8,
    },
    51: { modelName: 'Switch', classification: 'switch', wattsActive: 0.8 },
    52: { modelName: 'Switch', classification: 'switch', wattsActive: 0.8 },
    55: { modelName: 'Dimmer Switch - No Neutral', classification: 'switch', wattsActive: 0.8 },
    57: {
        modelName: 'Paddle Switch - No Neutral',
        modelId: 'CSWONBLPWF1NN',
        classification: 'switch',
        wattsActive: 0.8,
    },
    58: { modelName: 'Switch - No Neutral', classification: 'switch', wattsActive: 0.8 },
    59: { modelName: 'Switch', classification: 'switch', wattsActive: 0.8 },
    64: { modelName: 'Indoor Plug', classification: 'plug', wattsActive: 0.5 },
    65: { modelName: 'Indoor Plug', classification: 'plug', wattsActive: 0.5 },
    66: { modelName: 'Indoor Plug', classification: 'plug', wattsActive: 0.5 },
    67: {
        modelName: 'Outdoor Plug - Dual Outlet',
        modelId: 'CPLGOD2BLG1',
        classification: 'plug',
        wattsActive: 0.8,
    },
    68: { modelName: 'Indoor Plug', classification: 'plug', wattsActive: 0.5 },
    71: {
        modelName: 'Full Color Dynamic Effects Premium Thin Light Strip',
        modelId: 'CSTR16CDID',
        classification: 'light',
        wattsActive: 14,
    },
    72: {
        modelName: 'Full Color Dynamic Effects Premium Light Strip',
        classification: 'light',
        lumens: 1600,
        minKelvin: 2000,
        maxKelvin: 7000,
        cri: 80,
        wattsActive: 22,
    },
    76: {
        modelName: 'Full Color Dynamic Effects Cafe Lights',
        modelId: 'CCF48CDOD',
        classification: 'light',
        lumens: 130,
        minKelvin: 2000,
        maxKelvin: 7000,
        wattsActive: 30,
    },
    80: { modelName: 'C by GE Sol / XLink Tunable White', classification: 'light', wattsActive: 12 },
    81: {
        modelName: 'Fan Controller',
        modelId: 'CSWFSBLBWF1/ST-1P',
        classification: 'switch',
        wattsActive: 0.8,
    },
    82: { modelName: 'Tunable White Light', classification: 'light' },
    83: { modelName: 'Tunable White Light', classification: 'light' },
    85: { modelName: 'Tunable White Light', classification: 'light' },
    97: {
        modelName: 'Full Color Edison ST19 Bulb',
        modelId: 'CLEDST196CDGS',
        classification: 'light',
        lumens: 500,
        wattsActive: 5,
    },
    107: {
        modelName: 'Full Color Reveal HD+ Bulb',
        modelId: 'CLEDA199CDRV',
        classification: 'light',
        lumens: 760,
        wattsActive: 10,
    },
    113: {
        modelName: 'Wire-Free Dimmer with White Temperature Switch (BTLE only)',
        classification: 'switch',
    },
    125: {
        modelName: 'Paddle Switch (RGB/Kelvin)',
        modelId: 'CSWDMBLBWF1',
        classification: 'switch',
        wattsActive: 0.8,
    },
    128: {
        modelName: 'Dimmable A19 Bulb',
        modelId: 'CLEDA199LD1',
        classification: 'light',
        lumens: 800,
        cri: 90,
        minKelvin: 2700,
        wattsActive: 9,
    },
    129: { modelName: 'Tunable White Light', classification: 'light' },
    130: { modelName: 'Tunable White Light', classification: 'light' },
    131: { modelName: 'Full Color A19 Bulb', classification: 'light', lumens: 800, wattsActive: 10 },
    132: { modelName: 'Full Color Light', classification: 'light' },
    133: {
        modelName: 'Full Color LED Light Strip Controller',
        classification: 'light',
        wattsActive: 22,
    },
    135: { modelName: 'Tunable White Light', classification: 'light' },
    136: { modelName: 'Tunable White Light', classification: 'light' },
    137: { modelName: 'Full Color A19 Bulb', classification: 'light', lumens: 800, wattsActive: 10 },
    138: {
        modelName: 'Full Color BR30 Floodlight',
        modelId: 'CLEDR309CD1',
        classification: 'light',
        lumens: 750,
        minKelvin: 2000,
        maxKelvin: 7000,
        cri: 90,
        wattsActive: 9,
    },
    139: { modelName: 'Full Color Light', classification: 'light' },
    140: {
        modelName: 'Full Color Outdoor PAR38 Floodlight',
        modelId: 'CLEDP3815CD1',
        classification: 'light',
        lumens: 1300,
        wattsActive: 15,
    },
    141: { modelName: 'Full Color Light', classification: 'light' },
    142: { modelName: 'Full Color Light', classification: 'light' },
    143: { modelName: 'Full Color Light', classification: 'light' },
    144: { modelName: 'Tunable White Light', classification: 'light' },
    145: { modelName: 'Tunable White Light', classification: 'light' },
    146: {
        modelName: 'Full Color Edison ST19 Bulb',
        modelId: 'CLEDST196CDGS',
        classification: 'light',
        lumens: 500,
        wattsActive: 5,
    },
    147: {
        modelName: 'Full Color Edison G25 Bulb',
        modelId: 'CLEDG256CDGS',
        classification: 'light',
        lumens: 500,
        wattsActive: 5,
    },
    148: {
        modelName: 'White Edison ST19 Bulb',
        classification: 'light',
        minKelvin: 2700,
        wattsActive: 5,
    },
    152: {
        modelName: 'Reveal HD+ White A19 Bulb',
        classification: 'light',
        minKelvin: 2700,
        wattsActive: 9,
    },
    153: { modelName: 'Full Color Light', classification: 'light' },
    154: { modelName: 'Full Color Light', classification: 'light' },
    156: { modelName: 'Full Color Light', classification: 'light' },
    158: { modelName: 'Full Color Light', classification: 'light' },
    159: { modelName: 'Full Color Light', classification: 'light' },
    160: { modelName: 'Full Color Light', classification: 'light' },
    161: { modelName: 'Full Color Light', classification: 'light' },
    162: { modelName: 'Full Color Light', classification: 'light' },
    163: { modelName: 'Full Color Light', classification: 'light' },
    164: { modelName: 'Full Color Light', classification: 'light' },
    165: { modelName: 'Full Color Light', classification: 'light' },
    169: {
        modelName: 'Reveal HD+ Full Color 4 Inch Wafer Downlight',
        modelId: 'CFIXCNLR4CRVD',
        classification: 'light',
        lumens: 760,
        wattsActive: 10,
    },
    224: { modelName: 'Thermostat', classification: 'thermostat' },
};
function lookupModel(deviceType) {
    if (deviceType === undefined)
        return undefined;
    return exports.DEVICE_TYPE_MAP[deviceType];
}
/** Best-effort active wattage from a spec: explicit value, else lumens/90 rounded to nearest watt. */
function estimateWattsActive(spec) {
    if (!spec)
        return undefined;
    if (spec.wattsActive !== undefined)
        return spec.wattsActive;
    if (spec.lumens)
        return Math.max(1, Math.round(spec.lumens / 90));
    return undefined;
}
function estimateWattsIdle(spec) {
    return spec?.wattsIdle ?? IDLE_DEFAULT;
}
/** "Full Color A19 Bulb (CLEDA199CDRV)" — SKU appended when known. */
function formatModelName(spec) {
    if (!spec)
        return '';
    if (spec.modelId)
        return `${spec.modelName} (${spec.modelId})`;
    return spec.modelName;
}
/** "800 lm · 2000–7000K · 90 CRI" (segments omitted when unknown). */
function formatSpecsLine(spec) {
    if (!spec)
        return '';
    const parts = [];
    if (spec.lumens)
        parts.push(`${spec.lumens} lm`);
    if (spec.minKelvin && spec.maxKelvin && spec.minKelvin !== spec.maxKelvin) {
        parts.push(`${spec.minKelvin}–${spec.maxKelvin}K`);
    }
    else if (spec.minKelvin) {
        parts.push(`${spec.minKelvin}K`);
    }
    if (spec.cri)
        parts.push(`${spec.cri} CRI`);
    return parts.join(' · ');
}
function formatWatts(watts) {
    if (watts === null || watts === undefined)
        return '';
    if (watts < 1)
        return `≈${watts.toFixed(1)} W`;
    return `≈${Math.round(watts)} W`;
}

import type { CoordinateTransform } from '../state/types';

// Linear: pixel X [100..600] → data X [0..10], pixel Y [400..100] → data Y [0..10]
export const linearTransform: CoordinateTransform = {
  axisType: 'xy-linear',
  x1px: 100, x1py: 0, x1Data: 0,
  x2px: 600, x2py: 0, x2Data: 10,
  y1px: 0, y1py: 400, y1Data: 0,
  y2px: 0, y2py: 100, y2Data: 10,
};

// Log-XY: pixel X [100..600] → data X [1..100] (2 decades), pixel Y [400..100] → data Y [0.1..1000] (4 decades)
export const logTransform: CoordinateTransform = {
  axisType: 'xy-log-xy',
  x1px: 100, x1py: 0, x1Data: 1,
  x2px: 600, x2py: 0, x2Data: 100,
  y1px: 0, y1py: 400, y1Data: 0.1,
  y2px: 0, y2py: 100, y2Data: 1000,
};

const fs = require('fs');

const points = [];
for (let i = 0; i < 15000; i++) {
  points.push({
    id: `pt-${i}`,
    pixelX: Math.random() * 800,
    pixelY: Math.random() * 600,
    dataX: Math.random() * 100,
    dataY: Math.random() * 100
  });
}

// 1x1 transparent PNG base64
const emptyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const pvz = {
  version: 1,
  imageSrc: emptyImage,
  filename: 'stress_test_15k.png',
  calibration: {
    axisType: 'xy-linear',
    step: 'complete',
    points: [
      { id: 'c1', role: 'x1', pixelX: 0, pixelY: 0, dataX: 0, dataY: null },
      { id: 'c2', role: 'x2', pixelX: 800, pixelY: 0, dataX: 100, dataY: null },
      { id: 'c3', role: 'y1', pixelX: 0, pixelY: 600, dataX: null, dataY: 0 },
      { id: 'c4', role: 'y2', pixelX: 0, pixelY: 0, dataX: null, dataY: 100 }
    ],
    isComplete: true,
    showGrid: false,
    transform: {
      axisType: 'xy-linear',
      x1px: 0, x1py: 0, x1Data: 0,
      x2px: 800, x2py: 0, x2Data: 100,
      y1px: 0, y1py: 600, y1Data: 0,
      y2px: 0, y2py: 0, y2Data: 100
    }
  },
  datasets: [
    {
      id: 'ds-1',
      name: 'Stress Test 15k',
      color: '#ef4444',
      visible: true,
      points: points
    }
  ],
  imageFilters: {
    brightness: 100, contrast: 100, grayscale: false, invert: false,
    sharpen: false, threshold: null, autoContrast: false, denoise: false, gridRemoval: false
  },
  roi: null,
  exportOptions: { precision: 'auto', digits: 4, sort: 'none', dateFmt: 'yyyy-mm-dd HH:ii:ss' }
};

fs.writeFileSync('test_15k_points.pvz', JSON.stringify(pvz));
console.log('Created test_15k_points.pvz with 15k points');

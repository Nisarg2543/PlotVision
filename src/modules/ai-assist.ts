import { getState } from '../state/store';
import { getImageBitmap } from './canvas-engine';
import type { AxisType, CalibrationPoint } from '../state/types';

export interface AIAutoDetectResult {
  axisType: AxisType;
  calibrationPoints: Omit<CalibrationPoint, 'id'>[];
}

export interface AIExtractResult {
  series: {
    name: string;
    color: string;
    points: { dataX: number; dataY: number }[];
  }[];
}

async function getImageBase64(): Promise<string> {
  const bmp = getImageBitmap();
  if (!bmp) throw new Error('No image loaded');
  
  const cvs = document.createElement('canvas');
  cvs.width = bmp.width;
  cvs.height = bmp.height;
  const ctx = cvs.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  
  ctx.drawImage(bmp, 0, 0);
  const dataUrl = cvs.toDataURL('image/jpeg', 0.8);
  return dataUrl.split(',')[1];
}

async function callOpenAI(prompt: string, base64Image: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`OpenAI API error: ${res.status} ${res.statusText} - ${JSON.stringify(errorData)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callGemini(prompt: string, base64Image: string, apiKey: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } }
        ]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0
      }
    })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${res.status} ${res.statusText} - ${JSON.stringify(errorData)}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function runAI(prompt: string): Promise<string> {
  const state = getState();
  const { apiKey, provider } = state.ai;
  
  if (!apiKey) {
    throw new Error('API Key is missing. Please configure it in Settings.');
  }

  const base64 = await getImageBase64();

  if (provider === 'openai') {
    return callOpenAI(prompt, base64, apiKey);
  } else {
    return callGemini(prompt, base64, apiKey);
  }
}

export async function smartAutoDetect(): Promise<AIAutoDetectResult> {
  const prompt = `
You are an expert data visualization analyzer. Analyze the provided chart image and return a JSON object with the following structure:
{
  "axisType": "xy-linear" | "xy-log-x" | "xy-log-y" | "xy-log-xy" | "polar" | "bar-chart",
  "calibrationPoints": [
    { "role": "x1", "pixelX": number, "pixelY": number, "dataX": number, "dataY": null },
    { "role": "x2", "pixelX": number, "pixelY": number, "dataX": number, "dataY": null },
    { "role": "y1", "pixelX": number, "pixelY": number, "dataX": null, "dataY": number },
    { "role": "y2", "pixelX": number, "pixelY": number, "dataX": null, "dataY": number }
  ]
}
For the calibrationPoints, provide the estimated pixel coordinates (X, Y where 0,0 is top-left) for 4 known axis tick marks (2 on X axis, 2 on Y axis) and their corresponding data values.
`;

  const jsonStr = await runAI(prompt);
  const result = JSON.parse(jsonStr) as AIAutoDetectResult;
  return result;
}

export async function aiExtractAllData(): Promise<AIExtractResult> {
  const prompt = `
You are an expert data extractor. Extract all the data points from the chart image.
Return a JSON object with the following structure:
{
  "series": [
    {
      "name": "Series Name (e.g., Line 1 or inferred label)",
      "color": "#HEXCODE (an approximate hex color for this series)",
      "points": [
        { "dataX": number, "dataY": number }
      ]
    }
  ]
}
Estimate the data coordinates (X and Y) based on the axes in the image. Be as accurate as possible.
`;

  const jsonStr = await runAI(prompt);
  const result = JSON.parse(jsonStr) as AIExtractResult;
  return result;
}

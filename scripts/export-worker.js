import { parentPort, workerData } from 'node:worker_threads';
import { renderChartDownload } from './chart-download.js';
try { parentPort.postMessage(await renderChartDownload(workerData.format,workerData.spec)); }
catch { parentPort.postMessage({error:'Unable to export this chart.'}); }

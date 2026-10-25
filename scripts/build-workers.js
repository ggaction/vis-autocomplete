// Keep the existing command compatible; both execution realms must be rebuilt.
import { buildBrowser } from './build-browser.js';
await buildBrowser();

import maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
import 'maplibre-gl/dist/maplibre-gl.css';
maplibregl.setWorkerUrl(workerUrl);
maplibregl.setWorkerCount(2);
export default maplibregl;

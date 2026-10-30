export default function MapPreviewCredit() {
  return <span className="map-preview-credit" aria-label="지도 출처">
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
    {' · '}<a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>
    {' · '}<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
  </span>;
}

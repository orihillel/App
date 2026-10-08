// The globe's base map: NASA's Blue Marble, prebuilt as a GPU-compressed texture by
// scripts/build-basemap.mjs and loaded by the globe (see loadBasemap in components/Globe.jsx).
//
// One definition for both, so the file the script writes and the file the globe asks for cannot
// drift apart. The name carries a version because the service worker keeps the file
// cache-first: new contents need a new name, or every cached copy keeps the old ones.
export const BASEMAP = { file: 'basemap-4096x2048-v1.ktx2', width: 4096, height: 2048 };

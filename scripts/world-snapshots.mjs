// The one table of per-world facts the world checks hold every map to (epic #940 slice B). worldcheck reads the hashes and the
// spawn minimum; rulescheck fails a world of WORLDS that has no row here. Update a row's hashes when that world's spec or the
// generator changes on purpose (worldcheck prints the new ones in its failure line).
//   zone, tiles   FNV-1a of the zone and tile arrays (worldcheck.mjs `fnv`)
//   minSpawn      the fewest spawn points any region of the world may have
export const SNAPSHOTS = {
  eldmoor:  {zone: '7d08ac18', tiles: 'bda9e97b', minSpawn: 1},
  stepping: {zone: '1089eab4', tiles: '2763d8b2', minSpawn: 200},
  vale:     {zone: '258a7280', tiles: 'ca3628f2', minSpawn: 150},
  hollin:   {zone: '7bfcd86f', tiles: 'f2e0d16a', minSpawn: 150},
  wendmouth: {zone: 'ccc10dc1', tiles: 'dd4e6959', minSpawn: 150},
  hawkwold: {zone: '47133cab', tiles: '972e7b13', minSpawn: 150},
};

# Sledders – Bighorn Mountains (Bear Lodge → High Country Lodge)

Real terrain for a Sledders level, from USGS 3DEP elevation (via AWS Terrain Tiles, ~8 m source detail).

- Bear Lodge Resort, Burgess Junction: 44.7683, -107.5283
- Wyoming High Country Lodge (FR 13 off US-14A): 44.8193, -107.8583
- Straight-line distance: 26.7 km. Sledders terrain tops out around 8 × 8 km, so the run is split into
  **5 overlapping true-scale 8 × 8 km levels** (see `overview.png`). Level 1 contains Bear Lodge, Level 5 contains High Country Lodge.

Each `level_N/` folder holds:

| File | What |
|---|---|
| `heightmap_2049.png` | 16-bit grayscale, 2049 × 2049, north up (~3.9 m/px) |
| `heightmap_2049.raw` | same, 16-bit little-endian ("Windows" byte order in Unity) |
| `heightmap_4097.raw` | 4097 × 4097 version, 16-bit little-endian |
| `preview.png` | shaded preview; red dot = lodge |

Black (0) = the level's lowest point and white (65535) = its highest. Set the terrain height to that level's
`relief_m` from `levels.json` (about 500–625 m) to keep real-world steepness.

`levels.json` lists each level's corner coordinates, elevation range and the lodge pixel positions.

## Regenerating

The `.raw` files are not committed (about 210 MB). Rebuild everything with:

```bash
python3 build_bighorns.py . ./tile-cache
```

(needs Python with numpy and Pillow, plus internet access to the AWS Terrain Tiles bucket)

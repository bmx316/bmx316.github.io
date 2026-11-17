"""Build Sledders-ready heightmaps of the Bighorn Mountains corridor
from Bear Lodge Resort (Burgess Junction) to Wyoming High Country Lodge.

Data: AWS Open Data "Terrain Tiles" (Terrarium encoding, USGS 3DEP in the US).
Outputs (in OUT dir):
  overview.png                 hillshade of the corridor, lodges + level boxes marked
  tile_N/heightmap_2049.png    16-bit grayscale, true scale 8 x 8 km
  tile_N/heightmap_2049.raw    same, 16-bit little-endian (Unity "Windows" byte order)
  tile_N/heightmap_4097.raw    higher-res version
  tile_N/preview.png           hillshade of that level
  tiles.json                   bounds, elevation range, lodge pixel positions
"""
import io, json, math, os, sys, concurrent.futures as cf, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
CACHE = sys.argv[2]
Z = 14
BEAR = ("Bear Lodge Resort", 44.768293, -107.528309)
HCL = ("Wyoming High Country Lodge", 44.8192644, -107.8583407)
LAT0 = (BEAR[1] + HCL[1]) / 2
LON0 = (BEAR[2] + HCL[2]) / 2
M_LAT = 111_132.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))

def to_xy(lat, lon):  # local metres, x east, y north
    return (lon - LON0) * M_LON, (lat - LAT0) * M_LAT

def to_ll(x, y):
    return LAT0 + y / M_LAT, LON0 + x / M_LON

# ---------- tile download / mosaic ----------
def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 44.70, 44.89, -107.95, -107.44
x0, y0 = tile_xy(LAT_MAX, LON_MIN, Z)
x1, y1 = tile_xy(LAT_MIN, LON_MAX, Z)
TX0, TY0, TX1, TY1 = int(x0), int(y0), int(x1), int(y1)

def fetch(t):
    tx, ty = t
    p = os.path.join(CACHE, f"{Z}_{tx}_{ty}.png")
    if not os.path.exists(p):
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
        for attempt in range(4):
            try:
                data = urllib.request.urlopen(url, timeout=60).read()
                break
            except Exception:
                if attempt == 3:
                    raise
        with open(p, "wb") as f:
            f.write(data)
    a = np.asarray(Image.open(p).convert("RGB")).astype(np.float64)
    return t, a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

os.makedirs(CACHE, exist_ok=True)
tiles = [(tx, ty) for tx in range(TX0, TX1 + 1) for ty in range(TY0, TY1 + 1)]
W, H = (TX1 - TX0 + 1) * 256, (TY1 - TY0 + 1) * 256
dem = np.zeros((H, W))
with cf.ThreadPoolExecutor(16) as ex:
    for (tx, ty), a in ex.map(fetch, tiles):
        dem[(ty - TY0) * 256:(ty - TY0 + 1) * 256, (tx - TX0) * 256:(tx - TX0 + 1) * 256] = a
print(f"mosaic {W}x{H} from {len(tiles)} tiles, elev {dem.min():.0f}-{dem.max():.0f} m")

def sample(lat, lon):
    """Bilinear sample of the mosaic at arrays of lat/lon."""
    n = 2 ** Z
    px = ((lon + 180) / 360 * n - TX0) * 256 - 0.5
    py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - TY0) * 256 - 0.5
    px = np.clip(px, 0, W - 1.001); py = np.clip(py, 0, H - 1.001)
    ix, iy = px.astype(int), py.astype(int)
    fx, fy = px - ix, py - iy
    a = dem[iy, ix]; b = dem[iy, ix + 1]; c = dem[iy + 1, ix]; d = dem[iy + 1, ix + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy

def grid(cx, cy, size_m, res):
    """Heights on a res x res grid centred at local (cx, cy); row 0 = north."""
    s = np.linspace(-size_m / 2, size_m / 2, res)
    X, Y = np.meshgrid(cx + s, cy - s)
    lat, lon = to_ll(X, Y)
    return sample(lat, lon)

def hillshade(h, cell, z_exag=1.5):
    gy, gx = np.gradient(h * z_exag, cell)
    az, alt = math.radians(315), math.radians(40)
    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    sh = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(sh, 0, 1)

def snow_render(h, cell):
    hs = hillshade(h, cell)
    t = (h - h.min()) / max(1, np.ptp(h))
    # tint: lower = cool blue-grey (timber), higher = white snow
    base = np.stack([200 + 55 * t, 215 + 40 * t, 235 + 20 * t], -1)
    img = base * (0.35 + 0.65 * hs[..., None])
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))

# ---------- level tiles along the route ----------
LEVEL = 8000.0
bx, by = to_xy(BEAR[1], BEAR[2]); hx, hy = to_xy(HCL[1], HCL[2])
route_len = math.hypot(hx - bx, hy - by)
n_tiles = math.ceil((route_len + 1500) / (LEVEL - 1000))
centers = []
for i in range(n_tiles):
    # keep a 750 m margin past each lodge; neighbouring levels overlap so the seams line up
    t = (i + 0.5) / n_tiles
    span = route_len + 1500
    d = -750 + t * span
    ux, uy = (hx - bx) / route_len, (hy - by) / route_len
    centers.append((bx + ux * d, by + uy * d))

meta = {"source": "AWS Terrain Tiles (USGS 3DEP), Terrarium z14 (~8 m)",
        "route_km": round(route_len / 1000, 2), "level_size_m": LEVEL,
        "lodges": {BEAR[0]: BEAR[1:], HCL[0]: HCL[1:]}, "levels": []}
os.makedirs(OUT, exist_ok=True)
for i, (cx, cy) in enumerate(centers, 1):
    d = os.path.join(OUT, f"level_{i}")
    os.makedirs(d, exist_ok=True)
    info = {"level": i}
    for res in (2049, 4097):
        h = grid(cx, cy, LEVEL, res)
        lo, hi = float(h.min()), float(h.max())
        u16 = np.round((h - lo) / (hi - lo) * 65535).astype("<u2")
        u16.tofile(os.path.join(d, f"heightmap_{res}.raw"))
        if res == 2049:
            Image.fromarray(u16.astype(np.uint16)).save(os.path.join(d, f"heightmap_{res}.png"))
            img = snow_render(h, LEVEL / (res - 1))
            dr = ImageDraw.Draw(img)
            for name, la, lo_ in (BEAR, HCL):
                x, y = to_xy(la, lo_)
                px = (x - cx + LEVEL / 2) / LEVEL * (res - 1); py = (cy - y + LEVEL / 2) / LEVEL * (res - 1)
                if 0 <= px < res and 0 <= py < res:
                    dr.ellipse([px - 18, py - 18, px + 18, py + 18], fill=(200, 30, 30), outline="white", width=5)
                    info.setdefault("lodges_px_2049", {})[name] = [round(px), round(py)]
            img.resize((1024, 1024), Image.LANCZOS).save(os.path.join(d, "preview.png"))
            info.update(min_elev_m=round(lo, 1), max_elev_m=round(hi, 1), relief_m=round(hi - lo, 1))
    nw = to_ll(cx - LEVEL / 2, cy + LEVEL / 2); se = to_ll(cx + LEVEL / 2, cy - LEVEL / 2)
    info.update(center_latlon=[round(v, 6) for v in to_ll(cx, cy)],
                nw_corner=[round(v, 6) for v in nw], se_corner=[round(v, 6) for v in se])
    meta["levels"].append(info)
    print(info)

# ---------- overview ----------
OV_W, OV_H = 36000.0, 14000.0
res_x, res_y = 2400, int(2400 * OV_H / OV_W)
mx, my = (bx + hx) / 2, (by + hy) / 2
sx = np.linspace(-OV_W / 2, OV_W / 2, res_x); sy = np.linspace(OV_H / 2, -OV_H / 2, res_y)
X, Y = np.meshgrid(mx + sx, my + sy)
la, lo_ = to_ll(X, Y)
h = sample(la, lo_)
img = snow_render(h, OV_W / res_x).convert("RGB")
dr = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
    small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
except OSError:
    font = small = ImageFont.load_default()
P = lambda x, y: ((x - mx + OV_W / 2) / OV_W * res_x, (my - y + OV_H / 2) / OV_H * res_y)
cols = [(230, 120, 20), (40, 140, 60), (40, 90, 200), (160, 50, 170), (200, 40, 40)]
for i, (cx, cy) in enumerate(centers):
    a = P(cx - LEVEL / 2, cy + LEVEL / 2); b = P(cx + LEVEL / 2, cy - LEVEL / 2)
    dr.rectangle([a, b], outline=cols[i % 5], width=5)
    dr.text((a[0] + 10, a[1] + 8), f"Level {i + 1}", fill=cols[i % 5], font=small)
dr.line([P(bx, by), P(hx, hy)], fill=(90, 90, 90), width=3)
for name, la_, lo2 in (BEAR, HCL):
    x, y = P(*to_xy(la_, lo2))
    dr.ellipse([x - 12, y - 12, x + 12, y + 12], fill=(200, 30, 30), outline="white", width=4)
    dr.text((x + 16, y + 10), name, fill=(20, 20, 20), font=font, stroke_width=3, stroke_fill="white")
dr.text((20, res_y - 50), f"Bighorn Mountains, WY  -  {route_len/1000:.1f} km straight line  -  boxes = 8 x 8 km Sledders levels  -  north up",
        fill=(20, 20, 20), font=small, stroke_width=3, stroke_fill="white")
img.save(os.path.join(OUT, "overview.png"))
json.dump(meta, open(os.path.join(OUT, "levels.json"), "w"), indent=2)
print("route km", route_len / 1000, "levels", len(centers))

#!/usr/bin/env python3
"""Chroma-key magenta, feet-anchor frames, pack sprite sheets.

Raw harvest frames live under assets/wolf/ as _v1_NNN.png / _v2_NNN.png.
Optional stills (packets, FX, background) can be keyed from a directory
passed as --source; that directory is never assumed.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
WOLF = ASSETS / "wolf"

IDLE_SRC = [16, 20, 24, 28, 32, 36, 40, 44]  # v2 standing breath
ATTACK_SRC = [1, 8, 14, 20, 28, 40, 52, 64]  # v1 swipe

STILL_MAP = {
    "legit.jpg": ASSETS / "packets/legit.png",
    "malware.jpg": ASSETS / "packets/malware.png",
    "phish.jpg": ASSETS / "packets/phish.png",
    "c2.jpg": ASSETS / "packets/c2.png",
    "slash.jpg": ASSETS / "fx/slash.png",
    "breach.jpg": ASSETS / "fx/breach.png",
    "ops.jpg": ASSETS / "bg/ops.jpg",
}


def magenta_mask(rgb: np.ndarray, key: np.ndarray, tol: float) -> np.ndarray:
    """True where a pixel is background magenta/pink."""
    dist = np.linalg.norm(rgb.astype(np.float32) - key, axis=2)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = np.where(mx == 0, 0, (mx - mn) / np.maximum(mx, 1))
    pink = (
        (r > 120)
        & (b > 80)
        & (np.abs(r - b) < 75)
        & (g < r * 0.78)
        & ((r + b) > g * 2.2)
        & (sat > 0.22)
    )
    return (dist <= tol) | pink


def feather(alpha: np.ndarray, px: int = 1) -> np.ndarray:
    a = alpha.astype(np.float32)
    for _ in range(px):
        up = np.pad(a, ((1, 0), (0, 0)), mode="edge")[:-1]
        dn = np.pad(a, ((0, 1), (0, 0)), mode="edge")[1:]
        lf = np.pad(a, ((0, 0), (1, 0)), mode="edge")[:, :-1]
        rt = np.pad(a, ((0, 0), (0, 1)), mode="edge")[:, 1:]
        a = np.minimum(a, (a + up + dn + lf + rt) / 5.0)
    return a.astype(np.uint8)


def key_image(im: Image.Image, tol: float = 48.0) -> Image.Image:
    rgba = im.convert("RGBA")
    arr = np.array(rgba)
    rgb = arr[:, :, :3].astype(np.float32)
    key = rgb[4, 4]
    mask = magenta_mask(rgb, key, tol)
    alpha = np.where(mask, np.uint8(0), np.uint8(255))
    alpha = feather(alpha, 1)
    arr[:, :, 3] = alpha
    return Image.fromarray(arr, "RGBA")


def opaque_bbox(im: Image.Image, t: int = 12) -> tuple[int, int, int, int]:
    a = np.array(im.split()[-1])
    ys, xs = np.where(a > t)
    if len(xs) == 0:
        return (0, 0, im.width, im.height)
    pad = 8
    x0 = max(int(xs.min()) - pad, 0)
    y0 = max(int(ys.min()) - pad, 0)
    x1 = min(int(xs.max()) + pad + 1, im.width)
    y1 = min(int(ys.max()) + pad + 1, im.height)
    return (x0, y0, x1, y1)


def foot_anchor(im: Image.Image) -> tuple[float, float]:
    a = np.array(im.split()[-1])
    ys, xs = np.where(a > 40)
    if len(xs) == 0:
        return (im.width / 2, im.height)
    y_max = int(ys.max())
    band = ys >= (y_max - 10)
    return (float(xs[band].mean()), float(y_max))


def place_in_cell(
    im: Image.Image, cell: tuple[int, int], foot: tuple[float, float], origin: tuple[float, float]
) -> Image.Image:
    cw, ch = cell
    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    dx = int(round(origin[0] - foot[0]))
    dy = int(round(origin[1] - foot[1]))
    out.alpha_composite(im, (dx, dy))
    return out


def sheet(frames: list[Image.Image], path: Path) -> None:
    w, h = frames[0].size
    s = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        s.paste(fr, (i * w, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    s.save(path)
    print(f"sheet {path.name} {s.size} x{len(frames)}")


def process_wolf() -> None:
    idle_raw = [key_image(Image.open(WOLF / f"_v2_{n:03d}.png")) for n in IDLE_SRC]
    atk_raw = [key_image(Image.open(WOLF / f"_v1_{n:03d}.png")) for n in ATTACK_SRC]

    all_fr = idle_raw + atk_raw
    bboxes = [opaque_bbox(im) for im in all_fr]
    cropped = [im.crop(bb) for im, bb in zip(all_fr, bboxes)]
    feet = [foot_anchor(im) for im in cropped]

    lefts = [f[0] for f in feet]
    rights = [im.width - f[0] for im, f in zip(cropped, feet)]
    ups = [f[1] for f in feet]
    downs = [im.height - f[1] for im, f in zip(cropped, feet)]
    pad = 12
    origin = (max(lefts) + pad, max(ups) + pad)
    cell = (
        int(np.ceil(origin[0] + max(rights) + pad)),
        int(np.ceil(origin[1] + max(downs) + pad)),
    )
    print("wolf cell", cell, "foot origin", origin)

    idle_dir = WOLF / "idle"
    atk_dir = WOLF / "attack"
    idle_dir.mkdir(parents=True, exist_ok=True)
    atk_dir.mkdir(parents=True, exist_ok=True)

    idle_cells, atk_cells = [], []
    scale = 0.5
    small = (max(1, int(cell[0] * scale)), max(1, int(cell[1] * scale)))
    for i, (im, ft) in enumerate(zip(cropped[:8], feet[:8]), 1):
        cell_im = place_in_cell(im, cell, ft, origin).resize(small, Image.Resampling.LANCZOS)
        cell_im.save(idle_dir / f"{i:02d}.png")
        idle_cells.append(cell_im)
    for i, (im, ft) in enumerate(zip(cropped[8:], feet[8:]), 1):
        cell_im = place_in_cell(im, cell, ft, origin).resize(small, Image.Resampling.LANCZOS)
        cell_im.save(atk_dir / f"{i:02d}.png")
        atk_cells.append(cell_im)

    sheet(idle_cells, WOLF / "idle-sheet.png")
    sheet(atk_cells, WOLF / "attack-sheet.png")
    cropped[3].save(WOLF / "portrait.png")


def key_still(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.suffix.lower() in {".jpg", ".jpeg"}:
        Image.open(src).convert("RGB").resize((1280, 720), Image.Resampling.LANCZOS).save(
            dst, quality=90
        )
        print(f"still {dst.name}")
        return
    im = key_image(Image.open(src), tol=48.0)
    bb = opaque_bbox(im, t=8)
    cropped = im.crop(bb)
    side = max(cropped.size) + 16
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    target = 256 if "fx" in dst.parts else 160
    canvas.resize((target, target), Image.Resampling.LANCZOS).save(dst)
    print(f"still {dst.name} {target}x{target}")


def process_stills(source: Path) -> None:
    for name, dst in STILL_MAP.items():
        src = source / name
        if not src.exists():
            print(f"skip missing {name}")
            continue
        key_still(src, dst)


def main() -> None:
    parser = argparse.ArgumentParser(description="Pack Packet Wolf sprites.")
    parser.add_argument(
        "--source",
        type=Path,
        default=None,
        help="Optional folder of named stills (legit.jpg, malware.jpg, ...).",
    )
    parser.add_argument("--wolf", action="store_true", help="Rebuild wolf sheets from harvest frames.")
    args = parser.parse_args()
    if args.wolf:
        process_wolf()
    if args.source:
        process_stills(args.source.resolve())
    if not args.wolf and not args.source:
        parser.error("nothing to do: pass --wolf and/or --source DIR")


if __name__ == "__main__":
    main()

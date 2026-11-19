# zonotents.github.io

Project page for "Zonotents: Densities on Robust Sets Enable Probabilistic Order Reduction". It is a static site
with no build step.

## Preview locally

The demos are ES modules, so browsers won't run them from `file://`. Serve the folder instead:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Layout

- `index.html`: the page. The text and numbers follow the compiled paper (mirror commit 02e609d, 2026-11-19).
- `css/style.css`: the styles, with color tokens for light and dark mode. The plot colors are the paper's: blue
  `#3b95c4` for the system, red `#f81b02` for the obstacle, and purple `#b469c0` for their overlap.
- `js/zono.js`: a JavaScript port of the 2D cases of the zonotents Python package. It covers zonotopes, Gaussian
  zonotents, moments, the moment-matched sum (`matched_gaussian`), sampling, and the outer, inner, and free
  reductions (`outer_reduction`, `probabilistic_reduction`, `free_reduction`). Gaussian masses on polygons use
  Owen's T, and Gaussian moments on polygons use the divergence theorem, both in closed form.
- `js/plot.js`: the canvas helpers (density rasters, polygons, draggable handles).
- `js/main.js`: the four demos, the theme toggle, and KaTeX.
- `media/`: the slosh video (`outputs/paper/video/slosh_video.mp4`) and PNGs rendered at 400 dpi from the paper's
  figure PDFs.

## Deploy

1. Create the GitHub organization `zonotents` and a public repository named `zonotents.github.io` in it.
2. Push this folder to its `main` branch.
3. Under Settings → Pages, choose "Deploy from a branch", with branch `main` and folder `/`.

Once the paper is public, update the Paper and Code buttons and the BibTeX entry in `index.html`. Both buttons are
disabled for now and marked "soon".

# Gaussian Beam

A static Gaussian optics workbench for GitHub Pages. All propagation, fitting, waist matching, plotting, and file handling run in the browser. No backend, package installation, API key, CDN, or remote font is required.

## Optical bench

- Independent x/y beam waists, waist positions, vacuum wavelength, M², and input refractive index.
- Thin and cylindrical lenses, normal-incidence curved mirrors, flat mirrors, planar and curved refractive interfaces, dielectric slabs, and real ABCD matrices.
- Draggable optical elements, keyboard position adjustment, numerical editors, element disabling, duplication, and undo/redo.
- Beam envelopes, a movable probe, local waist and curvature readouts, and a peak-normalized transverse intensity image.
- Wavelength-dependent display colors for 380–780 nm, with labeled gray rendering outside that range. Enter commits a text or numeric field and removes focus.
- Measurement fitting with a fixed wavelength and M²; bounded position optimization for up to two thin lenses toward a circular waist.
- Local autosave, JSON configuration import/export, configuration links, SVG plot export, and sampled CSV export.

This is an original browser implementation inspired by the [classic GaussianBeam](https://github.com/gyger/GaussianBeam) workflow. It does not reuse the desktop program's code or read its native configuration format. Save and Open use this app's versioned JSON format. Mirrors use an unfolded propagation axis, rather than a folded two-dimensional table layout.

The calculations use paraxial optics. See [PHYSICS.md](PHYSICS.md) for conventions, sources, test tolerances, and model limits. The target-waist solver reports the best bounded candidate and its overlap; it does not guarantee that an arbitrary target is reachable or that the candidate is a global optimum. Browser storage belongs to the current browser and site origin; exported JSON files provide portable backups.

## Run locally

With Node.js 20 or newer:

```sh
npm start
```

Open http://127.0.0.1:4173. Any static HTTP server also works. Browser ES modules require HTTP(S); opening `index.html` directly through `file://` is not supported.

## GitHub Pages

The published app is [timothytchang.github.io/gaussian-beam](https://timothytchang.github.io/gaussian-beam/).

To host a separate copy, fork this repository, then choose **Settings → Pages → Deploy from a branch**, select **main**, and use the **/ (root)** folder. The app uses relative URLs, so repository subpaths work without rebuilding. `.nojekyll` keeps the files unchanged.

For another static host, upload `index.html`, `style.css`, `app.mjs`, `optics.mjs`, `favicon.svg`, and `PHYSICS.md` together. Calculations continue without network access after those files load. Model reference links are optional external navigation. The app does not install a service worker or guarantee offline reloads.

## Verification

```sh
npm test
```

The tests cover analytic free propagation, lens transforms, refraction, finite slab thickness, independent ray-covariance propagation, measurement fits, and bounded target-waist matching. Test code uses Node's standard library and has no package dependencies.

## Typography and licensing

The interface uses Helvetica with Arial and generic sans-serif fallbacks. The available Neue Montreal files were demo/trial assets; they are not redistributed in this public repository. The implementation uses the MIT license. No third-party source code, fonts, or artwork are bundled.

The spectral display uses an original interpolation implementation with the wavelength breakpoints from [Dan Bruton's approximate RGB spectrum](https://www.physics.sfasu.edu/astro/color/spectra.html). Outline colors are darkened for contrast. This display convention does not provide calibrated colorimetry.

# Gaussian beam model

## Units and beam radius

Positions, focal lengths, curvature radii, and beam radii use millimeters. The wavelength input is the vacuum wavelength in nanometers; the model converts it to millimeters. Refractive index and the supplied $M^2$ are dimensionless.

For a Gaussian intensity profile, $w$ is the $1/e^2$ intensity radius. For a non-Gaussian beam, the $M^2$ extension requires the second-moment radius $w=2\sigma$, half the D4σ diameter. A measured $1/e^2$ contour generally cannot replace that second moment. The model uses one fixed $M^2$ for both axes and substitutes $M^2\lambda_0/n$ for the wavelength in each homogeneous medium. See Paschotta, [RP Photonics Encyclopedia, “M² Factor”](https://www.rp-photonics.com/m2_factor.html).

## Propagation convention

Each transverse axis has its own geometric complex beam parameter:

$$
q=(z-z_0)+i z_R,\qquad
z_R=\frac{\pi n w_0^2}{M^2\lambda_0},\qquad
\frac{1}{q}=\frac{1}{R}-i\frac{M^2\lambda_0}{\pi n w^2}.
$$

Positive $R$ describes a diverging wavefront. The positive imaginary part follows the engineering phasor convention. RP Photonics' Gaussian-beam article uses the conjugate convention in its complex-field section; the observable radii agree. In a homogeneous medium, propagation over physical distance $d$ gives $q'=q+d$. The input waist positions define the incident beam extrapolated through the initial medium. See Paschotta, [RP Photonics Encyclopedia, “Gaussian Beams”](https://www.rp-photonics.com/gaussian_beams.html).

The ray coordinates are $(x,\theta)$, with geometric angle $\theta$. Optical elements apply $q'=(Aq+B)/(Cq+D)$. A physical matrix has $AD-BC=n_\mathrm{in}/n_\mathrm{out}$ in this convention. A thin lens has $C=-1/f$, with positive $f$ focusing. A normal-incidence mirror uses $C=-2/R_m$, with positive $R_m$ concave. The mirror path is unfolded onto increasing $z$; the plot does not draw a physical return path. See Paschotta, [RP Photonics Encyclopedia, “ABCD Matrix”](https://www.rp-photonics.com/abcd_matrix.html).

A spherical refracting surface uses

$$
A=1,\quad B=0,\quad
C=\frac{n_\mathrm{in}-n_\mathrm{out}}{n_\mathrm{out}R_s},\quad
D=\frac{n_\mathrm{in}}{n_\mathrm{out}}.
$$

Here positive $R_s$ places the center of curvature downstream. A plane surface has $C=0$. A slab includes planar entry, physical propagation through its thickness, and planar exit to its surrounding index. At an element position, readouts use the outgoing beam; slab interiors use the slab index. Reported waist positions describe the local beam extrapolated within its current medium, so another optic may interrupt that waist.

## Numerical verification

Run `node --test optics.test.mjs independent.test.mjs` from this directory.

The independent suite propagates two rms ray basis vectors and reconstructs their covariance matrix. It never calls the implementation's complex arithmetic or ABCD propagation helpers. Widths follow $w=2\sqrt{S_{xx}}$; the comparison reconstructs $q=(S_{x\theta}+i\sqrt{\det S})/S_{\theta\theta}$.

Checks cover three wavelength/index/$M^2$ combinations, three compound optical systems, a closed-form lens/mirror image, cylindrical axes, slab interiors, and refracting surfaces. Propagation comparisons use absolute and relative tolerances of $3\times10^{-11}$ in the declared units. Measurement fitting checks three independently generated caustics, requiring radius and waist-position recovery to relative $10^{-6}$ with explicit absolute floors. A two-lens 4f relay checks bounded waist matching against independent ray propagation, with normalized mismatch below $10^{-5}$.

The exact lens checkpoint starts with $q=100i$ mm and $f=100$ mm; propagation by 50 mm after the lens must give $q=50i$ mm. The slab checkpoint places 90 mm of index 1.8 inside index 1.2. At physical position 300 mm, its equivalent propagation distance in the surrounding medium is $300-90+90(1.2/1.8)=270$ mm.

## Applicability and limits

The model assumes paraxial propagation, homogeneous isotropic media, uncoupled transverse axes, and ideal first-order elements. It does not calculate diffraction from apertures, aberration, absorption, Fresnel loss, polarization, oblique mirrors, or rotated astigmatism. $M^2>1$ predicts an envelope, not a full intensity distribution.

Measurement fitting holds wavelength, refractive index, and $M^2$ fixed. It supplies no measurement uncertainty or ISO 11146 certification. The waist matcher proposes lens positions within supplied bounds. Its residual verifies the proposed match; failure to converge does not prove that no solution exists. Its overlap is an ideal-Gaussian mode metric and does not predict coupling efficiency for arbitrary $M^2>1$ beams. Neither verification suite benchmarks experimental data or the original desktop program.

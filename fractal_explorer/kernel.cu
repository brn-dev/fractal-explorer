// One pixel per CUDA thread; the entire escape loop stays on the GPU.
// --fmad=false makes CPU / GPU comparison predictable near the boundary.
__device__ double smooth_value(int n, double mag, int power) {
    return fmax(0.0, n + 1.0 - log(log(sqrt(mag))) / log((double)power));
}
extern "C" __global__ void render(
    float* out, int width, int height, double x, double y, double span,
    int kind, int limit, double bailout2, double jx, double jy,
    const double* ref, int ref_len, int perturb
) {
    int id = blockIdx.x * blockDim.x + threadIdx.x;
    if (id >= width * height) return;
    int row = id / width, col = id % width;
    double px = ((col + 0.5) / width - 0.5) * span;
    double py = (height / 2.0 - row - 0.5) / width * span;
    out[id] = -1.0f;
    if (perturb) {
        double dcx = kind == 1 ? 0 : px, dcy = kind == 1 ? 0 : py;
        double dx = kind == 1 ? px : 0, dy = kind == 1 ? py : 0;
        int j = 0;
        for (int n = 0; n < limit; ++n) {
            if (j + 1 >= ref_len) { out[id] = -2; return; }
            double rx = ref[2*j], ry = ref[2*j+1];
            double nx = 2 * (rx * dx - ry * dy) + dx * dx - dy * dy + dcx;
            dy = 2 * (rx * dy + ry * dx + dx * dy) + dcy;
            dx = nx;
            ++j;
            rx = ref[2*j]; ry = ref[2*j+1];
            double zx = rx + dx, zy = ry + dy, mag = zx*zx + zy*zy;
            if (mag > bailout2) { out[id] = smooth_value(n + 1, mag, 2); return; }
            if (mag < 1e-8 * (rx*rx + ry*ry)) { out[id] = -2; return; }
            if (kind == 0 && (mag < dx*dx + dy*dy || j + 1 == ref_len)) {
                dx = zx; dy = zy; j = 0;
            }
        }
        return;
    }
    px += x; py += y;
    double cx = kind == 1 || kind == 4 ? jx : px;
    double cy = kind == 1 || kind == 4 ? jy : py;
    double zx = kind == 1 || kind == 4 ? px : 0;
    double zy = kind == 1 || kind == 4 ? py : 0;
    if (kind == 0) {
        double q = (cx - 0.25)*(cx - 0.25) + cy*cy;
        if (q*(q + cx - 0.25) <= 0.25*cy*cy || (cx+1)*(cx+1) + cy*cy <= 0.0625) return;
    }
    for (int n = 0; n < limit; ++n) {
        double nx;
        if (kind == 4) {
            nx = zx*(zx*zx - 3*zy*zy) + cx;
            zy = zy*(3*zx*zx - zy*zy) + cy;
        } else if (kind == 2) {
            nx = fabs(zx*zx - zy*zy + cx);
            zy = fabs(2*zx*zy + cy);
        } else {
            nx = zx*zx - zy*zy + cx;
            zy = (kind == 3 ? -2 : 2)*zx*zy + cy;
        }
        zx = nx;
        double mag = zx*zx + zy*zy;
        if (mag > bailout2) { out[id] = smooth_value(n + 1, mag, kind == 4 ? 3 : 2); return; }
    }
}

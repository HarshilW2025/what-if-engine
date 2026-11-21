import * as THREE from "three";

/** Our data uses NaN for "not there" (a body that vanished, debris not formed yet). three.js sizes every shape
 * from all its points, so one NaN makes the size NaN: it logs an error and may skip drawing the shape.
 * This sizes shapes from their real points only. Imported once by each viewer. */
const proto = THREE.BufferGeometry.prototype as THREE.BufferGeometry & { __nanSafe?: boolean };
if (!proto.__nanSafe) {
  proto.__nanSafe = true;
  proto.computeBoundingSphere = function (this: THREE.BufferGeometry) {
    if (this.boundingSphere === null) this.boundingSphere = new THREE.Sphere();
    const s = this.boundingSphere;
    const pos = this.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    s.center.set(0, 0, 0);
    s.radius = 0;
    if (!pos) return;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, n = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
      n++;
    }
    if (!n) return;
    s.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    let r2 = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - s.center.x, dy = pos.getY(i) - s.center.y, dz = pos.getZ(i) - s.center.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (Number.isFinite(d) && d > r2) r2 = d;
    }
    s.radius = Math.sqrt(r2);
  };
}

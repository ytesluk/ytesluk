import * as THREE from "three";

/**
 * A photo studio built in code and baked into an environment map, so glossy parts have something
 * real to reflect (no image files are downloaded): a large softbox overhead, a warm strip on the
 * left, a cool kicker on the right, a low front fill, and the lime "sun" of the page low behind.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer, sun = 7): { texture: THREE.Texture; dispose(): void } {
  const scene = new THREE.Scene();
  const trash: Array<{ dispose(): void }> = [];

  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 40, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color("#0c1813").multiplyScalar(0.55), side: THREE.BackSide }));
  trash.push(room.geometry, room.material as THREE.Material);
  scene.add(room);

  const panel = (color: string, power: number, w: number, h: number, pos: [number, number, number]) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    trash.push(mesh.geometry, mat);
    scene.add(mesh);
  };
  panel("#ffffff", 11, 18, 12, [0, 16, 3]); // overhead softbox
  panel("#fff1dc", 9, 5, 18, [-17, 3, 7]); // warm strip, left
  panel("#dfeaff", 4.5, 4, 14, [17, 4, -5]); // cool kicker, right
  panel("#f4f1e6", 1.6, 22, 9, [0, 1, 20]); // front fill
  panel("#ffffff", 3.2, 30, 9, [0, 8, -22]); // back wall wash: what the glossy lid mirrors
  panel("#dcf45b", sun, 9, 9, [11, -9, -12]); // the page's sun, low and behind

  // Half the default resolution: the studio is a few large soft panels, and this is the slowest
  // step of starting a scene on a modest graphics card.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03, 0.1, 100, { size: 128 });
  pmrem.dispose();
  for (const t of trash) t.dispose();
  return { texture: target.texture, dispose: () => target.dispose() };
}

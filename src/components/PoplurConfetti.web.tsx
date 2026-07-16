import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import * as THREE from 'three';

type Piece = {
  mesh: THREE.Mesh;
  speed: number;
  drift: number;
  spin: number;
  phase: number;
};

const colors = ['#f04f5f', '#f4793f', '#f8aa38', '#ffd64d'];

export function PoplurConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pieces = useMemo<Piece[]>(() => [], []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const sceneHost = host;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 4;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const geometry = new THREE.PlaneGeometry(0.045, 0.016);
    for (let index = 0; index < 189; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: colors[index % colors.length],
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(Math.random() * 2.5 - 1.25, Math.random() * 2.4 - 0.8, Math.random() * 0.2);
      mesh.rotation.z = Math.random() * Math.PI;
      mesh.scale.setScalar(0.7 + Math.random() * 0.9);
      scene.add(mesh);
      pieces.push({
        mesh,
        speed: 0.28 + Math.random() * 0.34,
        drift: -0.14 + Math.random() * 0.28,
        spin: -2.8 + Math.random() * 5.6,
        phase: Math.random() * Math.PI * 2
      });
    }

    let width = 0;
    let height = 0;
    let frame = 0;
    let last = performance.now();

    function resize() {
      const nextWidth = Math.max(sceneHost.clientWidth, 1);
      const nextHeight = Math.max(sceneHost.clientHeight, 1);
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      renderer.setSize(width, height, false);
      camera.left = -width / height;
      camera.right = width / height;
      camera.updateProjectionMatrix();
    }

    function animate(now: number) {
      resize();
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      const horizontalLimit = Math.max(width / Math.max(height, 1), 1);

      pieces.forEach((piece, index) => {
        piece.mesh.position.y -= piece.speed * delta;
        piece.mesh.position.x += (piece.drift + Math.sin(now * 0.0017 + piece.phase) * 0.08) * delta;
        piece.mesh.rotation.x += piece.spin * delta;
        piece.mesh.rotation.z += piece.spin * 0.62 * delta;
        if (piece.mesh.position.y < -1.18) {
          piece.mesh.position.y = 1.16 + Math.random() * 0.42;
          piece.mesh.position.x = Math.random() * horizontalLimit * 2 - horizontalLimit;
          piece.mesh.scale.setScalar(0.7 + Math.random() * 0.9);
          piece.mesh.rotation.z = (index * 0.37) % Math.PI;
        }
      });

      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    }

    frame = window.requestAnimationFrame(animate);
    const observer = new ResizeObserver(resize);
    observer.observe(sceneHost);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      geometry.dispose();
      pieces.splice(0).forEach(piece => {
        (piece.mesh.material as THREE.Material).dispose();
      });
    };
  }, [pieces]);

  return (
    <View pointerEvents="none" style={styles.layer}>
      {React.createElement('canvas', {
        ref: canvasRef,
        'aria-hidden': true,
        style: styles.canvas
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block'
  } as any
});

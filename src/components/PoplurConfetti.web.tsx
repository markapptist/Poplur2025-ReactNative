import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import * as THREE from 'three';
import { usePoplurHeavyRenderer, usePoplurPerformance } from '../performance/PoplurPerformance';
import { PoplurPerformanceMode } from '../performance/PoplurPerformanceManager';

type Piece = {
  x: number;
  y: number;
  z: number;
  scale: number;
  speed: number;
  drift: number;
  spin: number;
  phase: number;
  rotationX: number;
  rotationZ: number;
};

const colors = ['#f04f5f', '#f4793f', '#f8aa38', '#ffd64d'];
const FULL_PIECE_COUNT = 189;

export function PoplurConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const policy = usePoplurPerformance();
  const visible = policy.decorativeRenderingAllowed && policy.particlesAllowed;
  const active = usePoplurHeavyRenderer(
    'web-welcome-confetti',
    visible,
    { priority: 20, decorative: true },
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host || !active) return;
    const sceneHost = host;
    const pieceCount = Math.max(0, Math.round(FULL_PIECE_COUNT * policy.particleDensityMultiplier));
    if (pieceCount === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 4;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: policy.mode === PoplurPerformanceMode.FULL,
      powerPreference: policy.mode === PoplurPerformanceMode.FULL ? 'default' : 'low-power',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, policy.maxDevicePixelRatio));

    // One instanced draw replaces 189 meshes/materials/draw calls while keeping
    // the same individual movement, colour, scale, and rotation.
    const geometry = new THREE.PlaneGeometry(0.045, 0.016);
    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      vertexColors: true,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, pieceCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);

    const pieces: Piece[] = [];
    for (let index = 0; index < pieceCount; index += 1) {
      pieces.push({
        x: Math.random() * 2.5 - 1.25,
        y: Math.random() * 2.4 - 0.8,
        z: Math.random() * 0.2,
        scale: 0.7 + Math.random() * 0.9,
        speed: 0.28 + Math.random() * 0.34,
        drift: -0.14 + Math.random() * 0.28,
        spin: -2.8 + Math.random() * 5.6,
        phase: Math.random() * Math.PI * 2,
        rotationX: 0,
        rotationZ: Math.random() * Math.PI,
      });
      mesh.setColorAt(index, new THREE.Color(colors[index % colors.length]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    let width = 0;
    let height = 0;
    let frame = 0;
    let frameTimer: ReturnType<typeof setTimeout> | null = null;
    let last = performance.now();
    let stopped = false;
    const dummy = new THREE.Object3D();

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

    function scheduleFrame() {
      if (stopped) return;
      const delay = Math.max(0, 1000 / policy.targetFPS - (performance.now() - last));
      frameTimer = setTimeout(() => {
        frameTimer = null;
        frame = window.requestAnimationFrame(animate);
      }, delay);
    }

    function animate(now: number) {
      if (stopped) return;
      resize();
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      const horizontalLimit = Math.max(width / Math.max(height, 1), 1);

      pieces.forEach((piece, index) => {
        piece.y -= piece.speed * delta;
        piece.x += (piece.drift + Math.sin(now * 0.0017 + piece.phase) * 0.08) * delta;
        piece.rotationX += piece.spin * delta;
        piece.rotationZ += piece.spin * 0.62 * delta;
        if (piece.y < -1.18) {
          piece.y = 1.16 + Math.random() * 0.42;
          piece.x = Math.random() * horizontalLimit * 2 - horizontalLimit;
          piece.scale = 0.7 + Math.random() * 0.9;
          piece.rotationZ = (index * 0.37) % Math.PI;
        }
        dummy.position.set(piece.x, piece.y, piece.z);
        dummy.rotation.set(piece.rotationX, 0, piece.rotationZ);
        dummy.scale.setScalar(piece.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
      scheduleFrame();
    }

    resize();
    frame = window.requestAnimationFrame(animate);
    const observer = new ResizeObserver(resize);
    observer.observe(sceneHost);

    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      if (frameTimer) clearTimeout(frameTimer);
      observer.disconnect();
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [
    active,
    policy.maxDevicePixelRatio,
    policy.mode,
    policy.particleDensityMultiplier,
    policy.targetFPS,
  ]);

  return (
    <View pointerEvents="none" style={styles.layer}>
      {React.createElement('canvas', {
        ref: canvasRef,
        'aria-hidden': true,
        style: styles.canvas,
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  } as any,
});
